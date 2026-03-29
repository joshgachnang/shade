// Must unset CLAUDECODE before importing the SDK to allow nested sessions
delete process.env.CLAUDECODE;
delete process.env.CLAUDE_CODE_ENTRYPOINT;

import path from "node:path";
import {query} from "@anthropic-ai/claude-agent-sdk";
import {logger} from "@terreno/api";
import {createShadeMcpServer} from "../../agentRunner/mcpServer";
import {buildAgentEnv, redactSecrets} from "../security";
import type {AgentRunConfig, AgentRunner, AgentRunResult} from "./types";

interface ActiveAgent {
  abortController: AbortController;
  startedAt: number;
}

/** Minimum interval between progress callbacks (ms) */
const PROGRESS_INTERVAL_MS = 30_000;

export class DirectAgentRunner implements AgentRunner {
  private activeAgents = new Map<string, ActiveAgent>();

  async run(config: AgentRunConfig): Promise<AgentRunResult> {
    const startedAt = Date.now();
    const abortController = new AbortController();

    this.activeAgents.set(config.sessionId, {abortController, startedAt});

    const timeoutId = setTimeout(() => {
      logger.warn(`Agent ${config.sessionId} timed out after ${config.timeout}ms`);
      abortController.abort();
    }, config.timeout);

    // Tracked across try/catch so the catch block can return resume info on timeout
    let sdkSessionId = config.sessionId;
    let lastMessageUuid: string | undefined;
    let partialOutput = "";

    try {
      const env = buildAgentEnv({
        SHADE_GROUP_ID: config.groupId,
        SHADE_IPC_DIR: path.join(process.cwd(), "data/ipc"),
        SHADE_CHANNEL_ID: "",
        ...config.env,
      });

      // Ensure CLAUDECODE vars are NOT in the env — their presence (even empty) blocks nested sessions
      delete env.CLAUDECODE;
      delete env.CLAUDE_CODE_ENTRYPOINT;

      // Set up MCP servers - include Shade's built-in MCP server
      const mcpServers: Record<string, any> = {};

      // Add the in-process Shade MCP server for send_message, schedule_task, etc.
      const shadeMcp = createShadeMcpServer({
        groupId: config.groupId,
        channelId: config.env?.SHADE_CHANNEL_ID ?? "",
        ipcDir: path.join(process.cwd(), "data/ipc"),
      });
      mcpServers["shade-orchestrator"] = shadeMcp;

      // Add any additional external MCP servers
      if (config.mcpServers) {
        for (const server of config.mcpServers) {
          mcpServers[server.name] = {
            command: server.command,
            args: server.args,
            env: server.env,
          };
        }
      }

      let result = "";
      let costUsd: number | undefined;
      let lastProgressAt = 0;

      const queryOptions: Parameters<typeof query>[0] = {
        prompt: config.prompt,
        options: {
          cwd: config.groupFolder,
          env,
          systemPrompt: config.systemPrompt,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          allowedTools: ["Read", "Write", "Edit", "Bash", "Glob", "Grep"],
          abortController,
          maxTurns: 50,
          mcpServers,
          ...(config.resume && config.resumeSessionAt ? {resume: config.resumeSessionAt} : {}),
        },
      };

      logger.info(`Starting agent for session ${config.sessionId} in ${config.groupFolder}`);
      logger.info(
        `CLAUDECODE env: "${process.env.CLAUDECODE}" entrypoint: "${process.env.CLAUDE_CODE_ENTRYPOINT}"`
      );

      logger.info(
        `Agent SDK query() starting: session=${config.sessionId}, resume=${config.resume ?? false}, cwd=${config.groupFolder}, model=${config.modelName ?? "default"}`
      );

      const stream = query(queryOptions);
      logger.info("Agent SDK query() called, awaiting first message...");

      for await (const message of stream) {
        logger.debug(
          `Agent SDK message: type=${message.type} subtype=${"subtype" in message ? message.subtype : "none"}`
        );

        // Track UUID from every message for resume
        if ("uuid" in message && message.uuid) {
          lastMessageUuid = message.uuid as string;
        }

        if (message.type === "system" && message.subtype === "init") {
          sdkSessionId = message.session_id;
          logger.debug(`Agent session initialized: ${sdkSessionId}`);
        }

        // Collect partial assistant text for timeout reporting
        if (message.type === "assistant" && "content" in message) {
          const content = message.content;
          if (Array.isArray(content)) {
            for (const block of content) {
              if (typeof block === "object" && block !== null && "text" in block) {
                partialOutput += (block as {text: string}).text;
              }
            }
          }
        }

        // Emit progress callbacks at throttled intervals
        if (config.onProgress && partialOutput.length > 0) {
          const now = Date.now();
          if (now - lastProgressAt >= PROGRESS_INTERVAL_MS) {
            lastProgressAt = now;
            config.onProgress(partialOutput);
          }
        }

        if (message.type === "result") {
          if (message.subtype === "success") {
            result = message.result;
            costUsd = message.total_cost_usd;
            logger.info(
              `Agent completed in ${message.duration_ms}ms, cost: $${message.total_cost_usd.toFixed(4)}`
            );
          } else {
            const errorMsg = message.errors?.join("; ") ?? "Unknown error";
            logger.error(`Agent failed: ${message.subtype} - ${errorMsg}`);
            return {
              output: partialOutput ? redactSecrets(partialOutput) : "",
              sessionId: sdkSessionId,
              durationMs: Date.now() - startedAt,
              status: message.subtype === "error_max_turns" ? "timeout" : "failed",
              error: errorMsg,
              resumeSessionId: sdkSessionId,
              lastMessageUuid,
            };
          }
        }
      }

      return {
        output: redactSecrets(result),
        sessionId: sdkSessionId,
        durationMs: Date.now() - startedAt,
        status: "completed",
        costUsd,
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (isAbort) {
        logger.warn(
          `Agent ${config.sessionId} was aborted (timeout), sdkSession=${sdkSessionId}, lastUuid=${lastMessageUuid ?? "none"}`
        );
        return {
          output: partialOutput ? redactSecrets(partialOutput) : "",
          sessionId: sdkSessionId,
          durationMs: Date.now() - startedAt,
          status: "timeout",
          error: "Agent execution timed out",
          resumeSessionId: sdkSessionId,
          lastMessageUuid,
        };
      }

      logger.error(`Agent ${config.sessionId} error: ${errorMessage}`);
      return {
        output: "",
        sessionId: config.sessionId,
        durationMs: Date.now() - startedAt,
        status: "failed",
        error: redactSecrets(errorMessage),
      };
    } finally {
      clearTimeout(timeoutId);
      this.activeAgents.delete(config.sessionId);
    }
  }

  async stop(sessionId: string): Promise<void> {
    const agent = this.activeAgents.get(sessionId);
    if (agent) {
      agent.abortController.abort();
      logger.info(`Stopped agent ${sessionId}`);
    }
  }

  isRunning(sessionId: string): boolean {
    return this.activeAgents.has(sessionId);
  }

  async sendFollowUp(sessionId: string, _message: string): Promise<void> {
    // Follow-up messages are handled via session resume in the Agent SDK
    // The caller should stop the current session and start a new query with resume
    logger.debug(`Follow-up requested for ${sessionId} - use session resume`);
  }
}
