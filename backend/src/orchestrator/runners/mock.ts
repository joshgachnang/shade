import {logger} from "@terreno/api";
import {paths} from "../../config";
import {AgentTask} from "../../models/agentTask";
import {loadAppConfig} from "../../models/appConfig";
import {LlmFixture} from "../../models/llmFixture";
import type {LlmFixtureAction, LlmFixtureDocument} from "../../types";
import {writeIpcFile} from "../ipcWriter";
import type {AgentRunConfig, AgentRunner, AgentRunResult} from "./types";

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Deterministic agent for the AI testability harness (IP-012). Selected at
 * boot (orchestrator/index.ts, workerMain.ts) when SHADE_TEST_MODE=1, in place
 * of DirectAgentRunner/OpenAIAgentRunner.
 *
 * On each run it picks the highest-priority active LlmFixture whose match
 * (groupId, prompt regex) hits, executes the fixture's scripted actions
 * through the real IPC/board path, and returns the fixture response as a
 * normal AgentRunResult. With no match it echoes the prompt (when
 * AppConfig.testMode.echoFallback is on). It writes NO audit records —
 * TaskRunLog/AIRequest/transcripts are created by the callers (GroupQueue,
 * TaskWorkerService), exactly as for real runners, which is how mock runs get
 * audit parity for free.
 */
export class MockAgentRunner implements AgentRunner {
  private activeSessions = new Set<string>();

  async run(config: AgentRunConfig): Promise<AgentRunResult> {
    const startedAt = Date.now();
    this.activeSessions.add(config.sessionId);

    try {
      const appConfig = await loadAppConfig();
      const fixture = await this.claimMatchingFixture(config);

      const latency = (appConfig.testMode?.simulateLatencyMs ?? 0) + (fixture?.delayMs ?? 0);
      if (latency > 0) {
        await sleep(latency);
      }

      if (fixture) {
        await this.executeActions(fixture.actions ?? [], config);
        logger.info(
          `Mock agent run ${config.sessionId}: fixture "${fixture.name}" (${(fixture.actions ?? []).length} action(s))`
        );
        return {
          output: fixture.response,
          sessionId: config.sessionId,
          durationMs: Date.now() - startedAt,
          status: "completed",
          costUsd: 0,
        };
      }

      if (appConfig.testMode?.echoFallback !== false) {
        return {
          output: `[mock] received: ${config.prompt.slice(-500)}`,
          sessionId: config.sessionId,
          durationMs: Date.now() - startedAt,
          status: "completed",
          costUsd: 0,
        };
      }

      return {
        output: "",
        sessionId: config.sessionId,
        durationMs: Date.now() - startedAt,
        status: "failed",
        error: "No matching LlmFixture and testMode.echoFallback is disabled",
      };
    } finally {
      this.activeSessions.delete(config.sessionId);
    }
  }

  /**
   * Highest-priority active fixture whose match hits. consumeOnce fixtures are
   * claimed atomically (soft-delete in the same findOneAndUpdate) so two
   * concurrent runs can never both fire a one-shot fixture.
   */
  private async claimMatchingFixture(config: AgentRunConfig): Promise<LlmFixtureDocument | null> {
    const fixtures = await LlmFixture.find({deleted: {$ne: true}}).sort({
      priority: -1,
      created: 1,
    });

    for (const fixture of fixtures) {
      if (fixture.match?.groupId && fixture.match.groupId !== config.groupId) {
        continue;
      }
      if (fixture.match?.pattern) {
        let regex: RegExp;
        try {
          regex = new RegExp(fixture.match.pattern);
        } catch (err) {
          logger.warn(`LlmFixture "${fixture.name}" has an invalid pattern, skipping: ${err}`);
          continue;
        }
        if (!regex.test(config.prompt)) {
          continue;
        }
      }

      if (fixture.consumeOnce) {
        const claimed = await LlmFixture.findOneAndUpdate(
          {_id: fixture._id, deleted: {$ne: true}},
          {$set: {deleted: true}},
          {new: true}
        );
        if (!claimed) {
          continue; // A concurrent run claimed it first.
        }
        return claimed as LlmFixtureDocument;
      }

      return fixture;
    }

    return null;
  }

  /**
   * Scripted side effects, executed the way the real MCP tools produce them:
   * IPC files under paths.ipc (relayed by the gateway's IpcWatcher) for
   * messages/reactions/scheduled tasks, and a direct AgentTask insert for
   * board work (parity with delegate_task).
   */
  private async executeActions(actions: LlmFixtureAction[], config: AgentRunConfig): Promise<void> {
    const channelId = config.env?.SHADE_CHANNEL_ID ?? "";

    for (const action of actions) {
      const args = action.args ?? {};
      switch (action.tool) {
        case "send_message":
          await writeIpcFile(paths.ipc, {
            type: "send_message",
            groupId: config.groupId,
            channelId,
            content: String(args.content ?? ""),
            targetGroupId: args.targetGroupId,
            agentRunId: config.sessionId,
          });
          break;
        case "add_reaction":
          await writeIpcFile(paths.ipc, {
            type: "add_reaction",
            groupId: config.groupId,
            channelId,
            messageTs: String(args.messageTs ?? config.messageTs ?? ""),
            emoji: String(args.emoji ?? "robot_face"),
          });
          break;
        case "schedule_task":
          await writeIpcFile(paths.ipc, {
            type: "create_task",
            groupId: config.groupId,
            data: args,
          });
          break;
        case "create_task":
          await AgentTask.create({
            groupId: config.groupId,
            title: String(args.title ?? "mock board task"),
            prompt: String(args.prompt ?? ""),
            priority: typeof args.priority === "number" ? args.priority : 0,
            deliverResult: args.deliverResult !== false,
          });
          break;
        default:
          logger.warn(`Mock agent: unknown fixture action tool "${action.tool}"`);
      }
    }
  }

  async stop(sessionId: string): Promise<void> {
    this.activeSessions.delete(sessionId);
  }

  isRunning(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  async sendFollowUp(_sessionId: string, _message: string): Promise<void> {
    // Follow-ups arrive as new runs in the harness; nothing to do.
  }
}
