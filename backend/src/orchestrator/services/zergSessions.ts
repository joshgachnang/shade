import {logger} from "@terreno/api";
import {DateTime} from "luxon";
import {loadAppConfig} from "../../models/appConfig";
import type {AppConfigZerg} from "../../types/models/appConfigTypes";
import type {
  ZergActivity,
  ZergDashboard,
  ZergInboxItem,
  ZergSessionRow,
} from "../../types/zergSessions";
import {defaultExec, type ExecFn, withSshHost} from "../hostExec";

/**
 * Read-through view of every session zerg knows about (IP-017). Runs
 * `zerg dash --json` (and `zerg inbox --json` when it exists) on the zerg host
 * over the same ssh hop the runner uses, normalizes the rows, and caches the
 * result briefly: `dash` docker-execs into every container, so a chat turn,
 * the API and a polling screen must not each pay for it.
 *
 * Read-only by construction: the only commands this module can issue are the
 * two configured verbs.
 */

const COMMAND_TIMEOUT_MS = 30000;
const ACTIVITIES: ReadonlySet<ZergActivity> = new Set([
  "working",
  "blocked",
  "idle",
  "error",
  "exited",
  "dead",
  "unknown",
]);
/** Sort rank within a dashboard: what needs a human first. */
const ACTIVITY_ORDER: Record<ZergActivity, number> = {
  blocked: 0,
  dead: 1,
  idle: 2,
  working: 3,
  error: 4,
  exited: 5,
  unknown: 6,
};

type Dict = Record<string, unknown>;

const isDict = (value: unknown): value is Dict =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const str = (value: unknown): string | undefined => {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
};

const num = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

export interface ParsedDashDocument {
  rows: Dict[];
  inboxPending?: number;
  inboxItems?: ZergInboxItem[];
  drones?: {running?: number; cap?: number};
}

/** One inbox item from whatever zerg printed; unknown fields dropped. */
export const normalizeInboxItem = (raw: unknown): ZergInboxItem | undefined => {
  if (!isDict(raw)) {
    return undefined;
  }
  const options = Array.isArray(raw.options)
    ? raw.options.map((option) =>
        isDict(option) ? (str(option.label) ?? "") : (str(option) ?? "")
      )
    : undefined;
  const item: ZergInboxItem = {
    id: str(raw.id),
    session: str(raw.session),
    kind: str(raw.kind),
    question: str(raw.question) ?? str(raw.ask) ?? str(raw.text),
    recommendation: str(raw.recommendation),
    options: options?.filter(Boolean),
    filedAt: str(raw.filedAt) ?? str(raw.at) ?? str(raw.created),
  };
  return item;
};

/**
 * Accepts every shape the zerg CLI has printed or been specified to print:
 * a bare array of rows (`hive ls --json`, early `zerg dash --json`) or an
 * object with `rows`/`sessions`, `inboxPending` (count or items) and
 * `drones {running, cap}`. Throws only when the text is not JSON at all.
 */
export const parseDashDocument = (text: string): ParsedDashDocument => {
  const parsed: unknown = JSON.parse(text);
  if (Array.isArray(parsed)) {
    return {rows: parsed.filter(isDict)};
  }
  if (!isDict(parsed)) {
    throw new Error("dash document is neither an array nor an object");
  }
  const rowsRaw = Array.isArray(parsed.rows)
    ? parsed.rows
    : Array.isArray(parsed.sessions)
      ? parsed.sessions
      : [];
  const doc: ParsedDashDocument = {rows: rowsRaw.filter(isDict)};
  if (Array.isArray(parsed.inboxPending)) {
    doc.inboxItems = parsed.inboxPending
      .map(normalizeInboxItem)
      .filter((item): item is ZergInboxItem => item !== undefined);
    doc.inboxPending = doc.inboxItems.length;
  } else if (num(parsed.inboxPending) !== undefined) {
    doc.inboxPending = num(parsed.inboxPending);
  }
  if (isDict(parsed.drones)) {
    doc.drones = {running: num(parsed.drones.running), cap: num(parsed.drones.cap)};
  }
  return doc;
};

/** Parses `zerg inbox --json`: an array of items or `{items|pending: [...]}`. */
export const parseInboxDocument = (text: string): ZergInboxItem[] => {
  const parsed: unknown = JSON.parse(text);
  const list = Array.isArray(parsed)
    ? parsed
    : isDict(parsed) && Array.isArray(parsed.items)
      ? parsed.items
      : isDict(parsed) && Array.isArray(parsed.pending)
        ? parsed.pending
        : [];
  return list.map(normalizeInboxItem).filter((item): item is ZergInboxItem => item !== undefined);
};

const NEEDS_YOU_WHY: Partial<Record<ZergActivity, string>> = {
  blocked: "waiting on you",
  idle: "idle — needs a prompt",
  dead: "container gone (orphan tmux)",
};

/**
 * One dashboard row from one raw zerg row. Rows without a session or tmux
 * name are not a session and yield undefined.
 */
export const normalizeRow = (
  raw: Dict,
  {
    attachPrefix,
    now = DateTime.utc(),
  }: {
    /** `<command> <attachVerb>` — repo and feature are appended. */
    attachPrefix: string;
    now?: DateTime;
  }
): ZergSessionRow | undefined => {
  const repo = str(raw.repo) ?? "";
  const feature = str(raw.feature) ?? "";
  const session =
    str(raw.session) ?? str(raw.name) ?? (repo && feature ? `${repo}-${feature}` : "");
  const tmux = str(raw.tmux) ?? (repo && feature ? `${repo}|${feature}` : "");
  if (!session && !tmux) {
    return undefined;
  }

  const containerState = str(raw.state) ?? "unknown";
  const activityRaw = isDict(raw.activity) ? raw.activity : undefined;
  let activity: ZergActivity = "unknown";
  if (containerState === "orphan-tmux") {
    activity = "dead";
  } else {
    const word = str(activityRaw?.state);
    if (word && ACTIVITIES.has(word as ZergActivity)) {
      activity = word as ZergActivity;
    }
  }

  const activitySince = str(activityRaw?.since);
  let activityAgeSeconds: number | undefined;
  if (activitySince) {
    const since = DateTime.fromISO(activitySince, {zone: "utc"});
    if (since.isValid) {
      activityAgeSeconds = Math.max(0, Math.round(now.diff(since, "seconds").seconds));
    }
  }

  const needsYouRaw = typeof raw.needsYou === "boolean" ? raw.needsYou : undefined;
  const needsYou = needsYouRaw ?? NEEDS_YOU_WHY[activity] !== undefined;
  const needsYouWhy = str(raw.needsYouWhy) ?? (needsYou ? NEEDS_YOU_WHY[activity] : undefined);

  return {
    session: session || tmux,
    tmux: tmux || session,
    repo,
    feature,
    agent: str(raw.agent),
    containerState,
    activity,
    activitySince,
    activityAgeSeconds,
    claudeSessionId: str(activityRaw?.claudeSessionId),
    stage: str(raw.stage) || "-",
    pr: str(raw.pr) || undefined,
    blockedOn: str(raw.blockedOn) || undefined,
    verdict: str(raw.verdict) || undefined,
    status: str(raw.status) || undefined,
    needsYou,
    needsYouWhy,
    lastLine: str(raw.lastLine) ?? str(raw.last) ?? undefined,
    attachCommand: repo && feature ? `${attachPrefix} ${repo} ${feature}` : attachPrefix,
  };
};

/** Needs-you first (blocked, dead, idle), then working, then the rest; ties by tmux name. */
export const sortRows = (rows: ZergSessionRow[]): ZergSessionRow[] =>
  [...rows].sort((a, b) => {
    if (a.needsYou !== b.needsYou) {
      return a.needsYou ? -1 : 1;
    }
    const byActivity = ACTIVITY_ORDER[a.activity] - ACTIVITY_ORDER[b.activity];
    if (byActivity !== 0) {
      return byActivity;
    }
    return a.tmux.localeCompare(b.tmux);
  });

const emptyDashboard = (error: string, now: DateTime): ZergDashboard => ({
  rows: [],
  inbox: [],
  summary: {running: 0, needsYou: 0, inboxPending: 0},
  fetchedAt: now.toISO() ?? new Date().toISOString(),
  source: "zerg",
  error,
});

const verbArgs = (verb: string): string[] => verb.split(/\s+/).filter(Boolean);

export interface GetDashboardOptions {
  /** Skip the cache. */
  refresh?: boolean;
  /** Only rows for this repo. Applied after caching, so filters share one fetch. */
  repo?: string;
}

export class ZergSessionsService {
  private readonly exec: ExecFn;
  private readonly now: () => DateTime;
  private cache: {dashboard: ZergDashboard; atMs: number} | null = null;
  private inflight: Promise<ZergDashboard> | null = null;
  private lastWarnedError: string | null = null;

  constructor({exec = defaultExec, now}: {exec?: ExecFn; now?: () => DateTime} = {}) {
    this.exec = exec;
    this.now = now ?? (() => DateTime.utc());
  }

  async getDashboard({refresh = false, repo}: GetDashboardOptions = {}): Promise<ZergDashboard> {
    const {zerg} = await loadAppConfig();
    if (!zerg.enabled) {
      return emptyDashboard("zerg is disabled (AppConfig.zerg.enabled = false)", this.now());
    }

    const nowMs = this.now().toMillis();
    let dashboard: ZergDashboard;
    if (!refresh && this.cache && nowMs - this.cache.atMs < zerg.cacheMs) {
      dashboard = {...this.cache.dashboard, source: "cache"};
    } else {
      if (!this.inflight) {
        this.inflight = this.fetch(zerg).finally(() => {
          this.inflight = null;
        });
      }
      dashboard = await this.inflight;
    }

    if (!repo) {
      return dashboard;
    }
    const rows = dashboard.rows.filter((row) => row.repo === repo);
    return {
      ...dashboard,
      rows,
      summary: {
        ...dashboard.summary,
        needsYou: rows.filter((row) => row.needsYou).length,
      },
    };
  }

  /** Forget the cached dashboard (tests, or after a known state change). */
  invalidate(): void {
    this.cache = null;
  }

  private warnOnce(message: string): void {
    if (this.lastWarnedError === message) {
      logger.debug(`zerg dashboard still failing: ${message}`);
      return;
    }
    this.lastWarnedError = message;
    logger.warn(`zerg dashboard unavailable: ${message}`);
  }

  private async fetch(zerg: AppConfigZerg): Promise<ZergDashboard> {
    const now = this.now();
    const dashArgv = withSshHost([zerg.command, ...verbArgs(zerg.dashVerb)], zerg.sshHost);
    let doc: ParsedDashDocument;
    try {
      const result = await this.exec(dashArgv, {timeoutMs: COMMAND_TIMEOUT_MS});
      if (result.code !== 0) {
        throw new Error(
          `${dashArgv.join(" ")} exited ${result.code}: ${(result.stderr || result.stdout).trim()}`
        );
      }
      doc = parseDashDocument(result.stdout);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.warnOnce(message);
      if (this.cache) {
        return {...this.cache.dashboard, source: "cache", error: message};
      }
      return emptyDashboard(message, now);
    }
    this.lastWarnedError = null;

    const attachPrefix = `${zerg.command} ${zerg.attachVerb}`;
    const rows = sortRows(
      doc.rows
        .map((raw) => normalizeRow(raw, {attachPrefix, now}))
        .filter((row): row is ZergSessionRow => row !== undefined)
    );

    // The inbox verb is optional on the zerg side: a failure here is "no
    // inbox data", never a failed dashboard.
    let inbox = doc.inboxItems ?? [];
    if (inbox.length === 0 && zerg.inboxVerb.trim()) {
      const inboxArgv = withSshHost([zerg.command, ...verbArgs(zerg.inboxVerb)], zerg.sshHost);
      try {
        const result = await this.exec(inboxArgv, {timeoutMs: COMMAND_TIMEOUT_MS});
        if (result.code === 0) {
          inbox = parseInboxDocument(result.stdout);
        } else {
          logger.debug(`${inboxArgv.join(" ")} exited ${result.code}; no inbox data`);
        }
      } catch (error) {
        logger.debug(`zerg inbox unavailable: ${error}`);
      }
    }

    const running = doc.drones?.running ?? rows.filter((row) => row.activity !== "dead").length;
    const dashboard: ZergDashboard = {
      rows,
      inbox,
      summary: {
        running,
        cap: doc.drones?.cap,
        needsYou: rows.filter((row) => row.needsYou).length,
        inboxPending: doc.inboxPending ?? inbox.length,
      },
      fetchedAt: now.toISO() ?? new Date().toISOString(),
      source: "zerg",
    };
    this.cache = {dashboard, atMs: now.toMillis()};
    return dashboard;
  }
}

let singleton: ZergSessionsService | null = null;

/** Process-wide service so the MCP tool, the route and any poller share one cache. */
export const getZergSessionsService = (): ZergSessionsService => {
  if (!singleton) {
    singleton = new ZergSessionsService();
  }
  return singleton;
};

/** Tests swap in a service with a fake exec. */
export const setZergSessionsService = (service: ZergSessionsService | null): void => {
  singleton = service;
};

const formatAge = (seconds?: number): string => {
  if (seconds === undefined) {
    return "";
  }
  if (seconds < 60) {
    return `${seconds}s`;
  }
  if (seconds < 3600) {
    return `${Math.floor(seconds / 60)}m`;
  }
  if (seconds < 86400) {
    return `${Math.floor(seconds / 3600)}h`;
  }
  return `${Math.floor(seconds / 86400)}d`;
};

/**
 * The chat rendering: one line per session, needs-you first, then the pending
 * inbox and the drone count. Plain text so it reads the same in Slack and iMessage.
 */
export const formatDashboardText = (
  dashboard: ZergDashboard,
  {needsYouOnly = false}: {needsYouOnly?: boolean} = {}
): string => {
  const lines: string[] = [];
  if (dashboard.error) {
    lines.push(
      `⚠ zerg unreachable: ${dashboard.error}${dashboard.source === "cache" ? " (showing last known state)" : ""}`
    );
  }
  const rows = needsYouOnly ? dashboard.rows.filter((row) => row.needsYou) : dashboard.rows;
  if (rows.length === 0) {
    lines.push(needsYouOnly ? "Nothing is waiting on you." : "No zerg sessions.");
  } else {
    lines.push("SESSION | ACTIVITY | STAGE | PR | BLOCKED-ON | LAST");
    for (const row of rows) {
      const age = formatAge(row.activityAgeSeconds);
      const activity = `${row.needsYou ? "◆ " : ""}${row.activity}${age ? ` ${age}` : ""}`;
      lines.push(
        [
          row.tmux,
          activity,
          row.stage,
          row.pr ?? "-",
          row.blockedOn ?? row.needsYouWhy ?? "-",
          row.lastLine ?? "",
        ].join(" | ")
      );
    }
  }
  if (dashboard.inbox.length > 0) {
    lines.push("");
    lines.push(`Inbox (${dashboard.inbox.length} pending):`);
    for (const item of dashboard.inbox) {
      const head = [item.session, item.kind].filter(Boolean).join(" · ");
      lines.push(`- ${head ? `${head}: ` : ""}${item.question ?? "(no question text)"}`);
      if (item.recommendation) {
        lines.push(`  recommendation: ${item.recommendation}`);
      }
      if (item.options && item.options.length > 0) {
        lines.push(`  options: ${item.options.join(" / ")}`);
      }
    }
  }
  const {running, cap, needsYou, inboxPending} = dashboard.summary;
  lines.push("");
  lines.push(
    `${running} running${cap !== undefined ? ` (cap ${cap})` : ""} · ${needsYou} need you · ${inboxPending} inbox pending`
  );
  return lines.join("\n");
};
