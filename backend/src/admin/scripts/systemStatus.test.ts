import {afterEach, describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import {AgentTask} from "../../models";
import {systemStatus} from "./systemStatus";

// AgentTask refs are plain ObjectIds — no Group/Channel docs are created.
// Seeded tasks are removed after each test to keep tests order-independent.
const createdTaskIds: mongoose.Types.ObjectId[] = [];

const makeTask = async (overrides: Record<string, unknown> = {}) => {
  const doc = await AgentTask.create({
    groupId: new mongoose.Types.ObjectId(),
    title: "Status test task",
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

describe("systemStatus workers section", () => {
  test("lists distinct workers heartbeating in the last 5 minutes with ages", async () => {
    const freshWorker = `status-test-host:${Date.now()}`;
    await makeTask({
      status: "running",
      workerId: freshWorker,
      heartbeatAt: new Date(Date.now() - 30_000),
    });
    // Same worker, older heartbeat — must be collapsed into one line (max heartbeat wins).
    await makeTask({
      status: "claimed",
      workerId: freshWorker,
      heartbeatAt: new Date(Date.now() - 120_000),
    });

    const {success, results} = await systemStatus(false);
    expect(success).toBe(true);

    const workerLines = results.filter((line) => line.includes(freshWorker));
    expect(workerLines).toHaveLength(1);
    expect(workerLines[0]).toContain("last heartbeat");
    expect(workerLines[0]).toContain("seconds ago");
  });

  test("excludes workers with heartbeats older than 5 minutes", async () => {
    const staleWorker = `stale-test-host:${Date.now()}`;
    await makeTask({
      status: "running",
      workerId: staleWorker,
      heartbeatAt: new Date(Date.now() - 10 * 60_000),
    });

    const {results} = await systemStatus(false);
    const workerLines = results.filter((line) => line.includes(staleWorker));
    expect(workerLines).toHaveLength(0);
  });

  test("reports board counts including completed/failed in the last 24h", async () => {
    await makeTask({status: "pending"});
    await makeTask({status: "running", workerId: "board-test:1", heartbeatAt: new Date()});
    await makeTask({
      status: "completed",
      workerId: "board-test:1",
      completedAt: new Date(Date.now() - 60_000),
    });
    await makeTask({
      status: "failed",
      workerId: "board-test:1",
      completedAt: new Date(Date.now() - 60_000),
    });
    // Failed outside the 24h window — must not count.
    await makeTask({
      status: "failed",
      workerId: "board-test:2",
      completedAt: new Date(Date.now() - 25 * 3600_000),
    });

    const {results} = await systemStatus(false);
    const boardLine = results.find((line) => line.startsWith("Agent task board:"));
    expect(boardLine).toBeDefined();

    const counts = boardLine!.match(
      /Agent task board: (\d+) pending, (\d+) claimed, (\d+) running, (\d+) completed in last 24h, (\d+) failed in last 24h/
    );
    expect(counts).not.toBeNull();
    const [, pending, , running, completed24h, failed24h] = counts!;
    // Other tests may leave data behind, so assert lower bounds.
    expect(Number(pending)).toBeGreaterThanOrEqual(1);
    expect(Number(running)).toBeGreaterThanOrEqual(1);
    expect(Number(completed24h)).toBeGreaterThanOrEqual(1);
    expect(Number(failed24h)).toBeGreaterThanOrEqual(1);
  });

  test("is read-only: does not mutate seeded tasks", async () => {
    const doc = await makeTask({status: "pending"});
    await systemStatus(true);
    const reloaded = await AgentTask.findExactlyOne({_id: doc._id});
    expect(reloaded.status).toBe("pending");
    expect(reloaded.updated.getTime()).toBe(doc.updated.getTime());
  });
});
