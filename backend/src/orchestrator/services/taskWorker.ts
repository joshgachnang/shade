import {logger} from "@terreno/api";
import {AgentTask} from "../../models/agentTask";
import {loadAppConfig} from "../../models/appConfig";
import {Group} from "../../models/group";
import {TaskRunLog} from "../../models/taskRunLog";
import type {AgentTaskDocument} from "../../types";
import type {ChannelManager} from "../channels/manager";
import {logError} from "../errors";
import {buildSystemPrompt, ensureGroupDirectory} from "../memory";
import {formatOutboundMessage} from "../router";
import type {AgentRunner} from "../runners/types";
import {
  claimNextTask,
  completeTask,
  failTask,
  getWorkerId,
  heartbeatTask,
  reclaimStaleTasks,
} from "./taskBoard";

const DEFAULT_POLL_MS = 5000;
const DEFAULT_CONCURRENCY = 2;
const DEFAULT_HEARTBEAT_MS = 15000;
const DEFAULT_STALE_MS = 60000;
const DEFAULT_TASK_TIMEOUT_MS = 900000;

interface TaskWorkerDeps {
  runner: AgentRunner;
  channelManager: ChannelManager;
}

interface ActiveTaskRun {
  sessionId: string;
  heartbeatId: ReturnType<typeof setInterval> | null;
  cancelRequested: boolean;
  promise: Promise<void>;
}

/**
 * In-process worker pool for the AgentTask board. Each tick reclaims stale
 * tasks (dead workers) and claims pending tasks up to the configured
 * concurrency. Claimed tasks run through the injected AgentRunner as
 * background work — they bypass GroupQueue entirely, so they never block
 * conversation turns. IP-010 moves this loop out of process using the same
 * claim/heartbeat semantics from taskBoard.ts.
 */
export class TaskWorkerService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  /** Most recent loop-initiated tick, tracked so drains can await it. */
  private pendingTick: Promise<void> = Promise.resolve();
  private readonly runner: AgentRunner;
  private readonly channelManager: ChannelManager;
  private readonly workerId = getWorkerId();
  private readonly activeRuns = new Map<string, ActiveTaskRun>();

  constructor({runner, channelManager}: TaskWorkerDeps) {
    this.runner = runner;
    this.channelManager = channelManager;
  }

  /** Whether the poll loop is running (started and not disabled/stopped). */
  get isRunning(): boolean {
    return this.intervalId !== null;
  }

  /** Number of board tasks currently executing in this process. */
  get activeCount(): number {
    return this.activeRuns.size;
  }

  async start(): Promise<void> {
    if (this.intervalId) {
      return;
    }

    const appConfig = await loadAppConfig();
    if (appConfig.taskWorker?.enabled === false) {
      logger.info("Task worker disabled (AppConfig.taskWorker.enabled=false), not starting");
      return;
    }
    const interval = appConfig.taskWorker?.pollMs ?? DEFAULT_POLL_MS;

    // Run an immediate tick so tasks already pending on boot don't wait a full interval.
    this.pendingTick = this.tick().catch((err) => logError("Task worker initial tick error", err));

    this.intervalId = setInterval(() => {
      this.pendingTick = this.tick().catch((err) => {
        logger.error(`Task worker tick error: ${err}`);
      });
    }, interval);

    logger.info(`Task worker started (worker ${this.workerId}, interval: ${interval}ms)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Abort in-flight runs; their stale heartbeats let another worker (or this
    // one after restart) reclaim and retry the tasks.
    for (const [taskId, run] of this.activeRuns) {
      if (run.heartbeatId) {
        clearInterval(run.heartbeatId);
        run.heartbeatId = null;
      }
      this.runner.stop(run.sessionId).catch((err) => {
        logger.warn(`Failed to abort board task ${taskId} on shutdown: ${err}`);
      });
    }

    logger.info("Task worker stopped");
  }

  /** One worker pass: reclaim stale tasks, then claim up to `concurrency` pending tasks. */
  async tick(): Promise<void> {
    if (this.ticking) {
      logger.debug("Task worker tick already in progress, skipping");
      return;
    }
    this.ticking = true;

    try {
      const appConfig = await loadAppConfig();
      const staleMs = appConfig.taskWorker?.staleMs ?? DEFAULT_STALE_MS;
      const concurrency = appConfig.taskWorker?.concurrency ?? DEFAULT_CONCURRENCY;

      const reclaimed = await reclaimStaleTasks(staleMs);
      if (reclaimed > 0) {
        logger.info(`Task worker reclaimed ${reclaimed} stale task(s)`);
      }

      while (this.activeRuns.size < concurrency) {
        const task = await claimNextTask(this.workerId);
        if (!task) {
          break;
        }
        this.launchTask(task);
      }
    } finally {
      this.ticking = false;
    }
  }

  /** Wait for any in-flight tick and all in-flight task runs to settle (tests and graceful drains). */
  async waitForActiveRuns(): Promise<void> {
    await this.pendingTick;
    await Promise.all([...this.activeRuns.values()].map((run) => run.promise));
  }

  /**
   * Fire-and-forget execution of a claimed task. Registers the run in
   * `activeRuns` synchronously so the tick loop's concurrency accounting sees
   * it before the next claim.
   */
  private launchTask(task: AgentTaskDocument): void {
    const taskId = task._id.toString();
    // Board runs get a fresh session per attempt — they are background work,
    // deliberately isolated from the group's conversational session (which a
    // concurrent GroupQueue run may be using).
    const sessionId = `board-${taskId}-attempt-${task.attempts}`;
    const entry: ActiveTaskRun = {
      sessionId,
      heartbeatId: null,
      cancelRequested: false,
      promise: Promise.resolve(),
    };
    this.activeRuns.set(taskId, entry);

    entry.promise = this.runTask(task, sessionId, entry)
      .catch(async (err) => {
        // Unexpected error outside the runner try/catch (e.g. prompt build or
        // run-log write failed). Record the attempt so the task isn't stuck
        // until the stale sweep.
        logError(`Board task ${taskId} run error`, err);
        try {
          await failTask(taskId, String(err));
        } catch (failErr) {
          logger.error(`Failed to record failure for board task ${taskId}: ${failErr}`);
        }
      })
      .finally(() => {
        if (entry.heartbeatId) {
          clearInterval(entry.heartbeatId);
          entry.heartbeatId = null;
        }
        this.activeRuns.delete(taskId);
      });
  }

  private async runTask(
    task: AgentTaskDocument,
    sessionId: string,
    entry: ActiveTaskRun
  ): Promise<void> {
    const taskId = task._id.toString();
    const groupId = task.groupId.toString();
    const startedAt = new Date();

    const appConfig = await loadAppConfig();
    const heartbeatMs = appConfig.taskWorker?.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    const taskTimeoutMs = appConfig.taskWorker?.taskTimeoutMs ?? DEFAULT_TASK_TIMEOUT_MS;

    const group = await Group.findOneOrNone({_id: task.groupId});
    if (!group) {
      logger.warn(`Board task "${task.title}" (${taskId}) targets missing group ${groupId}`);
      await AgentTask.findByIdAndUpdate(task._id, {
        $set: {status: "failed", error: `Group ${groupId} not found`, completedAt: new Date()},
      });
      return;
    }

    await AgentTask.findByIdAndUpdate(task._id, {$set: {status: "running", startedAt}});
    logger.info(
      `Board task "${task.title}" (${taskId}) running on ${this.workerId} (attempt ${task.attempts}/${task.maxAttempts})`
    );

    // Heartbeat keeps the claim fresh and doubles as the cancellation check:
    // cancel_agent_task sets cancelRequested, the next beat aborts the run
    // via the runner's AbortController.
    entry.heartbeatId = setInterval(() => {
      this.beat(taskId, sessionId, entry).catch((err) => {
        logger.warn(`Heartbeat failed for board task ${taskId}: ${err}`);
      });
    }, heartbeatMs);

    const groupFolder = await ensureGroupDirectory(group.folder);
    const systemPrompt = await buildSystemPrompt(
      group.folder,
      `You are ${appConfig.assistantName}, an AI assistant working on a background task for the "${group.name}" group.`
    );

    const taskRunLog = await TaskRunLog.create({
      groupId: group._id,
      trigger: "delegated",
      classification: "internal",
      modelBackend: group.modelConfig.defaultBackend || "claude",
      modelName: group.modelConfig.defaultModel,
      status: "running",
      prompt: task.prompt,
      startedAt,
    });

    try {
      const result = await this.runner.run({
        groupId,
        groupFolder,
        sessionId,
        prompt: task.prompt,
        systemPrompt,
        modelBackend: group.modelConfig.defaultBackend || "claude",
        modelName: group.modelConfig.defaultModel,
        env: {
          SHADE_GROUP_ID: groupId,
          SHADE_CHANNEL_ID: group.channelId.toString(),
        },
        timeout: taskTimeoutMs,
        idleTimeout: group.executionConfig.idleTimeout || 60000,
        isBoardTask: true,
      });

      if (entry.cancelRequested) {
        await this.handleCancelled(task, taskRunLog._id.toString(), result.durationMs);
        return;
      }

      if (result.status === "completed") {
        await completeTask(taskId, result.output);
        await this.updateRunLog(taskRunLog._id.toString(), "completed", {
          result: result.output,
          durationMs: result.durationMs,
        });
        if (task.deliverResult) {
          const outbound = formatOutboundMessage(result.output, appConfig.assistantName);
          await this.deliver(groupId, `✅ ${task.title}: ${outbound}`);
        }
        return;
      }

      // failed or timeout
      const error =
        result.error ||
        (result.status === "timeout" ? `Timed out after ${taskTimeoutMs}ms` : "Agent run failed");
      await this.handleFailure({
        task,
        runLogId: taskRunLog._id.toString(),
        error,
        runLogStatus: result.status === "timeout" ? "timeout" : "failed",
        durationMs: result.durationMs,
      });
    } catch (err) {
      if (entry.cancelRequested) {
        await this.handleCancelled(
          task,
          taskRunLog._id.toString(),
          Date.now() - startedAt.getTime()
        );
        return;
      }
      await this.handleFailure({
        task,
        runLogId: taskRunLog._id.toString(),
        error: String(err),
        runLogStatus: "failed",
        durationMs: Date.now() - startedAt.getTime(),
      });
    }
  }

  /** One heartbeat: refresh the claim, then honor a pending cancel request. */
  private async beat(taskId: string, sessionId: string, entry: ActiveTaskRun): Promise<void> {
    const fresh = await heartbeatTask(taskId);
    if (fresh?.cancelRequested && !entry.cancelRequested) {
      entry.cancelRequested = true;
      logger.info(`Cancel requested for board task ${taskId}, aborting run`);
      await this.runner.stop(sessionId);
    }
  }

  /** Record a failed attempt; deliver a ❌ only when the failure is terminal. */
  private async handleFailure({
    task,
    runLogId,
    error,
    runLogStatus,
    durationMs,
  }: {
    task: AgentTaskDocument;
    runLogId: string;
    error: string;
    runLogStatus: "failed" | "timeout";
    durationMs: number;
  }): Promise<void> {
    const updated = await failTask(task._id.toString(), error);
    await this.updateRunLog(runLogId, runLogStatus, {error, durationMs});

    // Terminal failures of deliverResult tasks are always delivered — never silent.
    if (updated?.status === "failed" && task.deliverResult) {
      await this.deliver(task.groupId.toString(), `❌ ${task.title}: ${error}`);
    }
  }

  private async handleCancelled(
    task: AgentTaskDocument,
    runLogId: string,
    durationMs: number
  ): Promise<void> {
    await AgentTask.findByIdAndUpdate(task._id, {
      $set: {status: "cancelled", error: "Cancelled by request", completedAt: new Date()},
    });
    await this.updateRunLog(runLogId, "failed", {error: "Cancelled by request", durationMs});
    logger.info(`Board task "${task.title}" (${task._id}) cancelled`);
    if (task.deliverResult) {
      await this.deliver(task.groupId.toString(), `❌ ${task.title}: cancelled`);
    }
  }

  private async deliver(groupId: string, content: string): Promise<void> {
    try {
      await this.channelManager.sendMessageToGroup(groupId, content);
    } catch (err) {
      logger.error(`Failed to deliver board task result to group ${groupId}: ${err}`);
    }
  }

  private async updateRunLog(
    runLogId: string,
    status: string,
    extra: Record<string, unknown>
  ): Promise<void> {
    try {
      await TaskRunLog.findByIdAndUpdate(runLogId, {
        $set: {status, completedAt: new Date(), ...extra},
      });
    } catch (err) {
      logger.warn(`Failed to update task run log ${runLogId}: ${err}`);
    }
  }
}
