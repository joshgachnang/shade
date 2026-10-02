import { describe, expect, test } from "bun:test";
import { agentArgv } from "../src/agents.ts";
import { DEFAULT_CONFIG, loadConfig, parseAgentsFlag } from "../src/config.ts";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildMessage, formatAsks, parseReply, smsVersion } from "../src/human.ts";
import { isApproved, markTask, orientation, parseTasks, readStatus, readyTasks, setStatus, taskGraphProblems, title } from "../src/ip.ts";
import { slugify } from "../src/state.ts";
import { mergeVerdicts } from "../src/step.ts";
import { isGreen } from "../src/commands/finish.ts";
import { IP } from "./helpers.ts";

describe("ip", () => {
  test("parses task lines, status, title, and orientation", () => {
    const text = IP("draft");
    expect(parseTasks(text)).toEqual([
      { id: "T1", title: "Add greeting file", done: false, deps: [] },
      { id: "T2", title: "Add farewell file", done: false, deps: ["T1"] },
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

  for (const line of [
    "  - Depends on: T1, T2",
    "  Depends on: T1 and T2",
    "\t- dEpEnDs On: t1, AND t2",
    "  Depends on: T1, and T2,",
  ]) {
    test(`parses dependencies: ${line.trim()}`, () => {
      const text = `- [ ] **T1** — First\n- [ ] **T2** — Second\n- [X] **T3** — Third\n  - Files: example.ts\n${line}\n`;
      expect(parseTasks(text)[2]).toEqual({ id: "T3", title: "Third", done: true, deps: ["T1", "T2"] });
    });
  }

  test("none explicitly removes the previous-task dependency", () => {
    expect(parseTasks("- [ ] **T1** — First\n  Depends on: NONE\n- [ ] **T7** — Independent\n  - depends on: none\n- [ ] **T9** — Default\n").map((t) => t.deps))
      .toEqual([[], [], ["T7"]]);
  });

  test("dependency lines do not leak across tasks, headings, or prose", () => {
    for (const boundary of ["## Next section", "  ### Nested heading", "Unrelated paragraph"]) {
      const text = `- [ ] **T1** — First\n- [ ] **T2** — Second\n\n${boundary}\n  Depends on: T99\n- [ ] **T3** — Third\n  Depends on: none\n`;
      expect(parseTasks(text).map((t) => t.deps)).toEqual([[], ["T1"], []]);
    }
    expect(parseTasks("- [ ] **T1** — First\n- [ ] **T2** — Second\n  Depends on: none\n").map((t) => t.deps)).toEqual([[], []]);
  });

  test("parses empty input and CRLF task details", () => {
    expect(parseTasks("")).toEqual([]);
    expect(parseTasks("- [x] **T1** — First\r\n\r\n  - Depends on: T2\r\n- [ ] **T2** — Second\r\n  Depends on: none\r\n"))
      .toEqual([{ id: "T1", title: "First", done: true, deps: ["T2"] }, { id: "T2", title: "Second", done: false, deps: [] }]);
  });

  test("graph validation accepts empty and valid diamond graphs", () => {
    expect(taskGraphProblems([])).toEqual([]);
    expect(taskGraphProblems(parseTasks("- [ ] **T1** — Root\n- [ ] **T2** — Left\n- [ ] **T3** — Right\n  Depends on: T1\n- [ ] **T4** — Join\n  Depends on: T2 and T3\n"))).toEqual([]);
  });

  test("graph validation names every unknown and self dependency", () => {
    const tasks = parseTasks("- [ ] **T1** — First\n  Depends on: T99, T1\n- [x] **T2** — Second\n  Depends on: T98, T2\n");
    expect(taskGraphProblems(tasks)).toEqual([
      "T1 depends on unknown task T99", "T1 depends on itself", "T2 depends on unknown task T98", "T2 depends on itself",
    ]);
  });

  test("graph validation reports cycle paths, including disconnected cycles", () => {
    const tasks = parseTasks("- [ ] **T1** — Entry\n  Depends on: T2\n- [ ] **T2** — Loop\n  Depends on: T4\n- [ ] **T3** — Other loop\n  Depends on: T5\n- [x] **T4** — Back\n  Depends on: T2\n- [ ] **T5** — Other back\n  Depends on: T3\n");
    expect(taskGraphProblems(tasks)).toEqual(["Dependency cycle: T2 → T4 → T2", "Dependency cycle: T3 → T5 → T3"]);
  });

  test("ready tasks follow landed dependencies across a diamond in IP order", () => {
    const tasks = parseTasks("- [ ] **T1** — Root\n- [ ] **T2** — Left\n- [ ] **T3** — Right\n  Depends on: T1\n- [ ] **T4** — Join\n  Depends on: T2, T3\n");
    const ids = (landed: string[]) => readyTasks(tasks, new Set(landed)).map((t) => t.id);
    expect(ids([])).toEqual(["T1"]);
    expect(ids(["T1"])).toEqual(["T1", "T2", "T3"]);
    tasks[0].done = true;
    expect(ids(["T1"])).toEqual(["T2", "T3"]);
    tasks[1].done = true;
    expect(ids(["T1", "T2"])).toEqual(["T3"]);
    tasks[2].done = true;
    expect(ids(["T1", "T2", "T3"])).toEqual(["T4"]);
    tasks[3].done = true;
    expect(ids(["T1", "T2", "T3", "T4"])).toEqual([]);
  });

  test("ready tasks require landing even when dependencies are checked done", () => {
    const tasks = parseTasks("- [x] **T1** — Done\n- [ ] **T2** — Waiting\n- [ ] **T3** — Unknown\n  Depends on: T99\n");
    expect(readyTasks(tasks, new Set())).toEqual([]);
    expect(readyTasks(tasks, new Set(["T1"]))).toEqual([tasks[1]]);
    expect(readyTasks([], new Set())).toEqual([]);
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
