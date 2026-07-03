import {afterEach, describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import {AgentTask} from "../../models/agentTask";
import {
  claimNextTask,
  completeTask,
  failTask,
  getWorkerId,
  heartbeatTask,
  reclaimStaleTasks,
} from "./taskBoard";

// Group refs are plain ObjectIds — no Group/Channel docs are created here.
// Every AgentTask created is deleted in afterEach so tests stay
// order-independent and leave nothing behind for other files to claim.
const createdTaskIds: mongoose.Types.ObjectId[] = [];

const makeTask = async (overrides: Record<string, unknown> = {}) => {
  const doc = await AgentTask.create({
    groupId: new mongoose.Types.ObjectId(),
    title: "Board test task",
    prompt: "Do the thing",
    ...overrides,
  });
  createdTaskIds.push(doc._id);
  return doc;
};

afterEach(async () => {
  if (createdTaskIds.length > 0) {
    await AgentTask.deleteMany({_id: {$in: createdTaskIds}});
    createdTaskIds.length = 0;
  }
});

describe("getWorkerId", () => {
  test("returns hostname:pid", () => {
    const workerId = getWorkerId();
    expect(workerId).toMatch(/^.+:\d+$/);
    expect(workerId.endsWith(`:${process.pid}`)).toBe(true);
  });
});

describe("claimNextTask", () => {
  test("returns null when the board has no pending tasks", async () => {
    // Non-pending tasks must not be claimable.
    await makeTask({status: "completed", result: "done"});
    const claimed = await claimNextTask("worker-a");
    expect(claimed).toBeNull();
  });

  test("claims by priority desc then created asc, and sequential claims get different tasks", async () => {
    const oldLow = await makeTask({
      title: "old low priority",
      created: new Date(Date.now() - 3000),
    });
    const newLow = await makeTask({
      title: "new low priority",
      created: new Date(Date.now() - 1000),
    });
    const highPriority = await makeTask({
      title: "high priority",
      priority: 5,
      created: new Date(Date.now() - 500),
    });

    const first = await claimNextTask("worker-a");
    const second = await claimNextTask("worker-b");
    const third = await claimNextTask("worker-a");
    const fourth = await claimNextTask("worker-a");

    expect(first?._id.toString()).toBe(highPriority._id.toString());
    expect(second?._id.toString()).toBe(oldLow._id.toString());
    expect(third?._id.toString()).toBe(newLow._id.toString());
    expect(fourth).toBeNull();
  });

  test("stamps claim state and increments attempts", async () => {
    const task = await makeTask();
    const claimed = await claimNextTask("worker-a");

    expect(claimed?._id.toString()).toBe(task._id.toString());
    expect(claimed?.status).toBe("claimed");
    expect(claimed?.workerId).toBe("worker-a");
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.claimedAt).toBeInstanceOf(Date);
    expect(claimed?.heartbeatAt).toBeInstanceOf(Date);
  });
});

describe("heartbeatTask", () => {
  test("updates heartbeatAt and returns the task so cancelRequested is visible", async () => {
    const task = await makeTask({
      status: "running",
      workerId: "worker-a",
      attempts: 1,
      heartbeatAt: new Date(Date.now() - 30000),
      cancelRequested: true,
    });

    const before = Date.now();
    const beat = await heartbeatTask(task._id.toString());

    expect(beat?.heartbeatAt).toBeInstanceOf(Date);
    expect(beat!.heartbeatAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(beat?.cancelRequested).toBe(true);
  });
});

describe("completeTask", () => {
  test("marks the task completed with a result", async () => {
    const task = await makeTask({status: "running", workerId: "worker-a", attempts: 1});

    const completed = await completeTask(task._id.toString(), "all done");
    expect(completed?.status).toBe("completed");
    expect(completed?.result).toBe("all done");
    expect(completed?.completedAt).toBeInstanceOf(Date);
  });
});

describe("failTask", () => {
  test("requeues when attempts remain, clearing claim state, then fails when exhausted", async () => {
    await makeTask({maxAttempts: 2});

    // Attempt 1: claim then fail — should requeue.
    const firstClaim = await claimNextTask("worker-a");
    expect(firstClaim?.attempts).toBe(1);
    const requeued = await failTask(firstClaim!._id.toString(), "boom");
    expect(requeued?.status).toBe("pending");
    expect(requeued?.error).toBe("boom");
    expect(requeued?.workerId).toBeUndefined();
    expect(requeued?.claimedAt).toBeUndefined();
    expect(requeued?.heartbeatAt).toBeUndefined();

    // Attempt 2: claim again (attempts=2) then fail — budget exhausted.
    const secondClaim = await claimNextTask("worker-b");
    expect(secondClaim?._id.toString()).toBe(firstClaim?._id.toString());
    expect(secondClaim?.attempts).toBe(2);
    const failed = await failTask(secondClaim!._id.toString(), "boom again");
    expect(failed?.status).toBe("failed");
    expect(failed?.error).toBe("boom again");
    expect(failed?.completedAt).toBeInstanceOf(Date);
  });

  test("does not touch tasks already in a terminal state", async () => {
    const task = await makeTask({status: "completed", result: "done", attempts: 1});
    const result = await failTask(task._id.toString(), "late failure");
    expect(result).toBeNull();

    const reloaded = await AgentTask.findExactlyOne({_id: task._id});
    expect(reloaded.status).toBe("completed");
    expect(reloaded.result).toBe("done");
  });
});

describe("reclaimStaleTasks", () => {
  test("requeues stale tasks with retry budget and fails exhausted ones, without extra attempt increments", async () => {
    const staleWithBudget = await makeTask({
      status: "claimed",
      workerId: "dead-worker",
      attempts: 1,
      maxAttempts: 2,
      claimedAt: new Date(Date.now() - 120000),
      heartbeatAt: new Date(Date.now() - 120000),
    });
    const staleExhausted = await makeTask({
      status: "running",
      workerId: "dead-worker",
      attempts: 2,
      maxAttempts: 2,
      claimedAt: new Date(Date.now() - 120000),
      heartbeatAt: new Date(Date.now() - 120000),
    });
    const freshTask = await makeTask({
      status: "running",
      workerId: "live-worker",
      attempts: 1,
      heartbeatAt: new Date(),
    });

    const count = await reclaimStaleTasks(60000);
    expect(count).toBe(2);

    const requeued = await AgentTask.findExactlyOne({_id: staleWithBudget._id});
    expect(requeued.status).toBe("pending");
    // Attempts increment on claim, not on reclaim.
    expect(requeued.attempts).toBe(1);
    expect(requeued.workerId).toBeUndefined();
    expect(requeued.heartbeatAt).toBeUndefined();

    const failed = await AgentTask.findExactlyOne({_id: staleExhausted._id});
    expect(failed.status).toBe("failed");
    expect(failed.attempts).toBe(2);
    expect(failed.error).toContain("dead-worker");

    const untouched = await AgentTask.findExactlyOne({_id: freshTask._id});
    expect(untouched.status).toBe("running");
    expect(untouched.workerId).toBe("live-worker");
  });

  test("returns 0 when nothing is stale", async () => {
    await makeTask();
    const count = await reclaimStaleTasks(60000);
    expect(count).toBe(0);
  });
});
