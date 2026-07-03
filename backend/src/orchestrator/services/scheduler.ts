import {logger} from "@terreno/api";
import {AgentTask} from "../../models/agentTask";
import {loadAppConfig} from "../../models/appConfig";
import {Group} from "../../models/group";
import {Message} from "../../models/message";
import {ScheduledTask} from "../../models/scheduledTask";
import type {GroupDocument, ScheduledTaskDocument} from "../../types";
import {logError} from "../errors";
import type {GroupQueue} from "../groupQueue";
import {computeNextRun} from "./scheduleMath";

const DEFAULT_MAX_SLEEP_MS = 5 * 60 * 1000;
const DEFAULT_MIN_SLEEP_MS = 5_000;

export interface SchedulerServiceOptions {
  /** Lower clamp for the adaptive sleep. Injectable so tests can use tiny real timeouts. */
  minSleepMs?: number;
}

/**
 * Executes scheduled tasks. Runs a self-re-arming setTimeout chain: after each
 * tick it queries the earliest `nextRunAt` over active tasks and sleeps
 * `clamp(nextRunAt - now, minSleep, pollIntervals.scheduler)` — so near-term
 * tasks ("remind me in 2 minutes") fire close to on time while an empty board
 * only wakes at the configured max interval. Each tick is a single Mongo
 * query — it consumes no model tokens unless a task is actually due. `wake()`
 * short-circuits the pending sleep when a task is created or resumed.
 */
export class SchedulerService {
  private timeoutId: ReturnType<typeof setTimeout> | null = null;
  private readonly groupQueue: GroupQueue;
  private readonly minSleepMs: number;
  private ticking = false;
  private running = false;
  /** True while a tick+re-arm cycle is executing (prevents overlapping chains). */
  private cycling = false;
  /** Set by wake() when a cycle is already in flight so the wake isn't lost. */
  private wakeRequested = false;

  constructor(groupQueue: GroupQueue, options: SchedulerServiceOptions = {}) {
    this.groupQueue = groupQueue;
    this.minSleepMs = options.minSleepMs ?? DEFAULT_MIN_SLEEP_MS;
  }

  async start(): Promise<void> {
    if (this.running) {
      return;
    }
    this.running = true;

    const appConfig = await loadAppConfig();
    const maxSleep = appConfig.pollIntervals.scheduler ?? DEFAULT_MAX_SLEEP_MS;
    logger.info(`Scheduler started (max interval: ${maxSleep}ms)`);

    // Run an immediate tick so tasks already due on boot don't wait a full
    // interval; the cycle then re-arms itself adaptively.
    void this.runCycle();
  }

  stop(): void {
    if (!this.running) {
      return;
    }
    this.running = false;
    this.wakeRequested = false;
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    logger.info("Scheduler stopped");
  }

  /**
   * Cancel the pending sleep and tick immediately. Called when a task is
   * created, resumed, or rescheduled so near-term tasks don't wait out the
   * current sleep. No-op when the scheduler isn't running. Safe during an
   * in-flight tick: the request is remembered and the cycle runs another
   * tick before re-arming instead of dropping the wake.
   */
  wake(): void {
    if (!this.running) {
      return;
    }
    this.wakeRequested = true;
    if (this.cycling) {
      // The running cycle checks wakeRequested after its tick and loops.
      return;
    }
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    void this.runCycle();
  }

  /**
   * One tick+re-arm cycle. Loops while wakes arrive mid-cycle, then computes
   * the adaptive sleep and arms the next timeout. Guarded so concurrent
   * wake()/timer callbacks never produce overlapping chains.
   */
  private async runCycle(): Promise<void> {
    if (this.cycling) {
      return;
    }
    this.cycling = true;
    try {
      while (this.running) {
        this.wakeRequested = false;
        try {
          await this.tick();
        } catch (err) {
          logError("Scheduler tick error", err);
        }
        if (!this.running) {
          return;
        }
        if (this.wakeRequested) {
          // A wake landed while we were ticking — run another tick now.
          continue;
        }

        const sleepMs = await this.computeSleepMs();
        if (this.wakeRequested) {
          // A wake landed while we were computing the sleep — tick again.
          continue;
        }
        if (!this.running) {
          return;
        }
        logger.debug(`Scheduler re-armed (sleeping ${sleepMs}ms)`);
        this.timeoutId = setTimeout(() => {
          this.timeoutId = null;
          void this.runCycle();
        }, sleepMs);
        return;
      }
    } finally {
      this.cycling = false;
    }
  }

  /**
   * Adaptive sleep: time until the earliest active nextRunAt, clamped to
   * [minSleepMs, pollIntervals.scheduler]. No active tasks (or none with a
   * nextRunAt yet) → the max. Public so tests can assert the computation
   * without arming real timers.
   */
  async computeSleepMs(): Promise<number> {
    const appConfig = await loadAppConfig();
    const maxSleep = appConfig.pollIntervals.scheduler ?? DEFAULT_MAX_SLEEP_MS;

    const [nextTask] = await ScheduledTask.find(
      {status: "active", nextRunAt: {$ne: null}},
      {nextRunAt: 1}
    )
      .sort({nextRunAt: 1})
      .limit(1);
    if (!nextTask?.nextRunAt) {
      return maxSleep;
    }

    const untilNext = nextTask.nextRunAt.getTime() - Date.now();
    return Math.min(Math.max(untilNext, this.minSleepMs), maxSleep);
  }

  /** One scheduler pass: find due active tasks and dispatch them. */
  async tick(): Promise<void> {
    if (this.ticking) {
      logger.debug("Scheduler tick already in progress, skipping");
      return;
    }
    this.ticking = true;

    try {
      const now = new Date();
      const tasks = await ScheduledTask.find({status: "active"});
      if (tasks.length === 0) {
        return;
      }

      let dispatched = 0;
      for (const task of tasks) {
        try {
          const fired = await this.evaluateTask(task, now);
          if (fired) {
            dispatched++;
          }
        } catch (err) {
          logError(`Scheduler error evaluating task "${task.name}" (${task._id})`, err);
        }
      }

      if (dispatched > 0) {
        logger.info(`Scheduler dispatched ${dispatched} due task(s)`);
      }
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Evaluate a single task: lazily initialize its nextRunAt, dispatch it if due,
   * and advance its schedule. Returns true when the task was dispatched.
   */
  private async evaluateTask(task: ScheduledTaskDocument, now: Date): Promise<boolean> {
    // Lazily compute nextRunAt for tasks created without one (the create paths
    // don't set it). An unparseable schedule cancels the task so it stops churning.
    if (!task.nextRunAt) {
      const next = computeNextRun({
        scheduleType: task.scheduleType,
        schedule: task.schedule,
        from: now,
      });
      if (!next) {
        logger.warn(
          `Scheduled task "${task.name}" (${task._id}) has an invalid ${task.scheduleType} schedule "${task.schedule}"; cancelling`
        );
        await ScheduledTask.findByIdAndUpdate(task._id, {$set: {status: "cancelled"}});
        return false;
      }
      await ScheduledTask.findByIdAndUpdate(task._id, {$set: {nextRunAt: next}});
      task.nextRunAt = next;
    }

    if (!task.nextRunAt || task.nextRunAt.getTime() > now.getTime()) {
      return false;
    }

    const dispatched = await this.dispatchTask(task);
    if (!dispatched) {
      // Group busy or unavailable — leave nextRunAt in the past to retry next tick.
      return false;
    }

    const runCount = (task.runCount ?? 0) + 1;
    const reachedMax = typeof task.maxRuns === "number" && runCount >= task.maxRuns;

    if (task.scheduleType === "once" || reachedMax) {
      await ScheduledTask.findByIdAndUpdate(task._id, {
        $set: {status: "completed", lastRunAt: new Date(), runCount},
        $unset: {nextRunAt: ""},
      });
      return true;
    }

    const next = computeNextRun({
      scheduleType: task.scheduleType,
      schedule: task.schedule,
      from: new Date(),
    });
    await ScheduledTask.findByIdAndUpdate(task._id, {
      $set: {lastRunAt: new Date(), runCount, ...(next ? {nextRunAt: next} : {})},
      ...(next ? {} : {$unset: {nextRunAt: ""}}),
    });
    return true;
  }

  /**
   * Dispatch a due task to its group. Cancels the task when its group is gone,
   * then routes by `scheduler.useTaskBoard`: flag on → create an AgentTask on
   * the board; flag off (default) → inject a synthetic trigger message into
   * the GroupQueue. Returns false (to retry next tick) when dispatch couldn't
   * happen; bookkeeping in evaluateTask is shared by both paths.
   */
  private async dispatchTask(task: ScheduledTaskDocument): Promise<boolean> {
    const group = await Group.findById(task.groupId);
    if (!group) {
      logger.warn(
        `Scheduled task "${task.name}" (${task._id}) targets missing group ${task.groupId}; cancelling`
      );
      await ScheduledTask.findByIdAndUpdate(task._id, {$set: {status: "cancelled"}});
      return false;
    }

    const appConfig = await loadAppConfig();
    if (appConfig.scheduler?.useTaskBoard === true) {
      return this.dispatchToBoard(task, group);
    }
    return this.dispatchToQueue(task, group);
  }

  /**
   * Board dispatch: create a pending AgentTask for the task worker to claim.
   * deliverResult is set so the run's output reaches the group's channel, and
   * scheduledTaskId preserves lineage back to the ScheduledTask.
   */
  private async dispatchToBoard(
    task: ScheduledTaskDocument,
    group: GroupDocument
  ): Promise<boolean> {
    await AgentTask.create({
      groupId: task.groupId,
      title: task.name,
      prompt: task.prompt,
      deliverResult: true,
      scheduledTaskId: task._id,
    });
    logger.info(`Scheduler created board task for "${task.name}" (group ${group.name})`);
    return true;
  }

  /**
   * Queue dispatch: inject a synthetic trigger message into the group and
   * enqueue it on the GroupQueue. processedAt is pre-set so the message loop
   * doesn't also pick it up. Returns false (to retry next tick) when the
   * group is busy.
   */
  private async dispatchToQueue(
    task: ScheduledTaskDocument,
    group: GroupDocument
  ): Promise<boolean> {
    if (this.groupQueue.isGroupActive(group._id.toString())) {
      logger.info(`Scheduled task "${task.name}" deferred — group ${group.name} is busy`);
      return false;
    }

    const message = await Message.create({
      groupId: group._id,
      channelId: group.channelId,
      sender: `Scheduler (${task.name})`,
      senderExternalId: "scheduler",
      content: task.prompt,
      isFromBot: false,
      processedAt: new Date(),
      metadata: {scheduledTaskId: task._id.toString(), scheduled: true},
    });

    this.groupQueue.enqueue(group, message);
    logger.info(`Scheduler dispatched task "${task.name}" to group ${group.name}`);
    return true;
  }
}

/**
 * Process-wide wake registry. Task-mutating code paths (the IPC handlers that
 * create/resume/reschedule ScheduledTasks) call `wakeScheduler()` without
 * needing a scheduler reference. The gateway registers its scheduler on start;
 * processes without one (dedicated task workers, tests) get a safe no-op — the
 * gateway's adaptive sleep still picks those tasks up within one max interval.
 */
let registeredScheduler: SchedulerService | null = null;

export const registerSchedulerForWake = (scheduler: SchedulerService | null): void => {
  registeredScheduler = scheduler;
};

export const wakeScheduler = (): void => {
  registeredScheduler?.wake();
};
