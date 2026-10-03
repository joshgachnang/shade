import { describe, expect, test } from "bun:test";
import { agentArgv } from "../src/agents.ts";
import { DEFAULT_CONFIG, loadConfig, parseAgentsFlag } from "../src/config.ts";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMessage, formatAsks, parseReply, smsVersion } from "../src/human.ts";
import { appendEvent } from "../src/events.ts";
import { isApproved, markTask, orientation, parseTasks, readStatus, setStatus, title } from "../src/ip.ts";
import { newState, runDir, slugify } from "../src/state.ts";
import { mergeVerdicts } from "../src/step.ts";
import { isGreen } from "../src/commands/finish.ts";
import { IP } from "./helpers.ts";

describe("ip", () => {
  test("parses task lines, status, title, and orientation", () => {
    const text = IP("draft");
    expect(parseTasks(text)).toEqual([
      { id: "T1", title: "Add greeting file", done: false },
      { id: "T2", title: "Add farewell file", done: false },
    ]);
    expect(readStatus(text)).toBe("draft");
    expect(title(text)).toBe("Add greeting");
    expect(orientation(text)).toBe("The repo has no greeting. This adds one so a new visitor sees hello.");
  });

  test("only an approved Status line counts as approval", () => {
    expect(isApproved(IP("approved 2026-09-27"))).toBe(true);
    expect(isApproved(IP("awaiting sign-off (sent 2026-09-27 via terminal)"))).toBe(false);
    expect(isApproved(IP("not approved"))).toBe(false);
  });

  test("setStatus replaces the line and markTask checks one box", () => {
    const text = markTask(setStatus(IP("draft"), "approved 2026-09-27"), "T2");
    expect(readStatus(text)).toBe("approved 2026-09-27");
    expect(parseTasks(text).map((t) => t.done)).toEqual([false, true]);
  });

  test("setStatus adds a Sign-off section when missing", () => {
    expect(readStatus(setStatus("# X\n\nbody\n", "draft"))).toBe("draft");
  });
});

describe("human", () => {
  test("reads verdicts from replies", () => {
    expect(parseReply("ok")).toBe("approve");
    expect(parseReply("OK, 2b")).toBe("approve");
    expect(parseReply("lgtm")).toBe("approve");
    expect(parseReply("no: wrong tracer")).toBe("reject");
    expect(parseReply("2b, and use postgres")).toBe("answer");
  });

  test("formats asks with lettered options and the recommendation marked", () => {
    expect(formatAsks([{ q: "Store?", rec: "Mongo", opts: ["Mongo", "Postgres"] }])).toBe(
      "1. Store? a) Mongo (recommended) b) Postgres",
    );
  });

  test("the SMS version stays within 480 characters", () => {
    const parts = { repoName: "r", title: "t".repeat(600), need: "n", link: "l", asks: [], replyHint: "" };
    expect(smsVersion(parts, "slug").length).toBeLessThanOrEqual(480);
    expect(buildMessage(parts)).toContain("Plan: l");
  });
});

describe("config and agents", () => {
  test("parses --agents routing", () => {
    expect(parseAgentsFlag("pick=claude,roast=claude+codex+local")).toEqual({
      pick: ["claude"],
      roast: ["claude", "codex", "local"],
    });
    expect(() => parseAgentsFlag("bake=claude")).toThrow();
  });

  test("the local profile drives codex at the litellm provider", () => {
    const argv = agentArgv(DEFAULT_CONFIG.agents.local, "/repo");
    expect(argv.slice(0, 2)).toEqual(["codex", "exec"]);
    expect(argv).toContain('model_provider="litellm"');
    expect(argv).toContain('model_providers.litellm.base_url="http://100.76.70.90:4000/v1"');
    expect(argv).toContain("deepseek-v4");
    expect(argv.at(-1)).toBe("-");
  });

  test("a repo that vendors the skills uses its own copy", () => {
    process.env.BREWERY_CONFIG = join(tmpdir(), "brewery-no-such-config.json");
    const repo = mkdtempSync(join(tmpdir(), "brewery-skills-"));
    expect(loadConfig(repo).skillsDir).toBe(DEFAULT_CONFIG.skillsDir);
    mkdirSync(join(repo, ".claude", "skills", "distill"), { recursive: true });
    writeFileSync(join(repo, ".claude", "skills", "distill", "SKILL.md"), "---\nname: distill\n---\n");
    expect(loadConfig(repo).skillsDir).toBe(join(repo, ".claude", "skills"));
  });

  test("BREWERY_SKILLS_DIR replaces the home default but not a repo's vendored skills", () => {
    process.env.BREWERY_CONFIG = join(tmpdir(), "brewery-no-such-config.json");
    process.env.BREWERY_SKILLS_DIR = "/opt/brewery/skills";
    try {
      const repo = mkdtempSync(join(tmpdir(), "brewery-skills-"));
      expect(loadConfig(repo).skillsDir).toBe("/opt/brewery/skills");
      mkdirSync(join(repo, ".claude", "skills", "distill"), { recursive: true });
      writeFileSync(join(repo, ".claude", "skills", "distill", "SKILL.md"), "---\nname: distill\n---\n");
      expect(loadConfig(repo).skillsDir).toBe(join(repo, ".claude", "skills"));
    } finally {
      delete process.env.BREWERY_SKILLS_DIR;
    }
  });

  test("slugify keeps the first six words", () => {
    expect(slugify("Add a CSV export to the admin reports page, please")).toBe("add-a-csv-export-to-the");
  });
});

describe("verdicts", () => {
  test("any FAIL fails and pools evidence by agent", () => {
    const merged = mergeVerdicts([
      { agent: "claude", result: { status: "PASS", action: "ok" } },
      { agent: "codex", result: { status: "FAIL", action: "fix", fail: [{ need: "a", want: "b", got: "c", ev: "cmd" }] } },
    ]);
    expect(merged.status).toBe("FAIL");
    expect(merged.fail?.[0].ev).toBe("[codex] cmd");
  });

  test("BLOCKED only wins when nothing failed", () => {
    expect(
      mergeVerdicts([
        { agent: "a", result: { status: "BLOCKED", action: "x" } },
        { agent: "b", result: { status: "PASS", action: "y" } },
      ]).status,
    ).toBe("BLOCKED");
  });

  test("green means no conflict and every check passed or skipped", () => {
    const snap = { sha: "a", mergeable: "MERGEABLE" as const, mergeState: "CLEAN", checks: [{ name: "t", bucket: "pass" as const }] };
    expect(isGreen(snap)).toBe(true);
    expect(isGreen({ ...snap, mergeable: "CONFLICTING" })).toBe(false);
    expect(isGreen({ ...snap, checks: [{ name: "t", bucket: "fail" }] })).toBe(false);
  });
});

test("run errors append one parseable event line", () => {
  const repo = mkdtempSync(join(tmpdir(), "brewery-events-"));
  const state = newState({ slug: "failed", repo, ip: "", base: "master", phase: "distill" });
  appendEvent(state, { kind: "error", message: "agent unavailable" });
  const lines = readFileSync(join(runDir(repo, "failed"), "events.jsonl"), "utf8").split("\n");
  expect(lines).toHaveLength(2);
  expect(lines[1]).toBe("");
  expect(JSON.parse(lines[0])).toMatchObject({ kind: "error", message: "agent unavailable" });
});
