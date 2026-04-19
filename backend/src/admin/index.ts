import type {AdminScriptConfig} from "@terreno/admin-backend";
import {aiCostSummary} from "./scripts/aiCostSummary";
import {cleanupOldData} from "./scripts/cleanupOldData";
import {reconnectChannels} from "./scripts/reconnectChannels";
import {reloadAppConfigCache} from "./scripts/reloadAppConfigCache";
import {retryFailedMovies} from "./scripts/retryFailedMovies";
import {rotateJwtSecrets} from "./scripts/rotateJwtSecrets";
import {systemStatus} from "./scripts/systemStatus";
import {testApiKeys} from "./scripts/testApiKeys";

/**
 * Admin-panel operations surface — scripts an operator can kick off from the
 * AdminApp UI. Each script follows `ScriptRunner`'s `(wetRun, ctx)` contract.
 *
 * Conventions:
 *   - Read-only scripts (status, cost, key tests) ignore `wetRun` and are
 *     always safe to run.
 *   - Destructive or state-changing scripts (cleanup, rotate, retry) support
 *     dry-run — `wetRun=false` must not mutate.
 *   - Scripts that need restart to take full effect (rotateJwtSecrets) say so
 *     explicitly in the last result line.
 */
export const adminScripts: AdminScriptConfig[] = [
  {
    name: "systemStatus",
    description:
      "Snapshot of orchestrator health: connected channels, active tasks, recent AI + message volume, recent error counts.",
    runner: systemStatus,
  },
  {
    name: "aiCostSummary",
    description:
      "Aggregate Anthropic / OpenRouter spend over the last 24h, 7d, and 30d, grouped by model.",
    runner: aiCostSummary,
  },
  {
    name: "testApiKeys",
    description:
      "Ping Anthropic, OpenRouter, Deepgram, Brave Search, and GitHub to verify their credentials are live.",
    runner: testApiKeys,
  },
  {
    name: "reconnectChannels",
    description:
      "Disconnect every live channel connector and re-initialize from the DB — recovery knob for stuck Slack / iMessage / email / webhook connections.",
    runner: reconnectChannels,
  },
  {
    name: "reloadAppConfigCache",
    description:
      "Invalidate the in-memory AppConfig cache (next read re-fetches from Mongo). Does NOT re-hydrate env vars — use this after direct Mongo-shell edits.",
    runner: reloadAppConfigCache,
  },
  {
    name: "rotateJwtSecrets",
    description:
      "Generate fresh JWT access + refresh secrets and persist them to AppConfig. RESTART REQUIRED for new secrets to take effect; all existing sessions will be invalidated.",
    runner: rotateJwtSecrets,
  },
  {
    name: "cleanupOldData",
    description:
      "Bulk-delete old Message / AIRequest / TaskRunLog / Transcript records past their retention window. Dry-run first; the retention windows are defined in the script source.",
    runner: cleanupOldData,
  },
  {
    name: "retryFailedMovies",
    description:
      "Re-queue every movie in `error` status for processing. Dry-run lists candidates; wet-run clears the error state and kicks off the pipeline.",
    runner: retryFailedMovies,
  },
];
