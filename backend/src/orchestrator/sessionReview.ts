import {DateTime} from "luxon";
import {AgentSession} from "../models/agentSession";
import {AIRequest} from "../models/aiRequest";
import {loadAppConfig} from "../models/appConfig";
import {TaskRunLog} from "../models/taskRunLog";

/** Cap per flagged list so a pathological day can't blow out the tool result. */
const MAX_FLAGGED = 50;

export interface CollectSessionReviewParams {
  /** Lookback window in hours. Falls back to AppConfig.sessionReview.lookbackHours. */
  hours?: number;
}

export interface FlaggedRun {
  id: string;
  groupId: string;
  trigger: string;
  status: string;
  durationMs?: number;
  startedAt: string;
  error?: string;
  promptPreview?: string;
}

export interface FlaggedSession {
  sessionId: string;
  groupId?: string;
  messageCount?: number;
  lastActivityAt?: string;
  transcriptPath?: string;
  costUsd?: number;
  reasons: string[];
}

export interface SessionReviewReport {
  lookbackHours: number;
  since: string;
  thresholds: {
    longRunMs: number;
    longSessionMessages: number;
    sessionCostUsd: number;
  };
  totals: {
    aiRequests: number;
    failedAiRequests: number;
    tokensUsed: number;
    costUsd: number;
  };
  flaggedRuns: FlaggedRun[];
  flaggedSessions: FlaggedSession[];
}

/**
 * Aggregate the last N hours of agent activity into a red-flag report: task
 * runs that failed, timed out, or ran unusually long; sessions with unusually
 * many messages or high summed AIRequest cost; and overall request/cost
 * totals. Read-only — powers the review_sessions MCP tool, which the builtin
 * session-review skill drives on a schedule.
 */
export const collectSessionReview = async ({
  hours,
}: CollectSessionReviewParams = {}): Promise<SessionReviewReport> => {
  const config = (await loadAppConfig()).sessionReview;
  const lookbackHours = hours ?? config?.lookbackHours ?? 24;
  const longRunMs = config?.longRunMs ?? 10 * 60 * 1000;
  const longSessionMessages = config?.longSessionMessages ?? 40;
  const sessionCostUsd = config?.sessionCostUsd ?? 5;
  const since = DateTime.now().minus({hours: lookbackHours}).toJSDate();

  const runs = await TaskRunLog.find({
    startedAt: {$gte: since},
    $or: [{status: {$in: ["failed", "timeout"]}}, {durationMs: {$gte: longRunMs}}],
  })
    .sort({startedAt: -1})
    .limit(MAX_FLAGGED);

  const flaggedRuns: FlaggedRun[] = runs.map((run) => ({
    id: run._id.toString(),
    groupId: run.groupId.toString(),
    trigger: run.trigger,
    status: run.status,
    durationMs: run.durationMs ?? undefined,
    startedAt: run.startedAt.toISOString(),
    error: run.error ?? undefined,
    promptPreview: run.prompt?.slice(0, 200) ?? undefined,
  }));

  const [aiTotals] = await AIRequest.aggregate([
    {$match: {created: {$gte: since}}},
    {
      $group: {
        _id: null,
        aiRequests: {$sum: 1},
        failedAiRequests: {
          $sum: {$cond: [{$in: ["$status", ["failed", "timeout"]]}, 1, 0]},
        },
        tokensUsed: {$sum: {$ifNull: ["$tokensUsed", 0]}},
        costUsd: {$sum: {$ifNull: ["$costUsd", 0]}},
      },
    },
  ]);

  // Sessions flagged by message volume.
  const longSessions = await AgentSession.find({
    lastActivityAt: {$gte: since},
    messageCount: {$gte: longSessionMessages},
  })
    .sort({messageCount: -1})
    .limit(MAX_FLAGGED);

  const flaggedBySessionId = new Map<string, FlaggedSession>();
  for (const session of longSessions) {
    flaggedBySessionId.set(session.sessionId, {
      sessionId: session.sessionId,
      groupId: session.groupId.toString(),
      messageCount: session.messageCount,
      lastActivityAt: session.lastActivityAt?.toISOString(),
      transcriptPath: session.transcriptPath,
      reasons: [`messageCount ${session.messageCount} >= ${longSessionMessages}`],
    });
  }

  // Sessions flagged by summed cost.
  const costlySessions: Array<{_id: string; costUsd: number}> = await AIRequest.aggregate([
    {$match: {created: {$gte: since}, sessionId: {$type: "string", $ne: ""}}},
    {$group: {_id: "$sessionId", costUsd: {$sum: {$ifNull: ["$costUsd", 0]}}}},
    {$match: {costUsd: {$gte: sessionCostUsd}}},
    {$sort: {costUsd: -1}},
    {$limit: MAX_FLAGGED},
  ]);

  for (const costly of costlySessions) {
    const reason = `cost $${costly.costUsd.toFixed(2)} >= $${sessionCostUsd}`;
    const existing = flaggedBySessionId.get(costly._id);
    if (existing) {
      existing.costUsd = costly.costUsd;
      existing.reasons.push(reason);
      continue;
    }

    const session = await AgentSession.findOneOrNone({sessionId: costly._id});
    flaggedBySessionId.set(costly._id, {
      sessionId: costly._id,
      groupId: session?.groupId?.toString(),
      messageCount: session?.messageCount,
      lastActivityAt: session?.lastActivityAt?.toISOString(),
      transcriptPath: session?.transcriptPath,
      costUsd: costly.costUsd,
      reasons: [reason],
    });
  }

  return {
    lookbackHours,
    since: since.toISOString(),
    thresholds: {longRunMs, longSessionMessages, sessionCostUsd},
    totals: {
      aiRequests: aiTotals?.aiRequests ?? 0,
      failedAiRequests: aiTotals?.failedAiRequests ?? 0,
      tokensUsed: aiTotals?.tokensUsed ?? 0,
      costUsd: aiTotals?.costUsd ?? 0,
    },
    flaggedRuns,
    flaggedSessions: [...flaggedBySessionId.values()],
  };
};
