import {DateTime} from "luxon";
import {AIRequest} from "../../models";
import type {ScriptRunner} from "./types";

interface CostBucket {
  count: number;
  cost: number;
  tokens: number;
}

const formatCost = (usd: number): string => `$${usd.toFixed(4)}`;

/**
 * Summarizes AI spend over the last 24h / 7d / 30d windows, grouped by model.
 * Skips requests with no `costUsd` recorded (e.g. local models or older logs
 * from before cost tracking existed).
 *
 * Pure read. `wetRun` is ignored.
 */
export const aiCostSummary: ScriptRunner = async (): Promise<{
  success: boolean;
  results: string[];
}> => {
  const results: string[] = [];
  const now = DateTime.utc();

  const windows: Array<{label: string; start: Date}> = [
    {label: "last 24h", start: now.minus({hours: 24}).toJSDate()},
    {label: "last 7d", start: now.minus({days: 7}).toJSDate()},
    {label: "last 30d", start: now.minus({days: 30}).toJSDate()},
  ];

  for (const {label, start} of windows) {
    const rows = await AIRequest.find({
      created: {$gte: start},
      costUsd: {$exists: true, $ne: null},
    })
      .select("aiModel costUsd tokensUsed")
      .lean();

    if (rows.length === 0) {
      results.push(`${label}: no cost-tagged AI requests`);
      results.push("");
      continue;
    }

    const byModel = new Map<string, CostBucket>();
    let totalCost = 0;
    let totalTokens = 0;

    for (const row of rows) {
      const bucket: CostBucket = byModel.get(row.aiModel) ?? {count: 0, cost: 0, tokens: 0};
      bucket.count++;
      bucket.cost += row.costUsd ?? 0;
      bucket.tokens += row.tokensUsed ?? 0;
      byModel.set(row.aiModel, bucket);
      totalCost += row.costUsd ?? 0;
      totalTokens += row.tokensUsed ?? 0;
    }

    const sorted = [...byModel.entries()].sort((a, b) => b[1].cost - a[1].cost);

    results.push(
      `${label} — ${rows.length} requests, ${formatCost(totalCost)}, ${totalTokens.toLocaleString()} tokens`
    );
    for (const [model, bucket] of sorted) {
      results.push(
        `  ${model.padEnd(40)} ${String(bucket.count).padStart(5)} req  ${formatCost(bucket.cost).padStart(10)}  ${bucket.tokens.toLocaleString().padStart(10)} tok`
      );
    }
    results.push("");
  }

  return {success: true, results};
};
