import os from "node:os";
import {logger} from "@terreno/api";
import {AgentTask} from "../../models/agentTask";
import type {AgentTaskDocument} from "../../types";

/**
 * Claim/heartbeat/complete/retry/reclaim primitives for the AgentTask board.
 * Mongo is the queue: claiming is a single atomic findOneAndUpdate, so any
 * number of workers (in-process today, remote in IP-010) can share the board
 * without extra locking.
 *
 * Attempt accounting: `attempts` is incremented at CLAIM time — the field
 * always reads "how many runs have been started", and the attempt currently
 * in flight is attempt number `attempts`. Failure paths (failTask,
 * reclaimStaleTasks) therefore never increment; they only decide between
 * requeue (attempts < maxAttempts) and terminal failure.
 */

/** Identity of this worker process, used to stamp claims. */
export const getWorkerId = (): string => {
  return `${os.hostname()}:${process.pid}`;
};

/**
 * Atomically claim the highest-priority, oldest pending task for this worker.
 * Increments `attempts` (claim-time accounting — see module doc). Returns
 * null when the board has no pending work.
 */
export const claimNextTask = async (workerId: string): Promise<AgentTaskDocument | null> => {
  const now = new Date();
  const task = await AgentTask.findOneAndUpdate(
    {status: "pending"},
    {
      $set: {status: "claimed", workerId, claimedAt: now, heartbeatAt: now},
      $inc: {attempts: 1},
    },
    {sort: {priority: -1, created: 1}, new: true}
  );

  if (task) {
    logger.info(
      `Claimed board task "${task.title}" (${task._id}) for worker ${workerId} (attempt ${task.attempts}/${task.maxAttempts})`
    );
  }
  return task;
};

/**
 * Refresh the task's heartbeat and return the updated document so the caller
 * can check `cancelRequested` between beats.
 */
export const heartbeatTask = async (taskId: string): Promise<AgentTaskDocument | null> => {
  return AgentTask.findByIdAndUpdate(taskId, {$set: {heartbeatAt: new Date()}}, {new: true});
};

/** Mark a task completed and record its result. */
export const completeTask = async (
  taskId: string,
  result: string
): Promise<AgentTaskDocument | null> => {
  const task = await AgentTask.findByIdAndUpdate(
    taskId,
    {$set: {status: "completed", completedAt: new Date(), result}},
    {new: true}
  );
  if (task) {
    logger.info(`Board task "${task.title}" (${task._id}) completed`);
  }
  return task;
};

/**
 * Record a failed attempt. If the retry budget isn't exhausted the task goes
 * back to `pending` (worker/claim/heartbeat state cleared so any worker can
 * re-claim it); otherwise it lands in `failed` with the error recorded. Only
 * acts on tasks currently `claimed` or `running` — a task that already
 * reached a terminal state (completed/cancelled) is left untouched.
 */
export const failTask = async (
  taskId: string,
  error: string
): Promise<AgentTaskDocument | null> => {
  const task = await AgentTask.findOneOrNone({
    _id: taskId,
    status: {$in: ["claimed", "running"]},
  });
  if (!task) {
    logger.debug(`failTask: task ${taskId} is not claimed/running, skipping`);
    return null;
  }

  if (task.attempts < task.maxAttempts) {
    const updated = await AgentTask.findByIdAndUpdate(
      taskId,
      {
        $set: {status: "pending", error},
        $unset: {workerId: "", claimedAt: "", heartbeatAt: "", startedAt: ""},
      },
      {new: true}
    );
    logger.info(
      `Board task "${task.title}" (${task._id}) failed attempt ${task.attempts}/${task.maxAttempts}, requeued: ${error.substring(0, 200)}`
    );
    return updated;
  }

  const updated = await AgentTask.findByIdAndUpdate(
    taskId,
    {$set: {status: "failed", error, completedAt: new Date()}},
    {new: true}
  );
  logger.info(
    `Board task "${task.title}" (${task._id}) failed permanently after ${task.attempts} attempt(s): ${error.substring(0, 200)}`
  );
  return updated;
};

/**
 * Sweep for claimed/running tasks whose heartbeat is older than `staleMs`
 * (worker died mid-run). Each stale task is requeued when it still has retry
 * budget, otherwise failed. Returns the number of tasks processed.
 */
export const reclaimStaleTasks = async (staleMs: number): Promise<number> => {
  const cutoff = new Date(Date.now() - staleMs);
  const staleTasks = await AgentTask.find({
    status: {$in: ["claimed", "running"]},
    heartbeatAt: {$lt: cutoff},
  });

  let count = 0;
  for (const task of staleTasks) {
    const staleError = `Reclaimed from worker ${task.workerId ?? "unknown"}: heartbeat stale since ${task.heartbeatAt?.toISOString() ?? "never"}`;
    if (task.attempts < task.maxAttempts) {
      await AgentTask.findByIdAndUpdate(task._id, {
        $set: {status: "pending", error: staleError},
        $unset: {workerId: "", claimedAt: "", heartbeatAt: "", startedAt: ""},
      });
      logger.warn(
        `Reclaimed stale board task "${task.title}" (${task._id}) from worker ${task.workerId}; requeued (attempt ${task.attempts}/${task.maxAttempts})`
      );
    } else {
      await AgentTask.findByIdAndUpdate(task._id, {
        $set: {status: "failed", error: staleError, completedAt: new Date()},
      });
      logger.warn(
        `Stale board task "${task.title}" (${task._id}) exhausted its ${task.maxAttempts} attempt(s); marked failed`
      );
    }
    count++;
  }
  return count;
};
