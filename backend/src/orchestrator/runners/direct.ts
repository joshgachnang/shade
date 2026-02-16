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

    try {
      const env = buildAgentEnv({
        SHADE_GROUP_ID: config.groupId,
        SHADE_IPC_DIR: path.join(process.cwd(), "data/ipc"),
        SHADE_CHANNEL_ID: "",
        ...config.env,
      });

      // Set up MCP servers - include Shade's built-in MCP server
      const mcpServers: Record<string, any> = {};

      // Add the in-process Shade MCP server for send_message, schedule_task, etc.
      const shadeMcp = createShadeMcpServer();
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
      let sessionId = config.sessionId;

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

      for await (const message of query(queryOptions)) {
        if (message.type === "system" && message.subtype === "init") {
          sessionId = message.session_id;
          logger.debug(`Agent session initialized: ${sessionId}`);
        }

        if (message.type === "result") {
          if (message.subtype === "success") {
            result = message.result;
            logger.info(
              `Agent completed in ${message.duration_ms}ms, cost: $${message.total_cost_usd.toFixed(4)}`
            );
          } else {
            const errorMsg = message.errors?.join("; ") ?? "Unknown error";
            logger.error(`Agent failed: ${message.subtype} - ${errorMsg}`);
            return {
              output: "",
              sessionId,
              durationMs: Date.now() - startedAt,
              status: message.subtype === "error_max_turns" ? "timeout" : "failed",
              error: errorMsg,
            };
          }
        }
      }

      return {
        output: redactSecrets(result),
        sessionId,
        durationMs: Date.now() - startedAt,
        status: "completed",
      };
    } catch (error) {
      const isAbort = error instanceof Error && error.name === "AbortError";
      const errorMessage = error instanceof Error ? error.message : String(error);

      if (isAbort) {
        logger.warn(`Agent ${config.sessionId} was aborted`);
        return {
          output: "",
          sessionId: config.sessionId,
          durationMs: Date.now() - startedAt,
          status: "timeout",
          error: "Agent execution timed out or was aborted",
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
