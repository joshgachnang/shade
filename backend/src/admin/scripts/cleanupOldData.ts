import {DateTime} from "luxon";
import type {Model} from "mongoose";
import {AIRequest, Message, TaskRunLog, Transcript} from "../../models";
import type {ScriptRunner} from "./types";

/** How old (in days) a record must be before it's eligible for cleanup. */
const RETENTION_DAYS: Record<string, number> = {
  messages: 180,
  aiRequests: 90,
  taskRunLogs: 60,
  transcripts: 180,
};

// Collecting heterogeneous Mongoose models in one array forces Model<any> —
// each `deleteMany` call only needs to accept a date-range filter and the
// per-model Document generic isn't useful here.
interface CleanupTarget {
  name: string;
  model: Model<any>;
  dateField: string;
  retentionDays: number;
}

const TARGETS: CleanupTarget[] = [
  {name: "messages", model: Message, dateField: "created", retentionDays: RETENTION_DAYS.messages},
  {
    name: "aiRequests",
    model: AIRequest,
    dateField: "created",
    retentionDays: RETENTION_DAYS.aiRequests,
  },
  {
    name: "taskRunLogs",
    model: TaskRunLog,
    dateField: "startedAt",
    retentionDays: RETENTION_DAYS.taskRunLogs,
  },
  {
    name: "transcripts",
    model: Transcript,
    dateField: "created",
    retentionDays: RETENTION_DAYS.transcripts,
  },
];

/**
 * Bulk-deletes old Message / AIRequest / TaskRunLog / Transcript documents
 * past their retention window. Retention is hard-coded per collection for
 * safety — if you want to change it, edit `RETENTION_DAYS` in this file.
 *
 * Dry-run counts matches without deleting; wet-run actually deletes.
 */
export const cleanupOldData: ScriptRunner = async (
  wetRun: boolean
): Promise<{success: boolean; results: string[]}> => {
  const results: string[] = [];
  const now = DateTime.utc();

  results.push(wetRun ? "Wet run — records WILL be deleted." : "Dry run — no changes applied.");
  results.push("");

  let grandTotal = 0;
  for (const target of TARGETS) {
    const cutoff = now.minus({days: target.retentionDays}).toJSDate();
    const filter = {[target.dateField]: {$lt: cutoff}};
    const count = await target.model.countDocuments(filter);

    if (count === 0) {
      results.push(`${target.name}: 0 records older than ${target.retentionDays}d`);
      continue;
    }

    if (!wetRun) {
      results.push(
        `${target.name}: would delete ${count} records older than ${target.retentionDays}d`
      );
      grandTotal += count;
      continue;
    }

    const {deletedCount} = await target.model.deleteMany(filter);
    results.push(
      `${target.name}: deleted ${deletedCount ?? 0} of ${count} records older than ${target.retentionDays}d`
    );
    grandTotal += deletedCount ?? 0;
  }

  results.push("");
  results.push(`${wetRun ? "Total deleted" : "Total that would be deleted"}: ${grandTotal}`);

  return {success: true, results};
};
