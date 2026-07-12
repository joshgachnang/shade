import {afterEach, describe, expect, test} from "bun:test";
import mongoose from "mongoose";
import {AgentSession} from "../models/agentSession";
import {AIRequest} from "../models/aiRequest";
import {AppConfig, reloadAppConfig} from "../models/appConfig";
import {TaskRunLog} from "../models/taskRunLog";
import {collectSessionReview} from "./sessionReview";

const groupId = new mongoose.Types.ObjectId();

const makeRunLog = async (overrides: Record<string, unknown> = {}) => {
  return TaskRunLog.create({
    groupId,
    trigger: "scheduled",
    classification: "internal",
    modelBackend: "claude",
    status: "completed",
    startedAt: new Date(),
    ...overrides,
  });
};

const makeSession = async (overrides: Record<string, unknown> = {}) => {
  return AgentSession.create({
    groupId,
    sessionId: `review-test-${new mongoose.Types.ObjectId().toString()}`,
    transcriptPath: "/tmp/transcript.jsonl",
    lastActivityAt: new Date(),
    ...overrides,
  });
};

const makeAiRequest = async (overrides: Record<string, unknown> = {}) => {
  return AIRequest.create({
    aiModel: "claude-test",
    prompt: "test prompt",
    requestType: "agent",
    status: "completed",
    groupId,
    ...overrides,
  });
};

afterEach(async () => {
  await TaskRunLog.deleteMany({groupId});
  await AgentSession.deleteMany({groupId});
  await AIRequest.deleteMany({groupId});
  await AppConfig.findOneAndUpdate(
    {},
    {
      $set: {
        sessionReview: {
          lookbackHours: 24,
          longRunMs: 10 * 60 * 1000,
          longSessionMessages: 40,
          sessionCostUsd: 5,
        },
      },
    }
  );
  await reloadAppConfig();
});

describe("collectSessionReview", () => {
  test("flags failed, timed-out, and long runs but not healthy or old ones", async () => {
    const failed = await makeRunLog({status: "failed", error: "boom"});
    const timedOut = await makeRunLog({status: "timeout"});
    const longRun = await makeRunLog({durationMs: 11 * 60 * 1000});
    await makeRunLog({durationMs: 1000}); // healthy
    await makeRunLog({
      status: "failed",
      startedAt: new Date(Date.now() - 48 * 60 * 60 * 1000), // outside window
    });

    const report = await collectSessionReview();

    const flaggedIds = report.flaggedRuns.map((run) => run.id);
    expect(flaggedIds).toContain(failed._id.toString());
    expect(flaggedIds).toContain(timedOut._id.toString());
    expect(flaggedIds).toContain(longRun._id.toString());
    expect(report.flaggedRuns).toHaveLength(3);
    expect(report.flaggedRuns.find((run) => run.id === failed._id.toString())?.error).toBe("boom");
  });

  test("flags sessions by message count", async () => {
    const busy = await makeSession({messageCount: 45});
    await makeSession({messageCount: 3});

    const report = await collectSessionReview();

    expect(report.flaggedSessions).toHaveLength(1);
    expect(report.flaggedSessions[0]?.sessionId).toBe(busy.sessionId);
    expect(report.flaggedSessions[0]?.transcriptPath).toBe("/tmp/transcript.jsonl");
    expect(report.flaggedSessions[0]?.reasons[0]).toContain("messageCount 45");
  });

  test("flags sessions by summed cost and merges with message-count flags", async () => {
    const busyAndCostly = await makeSession({messageCount: 50});
    const costlyOnly = await makeSession({messageCount: 2});

    await makeAiRequest({sessionId: busyAndCostly.sessionId, costUsd: 4});
    await makeAiRequest({sessionId: busyAndCostly.sessionId, costUsd: 3});
    await makeAiRequest({sessionId: costlyOnly.sessionId, costUsd: 6});
    await makeAiRequest({sessionId: "unknown-session", costUsd: 0.01});

    const report = await collectSessionReview();

    expect(report.flaggedSessions).toHaveLength(2);

    const merged = report.flaggedSessions.find(
      (session) => session.sessionId === busyAndCostly.sessionId
    );
    expect(merged?.costUsd).toBe(7);
    expect(merged?.reasons).toHaveLength(2);

    const costFlagged = report.flaggedSessions.find(
      (session) => session.sessionId === costlyOnly.sessionId
    );
    expect(costFlagged?.costUsd).toBe(6);
    expect(costFlagged?.transcriptPath).toBe("/tmp/transcript.jsonl");
  });

  test("reports request totals for the window", async () => {
    await makeAiRequest({costUsd: 1.5, tokensUsed: 1000});
    await makeAiRequest({costUsd: 0.5, tokensUsed: 500, status: "failed"});

    const report = await collectSessionReview();

    expect(report.totals.aiRequests).toBe(2);
    expect(report.totals.failedAiRequests).toBe(1);
    expect(report.totals.tokensUsed).toBe(1500);
    expect(report.totals.costUsd).toBe(2);
  });

  test("respects an explicit hours override", async () => {
    await makeRunLog({
      status: "failed",
      startedAt: new Date(Date.now() - 3 * 60 * 60 * 1000),
    });

    const wide = await collectSessionReview({hours: 6});
    expect(wide.flaggedRuns).toHaveLength(1);
    expect(wide.lookbackHours).toBe(6);

    const narrow = await collectSessionReview({hours: 1});
    expect(narrow.flaggedRuns).toHaveLength(0);
  });

  test("returns zeroed totals and empty lists when there is no activity", async () => {
    const report = await collectSessionReview();

    expect(report.totals).toEqual({
      aiRequests: 0,
      failedAiRequests: 0,
      tokensUsed: 0,
      costUsd: 0,
    });
    expect(report.flaggedRuns).toEqual([]);
    expect(report.flaggedSessions).toEqual([]);
    expect(report.thresholds.longSessionMessages).toBe(40);
  });
});
