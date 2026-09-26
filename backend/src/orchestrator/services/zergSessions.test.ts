import {afterEach, describe, expect, mock, test} from "bun:test";
import {DateTime} from "luxon";
import {AppConfig, reloadAppConfig} from "../../models/appConfig";
import type {ExecFn} from "../runners/zerg";
import {
  formatDashboardText,
  normalizeRow,
  parseDashDocument,
  parseInboxDocument,
  sortRows,
  ZergSessionsService,
} from "./zergSessions";

const NOW = DateTime.fromISO("2026-09-26T18:00:00Z", {zone: "utc"});

const dashRows = [
  {
    session: "shade-export",
    tmux: "shade|export",
    repo: "shade",
    feature: "export",
    agent: "claude",
    state: "running",
    activity: {state: "working", since: "2026-09-26T17:59:30Z", claudeSessionId: "abc"},
    stage: "pick",
    pr: "#12",
    lastLine: "running tests…",
  },
  {
    session: "dotfiles-spike",
    tmux: "dotfiles|spike",
    repo: "dotfiles",
    feature: "spike",
    state: "running",
    activity: {state: "blocked", since: "2026-09-26T17:50:00Z"},
    stage: "grow",
    blockedOn: "ask: which auth provider?",
  },
  {
    session: "shade-old",
    tmux: "shade|old",
    repo: "shade",
    feature: "old",
    state: "orphan-tmux",
  },
];

const dashObject = {
  rows: dashRows,
  inboxPending: [
    {
      id: "i1",
      session: "dotfiles-spike",
      kind: "ask",
      question: "Which auth provider?",
      recommendation: "Better Auth",
      options: ["Better Auth", "Clerk"],
    },
  ],
  drones: {running: 2, cap: 12},
};

/** exec that answers the dash verb with `dash` and the inbox verb with `inbox`. */
const fakeExec = ({
  dash,
  inbox,
}: {
  dash: {code?: number; stdout?: string; stderr?: string};
  inbox?: {code?: number; stdout?: string; stderr?: string};
}) =>
  mock<ExecFn>(async (argv) => {
    const joined = argv.join(" ");
    const reply = joined.includes("inbox") ? (inbox ?? {code: 1, stdout: "", stderr: "no"}) : dash;
    return {code: reply.code ?? 0, stdout: reply.stdout ?? "", stderr: reply.stderr ?? ""};
  });

const withNow =
  (offsetMs = 0) =>
  () =>
    NOW.plus({milliseconds: offsetMs});

describe("parseDashDocument", () => {
  test("accepts a bare array (hive ls form)", () => {
    const doc = parseDashDocument(JSON.stringify(dashRows));
    expect(doc.rows).toHaveLength(3);
    expect(doc.inboxPending).toBeUndefined();
    expect(doc.drones).toBeUndefined();
  });

  test("accepts the object form with inbox items and drones", () => {
    const doc = parseDashDocument(JSON.stringify(dashObject));
    expect(doc.rows).toHaveLength(3);
    expect(doc.inboxPending).toBe(1);
    expect(doc.inboxItems?.[0]?.question).toBe("Which auth provider?");
    expect(doc.inboxItems?.[0]?.options).toEqual(["Better Auth", "Clerk"]);
    expect(doc.drones).toEqual({running: 2, cap: 12});
  });

  test("accepts `sessions` as the row key and a numeric inboxPending", () => {
    const doc = parseDashDocument(
      JSON.stringify({sessions: dashRows.slice(0, 1), inboxPending: 3})
    );
    expect(doc.rows).toHaveLength(1);
    expect(doc.inboxPending).toBe(3);
    expect(doc.inboxItems).toBeUndefined();
  });

  test("drops non-object rows and rejects non-JSON", () => {
    expect(parseDashDocument(JSON.stringify([1, "x", dashRows[0]])).rows).toHaveLength(1);
    expect(() => parseDashDocument("hive: usage")).toThrow();
    expect(() => parseDashDocument('"just a string"')).toThrow(/neither/);
  });

  test("parseInboxDocument reads arrays and {items}/{pending} wrappers", () => {
    expect(parseInboxDocument(JSON.stringify([{question: "q"}]))).toEqual([
      expect.objectContaining({question: "q"}),
    ]);
    expect(parseInboxDocument(JSON.stringify({items: [{ask: "a"}]}))[0]?.question).toBe("a");
    expect(parseInboxDocument(JSON.stringify({pending: [{text: "t"}]}))[0]?.question).toBe("t");
    expect(parseInboxDocument("{}")).toEqual([]);
  });
});

describe("normalizeRow", () => {
  const opts = {attachPrefix: "zerg attach", now: NOW};

  test("maps a running working row with age and attach command", () => {
    const row = normalizeRow(dashRows[0] as never, opts);
    expect(row).toMatchObject({
      session: "shade-export",
      tmux: "shade|export",
      repo: "shade",
      feature: "export",
      containerState: "running",
      activity: "working",
      activityAgeSeconds: 30,
      claudeSessionId: "abc",
      stage: "pick",
      pr: "#12",
      needsYou: false,
      lastLine: "running tests…",
      attachCommand: "zerg attach shade export",
    });
    expect(row?.needsYouWhy).toBeUndefined();
  });

  test("blocked rows need you and carry blocked-on", () => {
    const row = normalizeRow(dashRows[1] as never, opts);
    expect(row?.activity).toBe("blocked");
    expect(row?.needsYou).toBe(true);
    expect(row?.needsYouWhy).toBe("waiting on you");
    expect(row?.blockedOn).toBe("ask: which auth provider?");
  });

  test("orphan-tmux rows are dead, need you, and have a dash stage", () => {
    const row = normalizeRow(dashRows[2] as never, opts);
    expect(row?.activity).toBe("dead");
    expect(row?.needsYou).toBe(true);
    expect(row?.stage).toBe("-");
  });

  test("honors explicit needsYou/needsYouWhy from zerg over the derived values", () => {
    const row = normalizeRow({...dashRows[0], needsYou: true, needsYouWhy: "stall"} as never, opts);
    expect(row?.needsYou).toBe(true);
    expect(row?.needsYouWhy).toBe("stall");
  });

  test("unknown activity words and missing activity read as unknown; nameless rows are skipped", () => {
    expect(normalizeRow({tmux: "a|b", activity: {state: "zzz"}}, opts)?.activity).toBe("unknown");
    expect(normalizeRow({session: "a-b", state: "running"}, opts)?.activity).toBe("unknown");
    expect(normalizeRow({state: "running"}, opts)).toBeUndefined();
    expect(normalizeRow({repo: "r", feature: "f"}, opts)).toMatchObject({
      session: "r-f",
      tmux: "r|f",
    });
  });

  test("sortRows puts needs-you first (blocked, dead, idle), then working", () => {
    const rows = dashRows
      .map((raw) => normalizeRow(raw as never, opts))
      .filter((row) => row !== undefined);
    const idle = {
      ...rows[0]!,
      tmux: "a|idle",
      activity: "idle" as const,
      needsYou: true,
    };
    const sorted = sortRows([rows[0]!, idle, rows[2]!, rows[1]!]);
    expect(sorted.map((row) => row.tmux)).toEqual([
      "dotfiles|spike",
      "shade|old",
      "a|idle",
      "shade|export",
    ]);
  });
});

describe("ZergSessionsService", () => {
  afterEach(async () => {
    await AppConfig.deleteMany({});
    await reloadAppConfig();
  });

  test("runs the dash verb over ssh and builds a sorted dashboard with inbox and summary", async () => {
    const exec = fakeExec({dash: {stdout: JSON.stringify(dashObject)}});
    const service = new ZergSessionsService({exec, now: withNow()});
    const dashboard = await service.getDashboard();

    expect(exec).toHaveBeenCalledTimes(1);
    const [argv] = exec.mock.calls[0] as unknown as [string[]];
    expect(argv).toEqual(["ssh", "-T", "-o", "BatchMode=yes", "zerg", "'zerg' 'dash' '--json'"]);

    expect(dashboard.source).toBe("zerg");
    expect(dashboard.error).toBeUndefined();
    expect(dashboard.rows.map((row) => row.tmux)).toEqual([
      "dotfiles|spike",
      "shade|old",
      "shade|export",
    ]);
    expect(dashboard.inbox).toHaveLength(1);
    expect(dashboard.summary).toEqual({running: 2, cap: 12, needsYou: 2, inboxPending: 1});
    expect(dashboard.fetchedAt).toBe(NOW.toISO() ?? "");
  });

  test("falls back to the inbox verb when the dash document has no items, and tolerates its absence", async () => {
    const exec = fakeExec({
      dash: {stdout: JSON.stringify(dashRows)},
      inbox: {stdout: JSON.stringify([{question: "Merge?", recommendation: "yes"}])},
    });
    const withInbox = new ZergSessionsService({exec, now: withNow()});
    const dashboard = await withInbox.getDashboard();
    expect(exec).toHaveBeenCalledTimes(2);
    expect(dashboard.inbox[0]?.question).toBe("Merge?");
    expect(dashboard.summary.inboxPending).toBe(1);
    // No drones block: running is derived from live rows (dead rows excluded).
    expect(dashboard.summary.running).toBe(2);
    expect(dashboard.summary.cap).toBeUndefined();

    const noInbox = new ZergSessionsService({
      exec: fakeExec({dash: {stdout: JSON.stringify(dashRows)}, inbox: {code: 2, stderr: "usage"}}),
      now: withNow(),
    });
    const quiet = await noInbox.getDashboard();
    expect(quiet.error).toBeUndefined();
    expect(quiet.inbox).toEqual([]);
  });

  test("serves from cache inside cacheMs, refetches after it, and refresh bypasses it", async () => {
    let offset = 0;
    const exec = fakeExec({dash: {stdout: JSON.stringify(dashObject)}});
    const service = new ZergSessionsService({exec, now: () => NOW.plus({milliseconds: offset})});

    await service.getDashboard();
    offset = 1000;
    const cached = await service.getDashboard();
    expect(cached.source).toBe("cache");
    expect(exec).toHaveBeenCalledTimes(1);

    await service.getDashboard({refresh: true});
    expect(exec).toHaveBeenCalledTimes(2);

    offset = 20000;
    const fresh = await service.getDashboard();
    expect(fresh.source).toBe("zerg");
    expect(exec).toHaveBeenCalledTimes(3);
  });

  test("concurrent reads share one in-flight fetch", async () => {
    const exec = fakeExec({dash: {stdout: JSON.stringify(dashObject)}});
    const service = new ZergSessionsService({exec, now: withNow()});
    await Promise.all([service.getDashboard(), service.getDashboard(), service.getDashboard()]);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test("repo filter narrows rows and needsYou without a second fetch", async () => {
    const exec = fakeExec({dash: {stdout: JSON.stringify(dashObject)}});
    const service = new ZergSessionsService({exec, now: withNow()});
    const shade = await service.getDashboard({repo: "shade"});
    expect(shade.rows.map((row) => row.tmux)).toEqual(["shade|old", "shade|export"]);
    expect(shade.summary.needsYou).toBe(1);
    expect(exec).toHaveBeenCalledTimes(1);
  });

  test("a failing zerg yields an empty dashboard with the error, and stale rows once cached", async () => {
    const broken = new ZergSessionsService({
      exec: fakeExec({dash: {code: 255, stderr: "ssh: connect to host zerg port 22: timed out"}}),
      now: withNow(),
    });
    const empty = await broken.getDashboard();
    expect(empty.rows).toEqual([]);
    expect(empty.error).toMatch(/exited 255.*timed out/);

    let fail = false;
    const flaky = new ZergSessionsService({
      exec: mock<ExecFn>(async () =>
        fail
          ? {code: 1, stdout: "", stderr: "boom"}
          : {code: 0, stdout: JSON.stringify(dashRows), stderr: ""}
      ),
      now: withNow(),
    });
    await flaky.getDashboard();
    fail = true;
    const stale = await flaky.getDashboard({refresh: true});
    expect(stale.source).toBe("cache");
    expect(stale.error).toMatch(/boom/);
    expect(stale.rows).toHaveLength(3);
  });

  test("non-JSON output is reported, not thrown", async () => {
    const service = new ZergSessionsService({
      exec: fakeExec({dash: {stdout: "zerg: unknown command 'dash'"}}),
      now: withNow(),
    });
    const dashboard = await service.getDashboard();
    expect(dashboard.rows).toEqual([]);
    expect(dashboard.error).toMatch(/JSON/);
  });

  test("returns a disabled dashboard without touching zerg when zerg.enabled is false", async () => {
    await AppConfig.deleteMany({});
    await AppConfig.create({zerg: {enabled: false}});
    await reloadAppConfig();
    const exec = fakeExec({dash: {stdout: "[]"}});
    const dashboard = await new ZergSessionsService({exec, now: withNow()}).getDashboard();
    expect(dashboard.error).toMatch(/disabled/);
    expect(exec).not.toHaveBeenCalled();
  });
});

describe("formatDashboardText", () => {
  test("renders needs-you rows first, the inbox, and the summary line", async () => {
    const service = new ZergSessionsService({
      exec: fakeExec({dash: {stdout: JSON.stringify(dashObject)}}),
      now: withNow(),
    });
    const text = formatDashboardText(await service.getDashboard());
    const lines = text.split("\n");
    expect(lines[0]).toBe("SESSION | ACTIVITY | STAGE | PR | BLOCKED-ON | LAST");
    expect(lines[1]).toBe(
      "dotfiles|spike | ◆ blocked 10m | grow | - | ask: which auth provider? | "
    );
    expect(lines[2]).toMatch(/^shade\|old \| ◆ dead \| - \| - \| container gone/);
    expect(lines[3]).toBe("shade|export | working 30s | pick | #12 | - | running tests…");
    expect(text).toContain("Inbox (1 pending):");
    expect(text).toContain("- dotfiles-spike · ask: Which auth provider?");
    expect(text).toContain("  recommendation: Better Auth");
    expect(text).toContain("  options: Better Auth / Clerk");
    expect(lines[lines.length - 1]).toBe("2 running (cap 12) · 2 need you · 1 inbox pending");
  });

  test("needsYouOnly hides working rows and says so when nothing is waiting", async () => {
    const service = new ZergSessionsService({
      exec: fakeExec({dash: {stdout: JSON.stringify([dashRows[0]])}}),
      now: withNow(),
    });
    const text = formatDashboardText(await service.getDashboard(), {needsYouOnly: true});
    expect(text).toContain("Nothing is waiting on you.");
    expect(text).not.toContain("shade|export");
  });

  test("an unreachable zerg is stated first, with a stale-state note when cached rows are shown", () => {
    const text = formatDashboardText({
      rows: [],
      inbox: [],
      summary: {running: 0, needsYou: 0, inboxPending: 0},
      fetchedAt: NOW.toISO() ?? "",
      source: "cache",
      error: "ssh timed out",
    });
    expect(text.split("\n")[0]).toBe(
      "⚠ zerg unreachable: ssh timed out (showing last known state)"
    );
    expect(text).toContain("No zerg sessions.");
  });
});
