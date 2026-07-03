import {afterEach, describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import {AgentTask} from "./agentTask";

// Group/Message refs are plain ObjectIds — no real Group/Channel docs are
// created here, so there is nothing channel-related to clean up. AgentTask
// docs themselves are removed after each test to keep tests order-independent.
const createdTaskIds: mongoose.Types.ObjectId[] = [];

const makeTask = async (overrides: Record<string, unknown> = {}) => {
  const doc = await AgentTask.create({
    groupId: new mongoose.Types.ObjectId(),
    title: "Test task",
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

describe("AgentTask model", () => {
  test("creates with defaults", async () => {
    const doc = await makeTask();
    expect(doc.status).toBe("pending");
    expect(doc.priority).toBe(0);
    expect(doc.attempts).toBe(0);
    expect(doc.maxAttempts).toBe(2);
    expect(doc.deliverResult).toBe(false);
    expect(doc.cancelRequested).toBe(false);
    expect(doc.workerId).toBeUndefined();
    expect(doc.claimedAt).toBeUndefined();
    expect(doc.heartbeatAt).toBeUndefined();
    expect(doc.result).toBeUndefined();
    expect(doc.error).toBeUndefined();
  });

  test("requires groupId, title, and prompt", async () => {
    await expect(AgentTask.create({title: "x", prompt: "y"})).rejects.toThrow();
    await expect(
      AgentTask.create({groupId: new mongoose.Types.ObjectId(), prompt: "y"})
    ).rejects.toThrow();
    await expect(
      AgentTask.create({groupId: new mongoose.Types.ObjectId(), title: "x"})
    ).rejects.toThrow();
  });

  test("supports status transitions through the task lifecycle", async () => {
    const doc = await makeTask();

    doc.status = "claimed";
    doc.workerId = "host:1234";
    doc.claimedAt = new Date();
    doc.heartbeatAt = new Date();
    doc.attempts = 1;
    await doc.save();
    expect(doc.status).toBe("claimed");

    doc.status = "running";
    doc.startedAt = new Date();
    await doc.save();
    expect(doc.status).toBe("running");

    doc.status = "completed";
    doc.completedAt = new Date();
    doc.result = "done";
    await doc.save();

    const reloaded = await AgentTask.findExactlyOne({_id: doc._id});
    expect(reloaded.status).toBe("completed");
    expect(reloaded.workerId).toBe("host:1234");
    expect(reloaded.attempts).toBe(1);
    expect(reloaded.result).toBe("done");
  });

  test("rejects invalid status values", async () => {
    await expect(makeTask({status: "bogus"})).rejects.toThrow();
  });

  test("strict: throw rejects unknown fields", async () => {
    await expect(makeTask({notARealField: "nope"})).rejects.toThrow();
  });

  test("declares the claim, group listing, and reclaim indexes", async () => {
    await AgentTask.init();
    const indexes = await AgentTask.collection.indexInformation();
    const keys = Object.values(indexes).map((idx) => JSON.stringify(idx));
    expect(keys).toContainEqual(
      JSON.stringify([
        ["status", 1],
        ["priority", -1],
        ["created", 1],
      ])
    );
    expect(keys).toContainEqual(
      JSON.stringify([
        ["groupId", 1],
        ["created", -1],
      ])
    );
    expect(keys).toContainEqual(
      JSON.stringify([
        ["status", 1],
        ["heartbeatAt", 1],
      ])
    );
  });
});
