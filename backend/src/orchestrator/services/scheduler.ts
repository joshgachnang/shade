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

const DEFAULT_TICK_MS = 5 * 60 * 1000;

/**
 * Executes scheduled tasks. On each tick it queries active tasks and dispatches
 * any that are due to the group's agent runner (via the same GroupQueue used by
 * inbound chat messages). The tick itself is a single Mongo query — it consumes
 * no model tokens unless a task is actually due.
 */
export class SchedulerService {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private readonly groupQueue: GroupQueue;
  private ticking = false;

  constructor(groupQueue: GroupQueue) {
    this.groupQueue = groupQueue;
  }

  async start(): Promise<void> {
    if (this.intervalId) {
      return;
    }

    const appConfig = await loadAppConfig();
    const interval = appConfig.pollIntervals.scheduler ?? DEFAULT_TICK_MS;

    // Run an immediate tick so tasks already due on boot don't wait a full interval.
    this.tick().catch((err) => logError("Scheduler initial tick error", err));

    this.intervalId = setInterval(() => {
      this.tick().catch((err) => {
        logger.error(`Scheduler tick error: ${err}`);
      });
    }, interval);

    logger.info(`Scheduler started (interval: ${interval}ms)`);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.info("Scheduler stopped");
    }
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
