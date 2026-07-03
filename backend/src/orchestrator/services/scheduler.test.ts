import {afterEach, describe, expect, mock, test} from "bun:test";
import mongoose from "mongoose";
import {AgentTask} from "../../models/agentTask";
import {AppConfig, loadAppConfig, reloadAppConfig} from "../../models/appConfig";
import {Group} from "../../models/group";
import {Message} from "../../models/message";
import {ScheduledTask} from "../../models/scheduledTask";
import type {GroupQueue} from "../groupQueue";
import {registerSchedulerForWake, SchedulerService, wakeScheduler} from "./scheduler";

// The `scheduler.useTaskBoard` AppConfig field ships separately (IP-010 Task
// 2.1 config half). Flag-on tests are skipped until the schema field exists —
// AppConfig uses strict:"throw", so setting an unknown path would error.
const hasUseTaskBoardField = AppConfig.schema.path("scheduler.useTaskBoard") !== undefined;

const createdGroupIds: mongoose.Types.ObjectId[] = [];
const createdScheduledTaskIds: mongoose.Types.ObjectId[] = [];

const makeGroup = async (overrides: Record<string, unknown> = {}) => {
  const group = await Group.create({
    name: "Scheduler Test Group",
    folder: `scheduler-test-${new mongoose.Types.ObjectId().toString()}`,
    channelId: new mongoose.Types.ObjectId(),
    externalId: `scheduler-test-${Date.now()}-${Math.random()}`,
    ...overrides,
  });
  createdGroupIds.push(group._id);
  return group;
};

const makeScheduledTask = async (
  groupId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {}
) => {
  const task = await ScheduledTask.create({
    groupId,
    name: "Daily digest",
    prompt: "Summarize the day",
    scheduleType: "interval",
    schedule: "5m",
    nextRunAt: new Date(Date.now() - 1000),
    ...overrides,
  });
  createdScheduledTaskIds.push(task._id);
  return task;
};

const makeQueue = (isGroupActive = false) => ({
  isGroupActive: mock(() => isGroupActive),
  enqueue: mock(() => {}),
});

const makeScheduler = (queue: ReturnType<typeof makeQueue>) => {
  return new SchedulerService(queue as unknown as GroupQueue);
};

const setUseTaskBoard = async (value: boolean) => {
  await AppConfig.findOneAndUpdate({}, {$set: {"scheduler.useTaskBoard": value}});
  await reloadAppConfig();
};

let originalSchedulerInterval: number | null = null;

const setSchedulerInterval = async (ms: number) => {
  if (originalSchedulerInterval === null) {
    const config = await loadAppConfig();
    originalSchedulerInterval = config.pollIntervals.scheduler;
  }
  await AppConfig.findOneAndUpdate({}, {$set: {"pollIntervals.scheduler": ms}});
  await reloadAppConfig();
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Poll a predicate with real (small) timers — bun's fake timers only cover Date. */
const waitFor = async (
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000
): Promise<boolean> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) {
      return true;
    }
    await sleep(25);
  }
  return predicate();
};

afterEach(async () => {
  registerSchedulerForWake(null);
  if (hasUseTaskBoardField) {
    await AppConfig.findOneAndUpdate({}, {$set: {"scheduler.useTaskBoard": false}});
  }
  if (originalSchedulerInterval !== null) {
    await AppConfig.findOneAndUpdate(
      {},
      {$set: {"pollIntervals.scheduler": originalSchedulerInterval}}
    );
    originalSchedulerInterval = null;
  }
  await reloadAppConfig();

  if (createdGroupIds.length > 0) {
    await Message.deleteMany({groupId: {$in: createdGroupIds}});
    await AgentTask.deleteMany({groupId: {$in: createdGroupIds}});
    await Group.deleteMany({_id: {$in: createdGroupIds}});
    createdGroupIds.length = 0;
  }
  if (createdScheduledTaskIds.length > 0) {
    await ScheduledTask.deleteMany({_id: {$in: createdScheduledTaskIds}});
    createdScheduledTaskIds.length = 0;
  }
});

describe("SchedulerService", () => {
  describe("flag off (default)", () => {
    test("due task dispatches a synthetic message and updates bookkeeping", async () => {
      await loadAppConfig();
      const group = await makeGroup();
      const task = await makeScheduledTask(group._id);
      const queue = makeQueue();
      const scheduler = makeScheduler(queue);

      await scheduler.tick();

      const messages = await Message.find({groupId: group._id});
      expect(messages.length).toBe(1);
      expect(messages[0].sender).toBe("Scheduler (Daily digest)");
      expect(messages[0].senderExternalId).toBe("scheduler");
      expect(messages[0].content).toBe("Summarize the day");
      expect(messages[0].processedAt).toBeInstanceOf(Date);

      expect(queue.enqueue).toHaveBeenCalledTimes(1);

      // No board task in the legacy path.
      expect(await AgentTask.countDocuments({groupId: group._id})).toBe(0);

      const reloaded = await ScheduledTask.findExactlyOne({_id: task._id});
      expect(reloaded.status).toBe("active");
      expect(reloaded.runCount).toBe(1);
      expect(reloaded.lastRunAt).toBeInstanceOf(Date);
      expect(reloaded.nextRunAt?.getTime()).toBeGreaterThan(Date.now());
    });

    test("once task completes after dispatch", async () => {
      const group = await makeGroup();
      const task = await makeScheduledTask(group._id, {
        scheduleType: "once",
        schedule: new Date(Date.now() - 1000).toISOString(),
      });
      const queue = makeQueue();
      const scheduler = makeScheduler(queue);

      await scheduler.tick();

      expect(queue.enqueue).toHaveBeenCalledTimes(1);
      const reloaded = await ScheduledTask.findExactlyOne({_id: task._id});
      expect(reloaded.status).toBe("completed");
      expect(reloaded.runCount).toBe(1);
      expect(reloaded.nextRunAt).toBeUndefined();
    });

    test("busy group defers the task without bookkeeping changes", async () => {
      const group = await makeGroup();
      const task = await makeScheduledTask(group._id);
      const originalNextRunAt = task.nextRunAt;
      const queue = makeQueue(true);
      const scheduler = makeScheduler(queue);

      await scheduler.tick();

      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(await Message.countDocuments({groupId: group._id})).toBe(0);

      const reloaded = await ScheduledTask.findExactlyOne({_id: task._id});
      expect(reloaded.status).toBe("active");
      expect(reloaded.runCount).toBe(0);
      expect(reloaded.lastRunAt).toBeUndefined();
      expect(reloaded.nextRunAt?.getTime()).toBe(originalNextRunAt?.getTime());
    });

    test("missing group cancels the task", async () => {
      const orphanGroupId = new mongoose.Types.ObjectId();
      const task = await makeScheduledTask(orphanGroupId);
      const queue = makeQueue();
      const scheduler = makeScheduler(queue);

      await scheduler.tick();

      expect(queue.enqueue).not.toHaveBeenCalled();
      const reloaded = await ScheduledTask.findExactlyOne({_id: task._id});
      expect(reloaded.status).toBe("cancelled");
      expect(reloaded.runCount).toBe(0);
    });
  });

  describe("flag on (scheduler.useTaskBoard)", () => {
    test.skipIf(!hasUseTaskBoardField)(
      "due task creates an AgentTask instead of a synthetic message",
      async () => {
        await setUseTaskBoard(true);
        const group = await makeGroup();
        const task = await makeScheduledTask(group._id);
        const queue = makeQueue();
        const scheduler = makeScheduler(queue);

        await scheduler.tick();

        const boardTasks = await AgentTask.find({groupId: group._id});
        expect(boardTasks.length).toBe(1);
        expect(boardTasks[0].title).toBe("Daily digest");
        expect(boardTasks[0].prompt).toBe("Summarize the day");
        expect(boardTasks[0].status).toBe("pending");
        expect(boardTasks[0].deliverResult).toBe(true);
        expect(boardTasks[0].scheduledTaskId?.toString()).toBe(task._id.toString());

        // No synthetic message and no queue dispatch in board mode.
        expect(await Message.countDocuments({groupId: group._id})).toBe(0);
        expect(queue.enqueue).not.toHaveBeenCalled();

        const reloaded = await ScheduledTask.findExactlyOne({_id: task._id});
        expect(reloaded.status).toBe("active");
        expect(reloaded.runCount).toBe(1);
        expect(reloaded.lastRunAt).toBeInstanceOf(Date);
        expect(reloaded.nextRunAt?.getTime()).toBeGreaterThan(Date.now());
      }
    );

    test.skipIf(!hasUseTaskBoardField)("once task completes after board dispatch", async () => {
      await setUseTaskBoard(true);
      const group = await makeGroup();
      const task = await makeScheduledTask(group._id, {
        scheduleType: "once",
        schedule: new Date(Date.now() - 1000).toISOString(),
      });
      const queue = makeQueue();
      const scheduler = makeScheduler(queue);

      await scheduler.tick();

      expect(await AgentTask.countDocuments({groupId: group._id})).toBe(1);
      const reloaded = await ScheduledTask.findExactlyOne({_id: task._id});
      expect(reloaded.status).toBe("completed");
      expect(reloaded.runCount).toBe(1);
      expect(reloaded.nextRunAt).toBeUndefined();
    });

    test.skipIf(!hasUseTaskBoardField)("board dispatch ignores group-queue busyness", async () => {
      await setUseTaskBoard(true);
      const group = await makeGroup();
      const task = await makeScheduledTask(group._id);
      const queue = makeQueue(true);
      const scheduler = makeScheduler(queue);

      await scheduler.tick();

      expect(await AgentTask.countDocuments({groupId: group._id})).toBe(1);
      expect(queue.enqueue).not.toHaveBeenCalled();
      const reloaded = await ScheduledTask.findExactlyOne({_id: task._id});
      expect(reloaded.runCount).toBe(1);
    });
  });

  describe("adaptive tick", () => {
    test("near-term task shortens the computed sleep", async () => {
      await setSchedulerInterval(60_000);
      const group = await makeGroup();
      await makeScheduledTask(group._id, {nextRunAt: new Date(Date.now() + 10_000)});
      const scheduler = makeScheduler(makeQueue());

      const sleepMs = await scheduler.computeSleepMs();

      expect(sleepMs).toBeGreaterThan(5_000);
      expect(sleepMs).toBeLessThanOrEqual(10_000);
    });

    test("empty board sleeps the configured max", async () => {
      await setSchedulerInterval(60_000);
      const scheduler = makeScheduler(makeQueue());

      expect(await scheduler.computeSleepMs()).toBe(60_000);
    });

    test("past-due task clamps the sleep to the minimum", async () => {
      await setSchedulerInterval(60_000);
      const group = await makeGroup();
      await makeScheduledTask(group._id); // nextRunAt in the past
      const scheduler = makeScheduler(makeQueue());

      expect(await scheduler.computeSleepMs()).toBe(5_000);
    });

    test("a max interval below the minimum clamp wins", async () => {
      await setSchedulerInterval(200);
      const group = await makeGroup();
      await makeScheduledTask(group._id); // nextRunAt in the past
      const scheduler = makeScheduler(makeQueue());

      expect(await scheduler.computeSleepMs()).toBe(200);
    });

    test("wake() triggers an immediate tick instead of waiting out the sleep", async () => {
      await setSchedulerInterval(60_000);
      const queue = makeQueue();
      const scheduler = makeScheduler(queue);

      try {
        await scheduler.start();
        // Let the boot tick settle so the scheduler is asleep for 60s.
        await sleep(50);
        const group = await makeGroup();
        await makeScheduledTask(group._id); // due now

        scheduler.wake();

        const fired = await waitFor(() => queue.enqueue.mock.calls.length > 0);
        expect(fired).toBe(true);
      } finally {
        scheduler.stop();
      }
    });

    test("wakeScheduler() no-ops unregistered and wakes the registered scheduler", async () => {
      // Nothing registered — must be a safe no-op (worker processes hit this path).
      expect(() => wakeScheduler()).not.toThrow();

      await setSchedulerInterval(60_000);
      const queue = makeQueue();
      const scheduler = makeScheduler(queue);
      registerSchedulerForWake(scheduler);

      try {
        await scheduler.start();
        await sleep(50);
        const group = await makeGroup();
        await makeScheduledTask(group._id); // due now

        wakeScheduler();

        const fired = await waitFor(() => queue.enqueue.mock.calls.length > 0);
        expect(fired).toBe(true);
      } finally {
        registerSchedulerForWake(null);
        scheduler.stop();
      }
    });

    test("wake() while stopped is a no-op", async () => {
      const queue = makeQueue();
      const scheduler = makeScheduler(queue);
      const group = await makeGroup();
      await makeScheduledTask(group._id); // due now

      scheduler.wake(); // never started

      await sleep(150);
      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(await Message.countDocuments({groupId: group._id})).toBe(0);
    });

    test("stop() cancels the pending timeout", async () => {
      await setSchedulerInterval(100);
      const queue = makeQueue();
      const scheduler = makeScheduler(queue);

      await scheduler.start();
      scheduler.stop();
      // Let any in-flight boot tick drain before creating the task.
      await sleep(50);
      const group = await makeGroup();
      await makeScheduledTask(group._id); // due now

      await sleep(350); // several would-be 100ms intervals
      expect(queue.enqueue).not.toHaveBeenCalled();
      expect(await Message.countDocuments({groupId: group._id})).toBe(0);
    });

    test("a near-term once task fires without waiting for the max interval", async () => {
      await setSchedulerInterval(60_000);
      const queue = makeQueue();
      // Injected min sleep keeps the test fast; production default is 5s.
      const scheduler = new SchedulerService(queue as unknown as GroupQueue, {minSleepMs: 25});
      const group = await makeGroup();
      const due = new Date(Date.now() + 500);
      const task = await makeScheduledTask(group._id, {
        scheduleType: "once",
        schedule: due.toISOString(),
        nextRunAt: due,
      });

      try {
        await scheduler.start();

        const fired = await waitFor(async () => {
          const reloaded = await ScheduledTask.findExactlyOne({_id: task._id});
          return reloaded.status === "completed";
        });
        expect(fired).toBe(true);
        expect(queue.enqueue).toHaveBeenCalledTimes(1);
      } finally {
        scheduler.stop();
      }
    });
  });
});
