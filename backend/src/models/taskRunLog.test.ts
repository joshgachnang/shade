import {afterEach, describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import {TaskRunLog} from "./taskRunLog";

// groupId is a plain ObjectId ref — no real Group/Channel docs are created, so
// only the TaskRunLog docs themselves need cleanup.
const createdLogIds: mongoose.Types.ObjectId[] = [];

afterEach(async () => {
  if (createdLogIds.length > 0) {
    await TaskRunLog.deleteMany({_id: {$in: createdLogIds}});
    createdLogIds.length = 0;
  }
});

describe("TaskRunLog trigger enum", () => {
  test("accepts trigger 'delegated' for agent task board runs", async () => {
    const doc = await TaskRunLog.create({
      groupId: new mongoose.Types.ObjectId(),
      trigger: "delegated",
      classification: "internal",
      modelBackend: "claude",
      status: "completed",
      startedAt: new Date(),
    });
    createdLogIds.push(doc._id);
    expect(doc.trigger).toBe("delegated");
  });

  test("rejects an unknown trigger value", async () => {
    await expect(
      TaskRunLog.create({
        groupId: new mongoose.Types.ObjectId(),
        trigger: "bogus",
        classification: "internal",
        modelBackend: "claude",
        status: "completed",
        startedAt: new Date(),
      })
    ).rejects.toThrow();
  });
});

describe("TaskRunLog resume bookkeeping", () => {
  test("records a resumed run with its resume count", async () => {
    const doc = await TaskRunLog.create({
      groupId: new mongoose.Types.ObjectId(),
      trigger: "message",
      classification: "internal",
      modelBackend: "claude",
      status: "running",
      startedAt: new Date(),
    });
    createdLogIds.push(doc._id);

    await TaskRunLog.findByIdAndUpdate(
      doc._id,
      {$set: {status: "resumed", resumeCount: 2, completedAt: new Date()}},
      {runValidators: true}
    );

    const updated = await TaskRunLog.findExactlyOne({_id: doc._id});
    expect(updated.status).toBe("resumed");
    expect(updated.resumeCount).toBe(2);
  });
});
