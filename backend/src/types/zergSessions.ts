/**
 * Read-through shapes for the zerg sessions dashboard (IP-017). Nothing here
 * is persisted: rows come from `zerg dash --json` on the zerg host, normalized
 * so the MCP tool, the API route and the console screen share one view.
 */

export type ZergActivity = "working" | "blocked" | "idle" | "error" | "exited" | "dead" | "unknown";

export interface ZergSessionRow {
  /** Docker container name, `<repo>-<feature>`. */
  session: string;
  /** tmux session/window name, `<repo>|<feature>`. */
  tmux: string;
  repo: string;
  feature: string;
  agent?: string;
  /** hive's row state: running, orphan-tmux, … ("unknown" when absent). */
  containerState: string;
  activity: ZergActivity;
  /** ISO timestamp of the last activity change. */
  activitySince?: string;
  activityAgeSeconds?: number;
  claudeSessionId?: string;
  /** Drone pipeline stage (grow/pick/…); "-" for a session zerg did not start. */
  stage: string;
  pr?: string;
  blockedOn?: string;
  verdict?: string;
  status?: string;
  needsYou: boolean;
  needsYouWhy?: string;
  lastLine?: string;
  /** `<command> <attachVerb> <repo> <feature>` on the zerg host. */
  attachCommand: string;
}

export interface ZergInboxItem {
  id?: string;
  session?: string;
  kind?: string;
  question?: string;
  recommendation?: string;
  options?: string[];
  filedAt?: string;
}

export interface ZergDashboardSummary {
  running: number;
  cap?: number;
  needsYou: number;
  inboxPending: number;
}

export interface ZergDashboard {
  /** Needs-you rows first, then working, then idle, then the rest. */
  rows: ZergSessionRow[];
  inbox: ZergInboxItem[];
  summary: ZergDashboardSummary;
  fetchedAt: string;
  source: "zerg" | "cache";
  /** Set when zerg could not be read; rows are then stale (cache) or empty. */
  error?: string;
}
