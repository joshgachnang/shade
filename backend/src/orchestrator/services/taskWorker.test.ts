import {afterEach, beforeEach, describe, expect, mock, test} from "bun:test";
import fs from "node:fs/promises";
import path from "node:path";
import mongoose from "mongoose";
import {paths} from "../../config";
import {AgentTask} from "../../models/agentTask";
import {AppConfig, loadAppConfig, reloadAppConfig} from "../../models/appConfig";
import {Group} from "../../models/group";
import {TaskRunLog} from "../../models/taskRunLog";
import type {ChannelManager} from "../channels/manager";
import type {AgentRunner, AgentRunResult} from "../runners/types";
import {TaskWorkerService} from "./taskWorker";

const tmpDir = path.join(process.cwd(), `tmp-test-task-worker-${Date.now()}`);
const originalGroupsPath = paths.groups;

const createdGroupIds: mongoose.Types.ObjectId[] = [];
const createdTaskIds: mongoose.Types.ObjectId[] = [];

const makeGroup = async (overrides: Record<string, unknown> = {}) => {
  const group = await Group.create({
    name: "Task Worker Test Group",
    folder: `task-worker-test-${new mongoose.Types.ObjectId().toString()}`,
    channelId: new mongoose.Types.ObjectId(),
    externalId: `task-worker-test-${Date.now()}-${Math.random()}`,
    ...overrides,
  });
  createdGroupIds.push(group._id);
  return group;
};

const makeTask = async (
  groupId: mongoose.Types.ObjectId,
  overrides: Record<string, unknown> = {}
) => {
  const task = await AgentTask.create({
    groupId,
    title: "Background research",
    prompt: "Research the thing",
    ...overrides,
  });
  createdTaskIds.push(task._id);
  return task;
};

const completedResult = (output = "Research complete"): AgentRunResult => ({
  output,
  sessionId: "stub-session",
  durationMs: 42,
  status: "completed",
});

const makeRunner = (run: (...args: any[]) => Promise<AgentRunResult>) => {
  return {
    run: mock(run),
    stop: mock(() => Promise.resolve()),
    isRunning: mock(() => false),
    sendFollowUp: mock(() => Promise.resolve()),
  };
};

const makeChannelManager = () => ({
  sendMessageToGroup: mock((_groupId: string, _content: string) => Promise.resolve()),
});

const makeWorker = (
  runner: ReturnType<typeof makeRunner>,
  channelManager: ReturnType<typeof makeChannelManager>
) => {
  return new TaskWorkerService({
    runner: runner as unknown as AgentRunner,
    channelManager: channelManager as unknown as ChannelManager,
  });
};

beforeEach(async () => {
  await fs.mkdir(tmpDir, {recursive: true});
  paths.groups = tmpDir;
  await loadAppConfig();
});

afterEach(async () => {
  paths.groups = originalGroupsPath;
  await fs.rm(tmpDir, {recursive: true, force: true});
  if (createdGroupIds.length > 0) {
    await TaskRunLog.deleteMany({groupId: {$in: createdGroupIds}});
    await Group.deleteMany({_id: {$in: createdGroupIds}});
    createdGroupIds.length = 0;
  }
  if (createdTaskIds.length > 0) {
    await AgentTask.deleteMany({_id: {$in: createdTaskIds}});
    createdTaskIds.length = 0;
  }
});

describe("TaskWorkerService", () => {
  test("happy path: tick claims, runs, completes the task, and writes a TaskRunLog", async () => {
    const group = await makeGroup();
    const task = await makeTask(group._id);
    const runner = makeRunner(async () => completedResult());
    const channelManager = makeChannelManager();
    const worker = makeWorker(runner, channelManager);

    await worker.tick();
    await worker.waitForActiveRuns();

    const reloaded = await AgentTask.findExactlyOne({_id: task._id});
    expect(reloaded.status).toBe("completed");
    expect(reloaded.result).toBe("Research complete");
    expect(reloaded.attempts).toBe(1);
    expect(reloaded.startedAt).toBeInstanceOf(Date);
    expect(reloaded.completedAt).toBeInstanceOf(Date);

    expect(runner.run).toHaveBeenCalledTimes(1);
    const runConfig = runner.run.mock.calls[0][0];
    expect(runConfig.groupId).toBe(group._id.toString());
    expect(runConfig.prompt).toBe("Research the thing");
    expect(runConfig.systemPrompt).toBeTruthy();
    expect(runConfig.isBoardTask).toBe(true);
    expect(runConfig.timeout).toBe(900000);
    expect(runConfig.sessionId).toContain(`board-${task._id.toString()}`);

    const runLogs = await TaskRunLog.find({groupId: group._id, trigger: "delegated"});
    expect(runLogs.length).toBe(1);
    expect(runLogs[0].status).toBe("completed");
    expect(runLogs[0].result).toBe("Research complete");
    expect(runLogs[0].durationMs).toBe(42);
    expect(runLogs[0].classification).toBe("internal");

    // deliverResult defaults to false — nothing should be sent to the channel.
    expect(channelManager.sendMessageToGroup).not.toHaveBeenCalled();
  });

  test("deliverResult=true sends a ✅ message through the channel manager on completion", async () => {
    const group = await makeGroup();
    await makeTask(group._id, {deliverResult: true});
    const runner = makeRunner(async () => completedResult("Found 3 articles"));
    const channelManager = makeChannelManager();
    const worker = makeWorker(runner, channelManager);

    await worker.tick();
    await worker.waitForActiveRuns();

    expect(channelManager.sendMessageToGroup).toHaveBeenCalledTimes(1);
    const [sentGroupId, sentContent] = channelManager.sendMessageToGroup.mock.calls[0];
    expect(sentGroupId).toBe(group._id.toString());
    expect(sentContent).toBe("✅ Background research: Found 3 articles");
  });

  test("failed run requeues the task, then exhausts to failed and sends ❌ once", async () => {
    const group = await makeGroup();
    const task = await makeTask(group._id, {deliverResult: true, maxAttempts: 2});
    const runner = makeRunner(async () => ({
      output: "",
      sessionId: "stub-session",
      durationMs: 10,
      status: "failed" as const,
      error: "LLM exploded",
    }));
    const channelManager = makeChannelManager();
    const worker = makeWorker(runner, channelManager);

    // Attempt 1: fails with budget remaining → back to pending, no delivery.
    await worker.tick();
    await worker.waitForActiveRuns();
    const afterFirst = await AgentTask.findExactlyOne({_id: task._id});
    expect(afterFirst.status).toBe("pending");
    expect(afterFirst.attempts).toBe(1);
    expect(afterFirst.error).toBe("LLM exploded");
    expect(afterFirst.workerId).toBeUndefined();
    expect(channelManager.sendMessageToGroup).not.toHaveBeenCalled();

    // Attempt 2: exhausts the budget → terminal failure, ❌ delivered.
    await worker.tick();
    await worker.waitForActiveRuns();
    const afterSecond = await AgentTask.findExactlyOne({_id: task._id});
    expect(afterSecond.status).toBe("failed");
    expect(afterSecond.attempts).toBe(2);

    expect(channelManager.sendMessageToGroup).toHaveBeenCalledTimes(1);
    const [, sentContent] = channelManager.sendMessageToGroup.mock.calls[0];
    expect(sentContent).toBe("❌ Background research: LLM exploded");

    const runLogs = await TaskRunLog.find({groupId: group._id, trigger: "delegated"});
    expect(runLogs.length).toBe(2);
    expect(runLogs.every((log) => log.status === "failed")).toBe(true);
  });

  test("thrown runner error is recorded as a failed attempt", async () => {
    const group = await makeGroup();
    const task = await makeTask(group._id, {maxAttempts: 1});
    const runner = makeRunner(async () => {
      throw new Error("runner blew up");
    });
    const channelManager = makeChannelManager();
    const worker = makeWorker(runner, channelManager);

    await worker.tick();
    await worker.waitForActiveRuns();

    const reloaded = await AgentTask.findExactlyOne({_id: task._id});
    expect(reloaded.status).toBe("failed");
    expect(reloaded.error).toContain("runner blew up");

    const runLogs = await TaskRunLog.find({groupId: group._id, trigger: "delegated"});
    expect(runLogs.length).toBe(1);
    expect(runLogs[0].status).toBe("failed");
  });

  test("task whose group is gone fails gracefully without running the agent", async () => {
    const orphanGroupId = new mongoose.Types.ObjectId();
    const task = await makeTask(orphanGroupId);
    const runner = makeRunner(async () => completedResult());
    const channelManager = makeChannelManager();
    const worker = makeWorker(runner, channelManager);

    await worker.tick();
    await worker.waitForActiveRuns();

    const reloaded = await AgentTask.findExactlyOne({_id: task._id});
    expect(reloaded.status).toBe("failed");
    expect(reloaded.error).toContain("not found");
    expect(runner.run).not.toHaveBeenCalled();
  });

  test("respects the concurrency limit within a tick", async () => {
    const group = await makeGroup();
    await makeTask(group._id, {title: "task 1"});
    await makeTask(group._id, {title: "task 2"});
    await makeTask(group._id, {title: "task 3"});

    let releaseRuns: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      releaseRuns = resolve;
    });
    const runner = makeRunner(async () => {
      await gate;
      return completedResult();
    });
    const channelManager = makeChannelManager();
    const worker = makeWorker(runner, channelManager);

    // Default concurrency is 2 — the third task must stay pending.
    await worker.tick();
    expect(worker.activeCount).toBe(2);
    expect(await AgentTask.countDocuments({groupId: group._id, status: "pending"})).toBe(1);

    releaseRuns();
    await worker.waitForActiveRuns();

    await worker.tick();
    await worker.waitForActiveRuns();
    expect(await AgentTask.countDocuments({groupId: group._id, status: "completed"})).toBe(3);
  });

  test("tick reclaims stale tasks before claiming", async () => {
    const group = await makeGroup();
    const stale = await makeTask(group._id, {
      status: "running",
      workerId: "dead-worker",
      attempts: 1,
      maxAttempts: 2,
      claimedAt: new Date(Date.now() - 300000),
      heartbeatAt: new Date(Date.now() - 300000),
    });
    const runner = makeRunner(async () => completedResult());
    const channelManager = makeChannelManager();
    const worker = makeWorker(runner, channelManager);

    // The stale task is requeued and then immediately re-claimed in the same tick.
    await worker.tick();
    await worker.waitForActiveRuns();

    const reloaded = await AgentTask.findExactlyOne({_id: stale._id});
    expect(reloaded.status).toBe("completed");
    expect(reloaded.attempts).toBe(2);
  });

  test("cancelRequested mid-run aborts via the runner and marks the task cancelled", async () => {
    const config = await loadAppConfig();
    const originalHeartbeatMs = config.taskWorker.heartbeatMs;
    await AppConfig.findOneAndUpdate({}, {$set: {"taskWorker.heartbeatMs": 20}});
    await reloadAppConfig();

    try {
      const group = await makeGroup();
      const task = await makeTask(group._id);

      let resolveRun: (result: AgentRunResult) => void = () => {};
      const blocked = new Promise<AgentRunResult>((resolve) => {
        resolveRun = resolve;
      });
      const runner = makeRunner(() => blocked);
      // stop() aborts the in-flight run — mirror that by resolving as failed.
      runner.stop = mock(async () => {
        resolveRun({
          output: "",
          sessionId: "stub-session",
          durationMs: 5,
          status: "failed",
          error: "aborted",
        });
      });
      const channelManager = makeChannelManager();
      const worker = makeWorker(runner, channelManager);

      await worker.tick();
      // Simulate cancel_agent_task setting the flag while the run is in flight.
      await AgentTask.findByIdAndUpdate(task._id, {$set: {cancelRequested: true}});
      await worker.waitForActiveRuns();

      expect(runner.stop).toHaveBeenCalledTimes(1);
      const reloaded = await AgentTask.findExactlyOne({_id: task._id});
      expect(reloaded.status).toBe("cancelled");
      expect(reloaded.error).toBe("Cancelled by request");
    } finally {
      await AppConfig.findOneAndUpdate({}, {$set: {"taskWorker.heartbeatMs": originalHeartbeatMs}});
      await reloadAppConfig();
    }
  });

  test("start() does not start the loop when taskWorker.enabled is false", async () => {
    await AppConfig.findOneAndUpdate({}, {$set: {"taskWorker.enabled": false}});
    await reloadAppConfig();

    const runner = makeRunner(async () => completedResult());
    const channelManager = makeChannelManager();
    const worker = makeWorker(runner, channelManager);

    try {
      const group = await makeGroup();
      const task = await makeTask(group._id);

      await worker.start();
      expect(worker.isRunning).toBe(false);

      // No tick ran — the pending task is untouched and nothing was claimed.
      const reloaded = await AgentTask.findExactlyOne({_id: task._id});
      expect(reloaded.status).toBe("pending");
      expect(runner.run).not.toHaveBeenCalled();
    } finally {
      worker.stop();
      await AppConfig.findOneAndUpdate({}, {$set: {"taskWorker.enabled": true}});
      await reloadAppConfig();
    }
  });

  test("start() begins polling when enabled and stop() halts it", async () => {
    const runner = makeRunner(async () => completedResult());
    const channelManager = makeChannelManager();
    const worker = makeWorker(runner, channelManager);

    try {
      await worker.start();
      expect(worker.isRunning).toBe(true);
      await worker.waitForActiveRuns();
    } finally {
      worker.stop();
    }
    expect(worker.isRunning).toBe(false);
  });
});
