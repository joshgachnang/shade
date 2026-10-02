// End-to-end runs against a temp git repo with scripted fake agents.
import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative } from "node:path";
import { answer } from "../src/commands/answer.ts";
import { barrel } from "../src/commands/barrel.ts";
import { cutAndFix, distill, sendForSignoff, writeDraft } from "../src/commands/distill.ts";
import { finish } from "../src/commands/finish.ts";
import { readIp, readStatus, parseTasks } from "../src/ip.ts";
import { newState, readContext, runDir, saveState } from "../src/state.ts";
import type { PrSnapshot } from "../src/vcs.ts";
import { fakeCi, fakeSetup, IP, quietCtx, run, tempRepo } from "./helpers.ts";

setDefaultTimeout(30_000);

const green = (sha: string): PrSnapshot => ({ sha, mergeable: "MERGEABLE", mergeState: "CLEAN", checks: [{ name: "test", bucket: "pass" }] });
const red = (sha: string): PrSnapshot => ({ sha, mergeable: "MERGEABLE", mergeState: "UNSTABLE", checks: [{ name: "test", bucket: "fail" }] });

const stepPrompts = (repo: string, slug: string, pattern: RegExp): string[] => {
  const dir = join(runDir(repo, slug), "steps");
  return readdirSync(dir)
    .filter((f) => pattern.test(f) && f.endsWith(".prompt.md"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));
};

describe("distill → sign-off → answer", () => {
  const cycleIp = IP("draft").replace("- [ ] **T1** — Add greeting file", "- [ ] **T1** — Add greeting file\n  - Depends on: T2");

  test("rejects a cyclic draft and reaches sign-off only after a usable draft is written", async () => {
    const repo = tempRepo();
    const { config } = fakeSetup(repo, [
      { match: "distill (write the IP)", times: 1, write: { "docs/plans/g.md": cycleIp }, result: { status: "PASS", action: "drafted" } },
      { match: "distill (write the IP)", write: { "docs/plans/g.md": IP("draft") }, result: { status: "PASS", action: "repaired" } },
      { match: "cut (attack the IP)", result: { status: "PASS", action: "cut", findings: [] } },
    ]);
    const ctx = quietCtx(newState({ slug: "g", repo, ip: join(repo, "docs/plans/g.md"), base: "master", phase: "distill" }), config);
    await distill(ctx, "Add a greeting");
    expect(ctx.lines.join("\n")).toContain("unusable: Dependency cycle: T1 → T2 → T1");
    expect(ctx.state.history.filter((h) => h.stage === "distill")).toHaveLength(2);
    expect(ctx.state.waiting?.kind).toBe("signoff");
  });

  test.each([
    ["cycle", cycleIp, "T1 → T2 → T1"],
    ["unknown dependency", IP("draft").replace("- [ ] **T1** — Add greeting file", "- [ ] **T1** — Add greeting file\n  - Depends on: T99"), "T1 depends on unknown task T99"],
    ["self dependency", IP("draft").replace("- [ ] **T1** — Add greeting file", "- [ ] **T1** — Add greeting file\n  - Depends on: T1"), "T1 depends on itself"],
  ])("a draft with an unrepaired %s exhausts the two draft attempts without sign-off", async (_kind, text, problem) => {
    const repo = tempRepo();
    const { config } = fakeSetup(repo, [
      { match: "distill (write the IP)", write: { "docs/plans/g.md": text }, result: { status: "PASS", action: "drafted" } },
    ]);
    const ctx = quietCtx(newState({ slug: "g", repo, ip: join(repo, "docs/plans/g.md"), base: "master", phase: "distill" }), config);
    saveState(ctx.state);
    await expect(writeDraft(ctx, "Add a greeting")).rejects.toThrow(problem);
    expect(ctx.state.history).toHaveLength(2);
    expect(ctx.state.waiting).toBeUndefined();
    expect(readStatus(readIp(ctx.state.ip))).toBe("draft");
  });

  test("repairs an existing cycle even when Cut returns no findings", async () => {
    const repo = tempRepo();
    const { config } = fakeSetup(repo, [
      { match: "cut (attack the IP)", result: { status: "PASS", action: "cut", findings: [] } },
      { match: "distill step 10", write: { "docs/plans/g.md": IP("draft") }, result: { status: "PASS", action: "repaired" } },
    ]);
    const ctx = quietCtx(newState({ slug: "g", repo, ip: join(repo, "docs/plans/g.md"), base: "master", phase: "distill" }), config);
    mkdirSync(join(repo, "docs/plans"), { recursive: true });
    writeFileSync(ctx.state.ip, cycleIp);
    saveState(ctx.state);
    await sendForSignoff(ctx, await cutAndFix(ctx, [], 2));
    const [fix] = stepPrompts(repo, "g", /distill-alpha/);
    expect(fix).toContain("T1 → T2 → T1");
    expect(fix).toContain('"axis": "decomposition"');
    expect(ctx.state.waiting?.kind).toBe("signoff");
  });

  test("returns a cycle introduced by a fix as a blocking decomposition finding until repaired", async () => {
    const repo = tempRepo();
    const { config } = fakeSetup(repo, [
      { match: "distill (write the IP)", write: { "docs/plans/g.md": IP("draft") }, result: { status: "PASS", action: "drafted" } },
      { match: "cut (attack the IP)", agent: "alpha", times: 1, result: { status: "PASS", action: "cut", findings: [{ severity: "blocking", attack: "Split the task", evidence: "Two behaviors" }] } },
      { match: "cut (attack the IP)", result: { status: "PASS", action: "cut", findings: [] } },
      { match: "distill step 10", times: 1, write: { "docs/plans/g.md": cycleIp }, result: { status: "PASS", action: "fixed", structural: false } },
      { match: "distill step 10", write: { "docs/plans/g.md": IP("draft") }, result: { status: "PASS", action: "repaired", structural: false } },
    ]);
    const ctx = quietCtx(newState({ slug: "g", repo, ip: join(repo, "docs/plans/g.md"), base: "master", phase: "distill" }), config);
    await distill(ctx, "Add a greeting");
    const fixes = stepPrompts(repo, "g", /distill-alpha/).filter((p) => p.includes("## Step: distill step 10"));
    expect(fixes).toHaveLength(2);
    expect(fixes[1]).toContain("T1 → T2 → T1");
    expect(fixes[1]).toContain('"severity": "blocking"');
    expect(fixes[1]).toContain('"axis": "decomposition"');
    expect(ctx.state.cutRounds).toBe(2);
    expect(ctx.state.waiting?.kind).toBe("signoff");
    expect(readStatus(readIp(ctx.state.ip))).toStartWith("awaiting sign-off");
  });

  test("an unrepaired cycle introduced by a fix exhausts cut rounds and never reaches sign-off", async () => {
    const repo = tempRepo();
    const { config } = fakeSetup(repo, [
      { match: "distill (write the IP)", write: { "docs/plans/g.md": IP("draft") }, result: { status: "PASS", action: "drafted" } },
      { match: "cut (attack the IP)", agent: "alpha", times: 1, result: { status: "PASS", action: "cut", findings: [{ severity: "blocking", attack: "Split the task", evidence: "Two behaviors" }] } },
      { match: "cut (attack the IP)", result: { status: "PASS", action: "cut", findings: [] } },
      { match: "distill step 10", write: { "docs/plans/g.md": cycleIp }, result: { status: "PASS", action: "claimed fixed", structural: false } },
    ]);
    const ctx = quietCtx(newState({ slug: "g", repo, ip: join(repo, "docs/plans/g.md"), base: "master", phase: "distill" }), config);
    await expect(distill(ctx, "Add a greeting")).rejects.toThrow("T1 → T2 → T1");
    expect(ctx.state.cutRounds).toBe(config.limits.cutRounds);
    const fixes = stepPrompts(repo, "g", /distill-alpha/).filter((p) => p.includes("## Step: distill step 10"));
    expect(fixes).toHaveLength(2);
    expect(fixes[1]).toContain("T1 → T2 → T1");
    expect(ctx.state.waiting).toBeUndefined();
    expect(ctx.state.phase).toBe("distill");
    expect(readStatus(readIp(ctx.state.ip))).toBe("draft");
  });

  test("zero cut rounds cannot pass an existing invalid graph to sign-off", async () => {
    const repo = tempRepo();
    const { config } = fakeSetup(repo, []);
    const ctx = quietCtx(newState({ slug: "g", repo, ip: join(repo, "docs/plans/g.md"), base: "master", phase: "distill" }), config);
    mkdirSync(join(repo, "docs/plans"), { recursive: true });
    writeFileSync(ctx.state.ip, cycleIp);
    await expect(cutAndFix(ctx, [], 0)).rejects.toThrow("T1 → T2 → T1");
    expect(ctx.state.history).toHaveLength(0);
    expect(ctx.state.waiting).toBeUndefined();
  });

  test("writes the IP, cuts it in a clean tree with only the human's words, and waits for sign-off", async () => {
    const repo = tempRepo();
    const ask = { q: "Plain text or markdown?", rec: "Plain text", opts: ["Plain text", "Markdown"] };
    const { planPath, config } = fakeSetup(repo, [
      { match: "distill (write the IP)", write: { "docs/plans/greet.md": IP("draft") }, result: { status: "PASS", action: "sign off", ip: "docs/plans/greet.md", ask: [ask] } },
      { match: "cut", agent: "alpha", result: { status: "PASS", action: "attacked", findings: [{ severity: "blocking", where: "T2", attack: "Farewell was never requested", evidence: "request says greeting only" }] } },
      { match: "cut", agent: "beta", result: { status: "PASS", action: "attacked", findings: [{ severity: "nit", attack: "vibes", evidence: "" }] } },
      { match: "distill step 10", result: { status: "PASS", action: "fixed", structural: false, tally: { edited: 1, moved: 0, rebutted: 0 }, ask: [ask] } },
      { match: "distill step 12", result: { status: "PASS", action: "applied" } },
    ]);
    const state = newState({ slug: "greet", repo, ip: join(repo, "docs/plans/2026-09-27-greet.md"), base: "master", phase: "distill" });
    const ctx = quietCtx(state, config);

    await distill(ctx, "Add a greeting file.");

    expect(state.ip).toBe(join(repo, "docs/plans/greet.md"));
    expect(state.waiting?.kind).toBe("signoff");
    expect(readStatus(readIp(state.ip))).toStartWith("awaiting sign-off");
    expect(state.waiting?.message).toContain("1. Plain text or markdown? a) Plain text (recommended) b) Markdown");

    const calls = readFileSync(`${planPath}.calls.log`, "utf8").trim().split("\n").map((l) => l.split("\t"));
    const cutCalls = calls.filter((c) => c[1].startsWith("cut"));
    expect(cutCalls.map((c) => c[0]).sort()).toEqual(["alpha", "beta"]);
    expect(cutCalls.every((c) => c[2] !== repo && c[3] === "false")).toBe(true);

    const [fixPrompt] = stepPrompts(repo, "greet", /distill-alpha/).filter((p) => p.includes("## Step: distill step 10"));
    expect(fixPrompt).toContain("Farewell was never requested");
    expect(fixPrompt).not.toContain("vibes");

    const outcome = await answer(ctx, "ok, 1b");
    expect(outcome).toBe("approved");
    expect(readStatus(readIp(state.ip))).toStartWith("approved");
    expect(state.waiting).toBeUndefined();
    const context = readContext(state);
    expect(context).toContain("Add a greeting file.");
    expect(context).toContain("ok, 1b");
  });

  test("an answer without approval asks again instead of approving", async () => {
    const repo = tempRepo();
    const { config } = fakeSetup(repo, [
      { match: "distill (write the IP)", write: { "docs/plans/g.md": IP("draft") }, result: { status: "PASS", action: "x", ip: "docs/plans/g.md" } },
      { match: "cut", result: { status: "PASS", action: "x", findings: [] } },
      { match: "distill step 12", result: { status: "PASS", action: "applied", ask: [] } },
    ]);
    const state = newState({ slug: "g", repo, ip: join(repo, "docs/plans/g.md"), base: "master", phase: "distill" });
    const ctx = quietCtx(state, config);
    await distill(ctx, "Add a greeting");
    expect(await answer(ctx, "1b please")).toBe("waiting");
    expect(state.waiting?.kind).toBe("signoff");
    expect(readStatus(readIp(state.ip))).toStartWith("awaiting sign-off");
  });
});

describe("barrel", () => {
  const setupApproved = (plan: unknown[]): { repo: string; ctx: ReturnType<typeof quietCtx> } => {
    const repo = tempRepo();
    mkdirSync(join(repo, "docs/plans"), { recursive: true });
    writeFileSync(join(repo, "docs/plans/greet.md"), IP("approved 2026-09-27"));
    const { config } = fakeSetup(repo, plan);
    const state = newState({ slug: "greet", repo, ip: join(repo, "docs/plans/greet.md"), base: "master", phase: "approved" });
    return { repo, ctx: quietCtx(state, config) };
  };

  const diamond = IP("approved 2026-09-27").replace(
    "- [ ] **T1** — Add greeting file\n- [ ] **T2** — Add farewell file",
    "- [ ] **T1** — Root\n  - Depends on: none\n- [ ] **T2** — Left\n  - Depends on: T1\n- [ ] **T3** — Right\n  - Depends on: T1\n- [ ] **T4** — Join\n  - Depends on: T2, T3",
  );
  const successfulTasks = (ids: string[]) => [
    ...ids.flatMap((id) => [
      { match: `pick ${id}`, sleepMs: 250, write: { [`${id}.txt`]: `${id}\n` }, result: { status: "PASS", action: "built" } },
      { match: `roast ${id}`, result: { status: "PASS", action: "proven" } },
    ]),
    { match: "branch review", result: { status: "PASS", action: "reviewed", findings: [] } },
    { match: "brew", result: { status: "PASS", action: "opened", pr: 7 } },
  ];
  const timings = (ctx: ReturnType<typeof quietCtx>) => readFileSync(`${ctx.config.agents.alpha.env?.FAKE_PLAN}.timings.log`, "utf8")
    .trim().split("\n").map((line) => {
      const [step, event, at] = line.split("\t");
      return { step, event, at: Number(at) };
    });

  test("schedules a diamond concurrently and starts the join after both parents land", async () => {
    const { repo, ctx } = setupApproved(successfulTasks(["T1", "T2", "T3", "T4"]).map((entry) =>
      ["pick T2", "pick T3"].includes(entry.match)
        ? { ...entry, signal: entry.match, waitFor: [entry.match === "pick T2" ? "pick T3" : "pick T2"] } : entry));
    writeFileSync(ctx.state.ip, diamond);
    ctx.config.limits.parallelTasks = 2;
    // The join's setup sees the landed parent commits, including their IP marks.
    ctx.config.worktreeSetup = ["if test -f T2.txt && test -f T3.txt; then git show HEAD:docs/plans/greet.md > parents.md; fi"];
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("done");
    const events = timings(ctx);
    const at = (id: string, event: string) => events.find((e) => e.step.startsWith(`pick ${id} `) && e.event === event)!.at;
    expect(at("T2", "start")).toBeLessThan(at("T3", "end"));
    expect(at("T3", "start")).toBeLessThan(at("T2", "end"));
    expect(at("T4", "start")).toBeGreaterThanOrEqual(Math.max(at("T2", "end"), at("T3", "end")));
    expect(parseTasks(readFileSync(join(repo, "parents.md"), "utf8")).map((t) => t.done)).toEqual([true, true, true, false]);
    expect(run(repo, "git", "rev-list", "--count", "master..HEAD")).toBe("4");
    expect(parseTasks(readIp(ctx.state.ip)).every((t) => t.done)).toBe(true);
    expect(ctx.state.tasks.T2.attempts).toBe(1);
    expect(ctx.state.tasks.T3.attempts).toBe(1);
    expect(ctx.state.parallelRan).toBe(true);
    expect(run(repo, "git", "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });

  test("limits a three-task ready frontier to two simultaneous builds", async () => {
    const { repo, ctx } = setupApproved(successfulTasks(["T1", "T2", "T3"]).map((entry) =>
      ["pick T1", "pick T2"].includes(entry.match)
        ? { ...entry, signal: entry.match, waitFor: [entry.match === "pick T1" ? "pick T2" : "pick T1"] } : entry));
    writeFileSync(ctx.state.ip, IP("approved 2026-09-27").replace(
      "- [ ] **T2** — Add farewell file",
      "- [ ] **T2** — Add farewell file\n  - Depends on: none\n- [ ] **T3** — Third\n  - Depends on: none",
    ));
    ctx.config.limits.parallelTasks = 2;
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("done");
    const events = timings(ctx);
    const thirdStart = events.find((e) => e.step.startsWith("pick T3 ") && e.event === "start")!.at;
    const parentEnds = events.filter((e) => /^roast T[12] /.test(e.step) && e.event === "end").map((e) => e.at);
    expect(thirdStart).toBeGreaterThanOrEqual(Math.min(...parentEnds));
    expect(run(repo, "git", "rev-list", "--count", "master..HEAD")).toBe("3");
  });

  test("CLI --parallel 1 overrides config and runs the diamond strictly in order", async () => {
    const { repo, ctx } = setupApproved([
      ...successfulTasks(["T1", "T2", "T3", "T4"]).filter((entry) => entry.match !== "brew"),
      { match: "brew", result: { status: "BLOCKED", action: "test stops before external CI" } },
    ]);
    writeFileSync(ctx.state.ip, diamond);
    saveState(ctx.state);
    const proc = Bun.spawn(["bun", join(import.meta.dir, "../src/cli.ts"), "barrel", "greet", "--repo", repo, "--parallel", "1", "--no-wait"], { stdout: "pipe", stderr: "pipe", env: { ...process.env } });
    const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
    expect(await proc.exited).toBe(3);
    expect(err).toBe("");
    expect(out).toContain("test stops before external CI");
    expect(JSON.parse(readFileSync(join(runDir(repo, "greet"), "state.json"), "utf8")).parallelRan).toBeUndefined();
    const events = timings(ctx);
    expect(events.filter((e) => e.step.startsWith("pick ") && e.event === "start").map((e) => e.step.split(" ")[1])).toEqual(["T1", "T2", "T3", "T4"]);
    for (let i = 1; i < 4; i++) {
      const start = events.find((e) => e.step.startsWith(`pick T${i + 1} `) && e.event === "start")!.at;
      const end = events.find((e) => e.step.startsWith(`roast T${i} `) && e.event === "end")!.at;
      expect(start).toBeGreaterThanOrEqual(end);
    }
    expect(run(repo, "git", "rev-list", "--count", "master..HEAD")).toBe("4");
  }, 60_000);

  test("rebuilds a conflicting independent task once on the new head and lands both", async () => {
    const { repo, ctx } = setupApproved([
      { match: "pick T1", sleepMs: 250, write: { "shared.txt": "one\n" }, result: { status: "PASS", action: "built" } },
      { match: "pick T2", sleepMs: 500, write: { "shared.txt": "two\n" }, result: { status: "PASS", action: "built" } },
      { match: "roast", result: { status: "PASS", action: "proven" } },
      ...successfulTasks([]),
    ]);
    writeFileSync(ctx.state.ip, IP("approved 2026-09-27").replace("- [ ] **T2** — Add farewell file", "- [ ] **T2** — Add farewell file\n  - Depends on: none"));
    ctx.config.limits.parallelTasks = 2;
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("done");
    expect(Object.values(ctx.state.tasks).map((t) => t.attempts).sort()).toEqual([1, 2]);
    const retried = Object.entries(ctx.state.tasks).find(([, t]) => t.attempts === 2)![0];
    const prompts = stepPrompts(repo, "greet", new RegExp(`-pick-${retried}-`));
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("shared.txt");
    expect(prompts[1]).toContain("rebuild on the new head");
    expect(prompts[1]).toContain(`${retried === "T1" ? "T2" : "T1"} landed first and touched these`);
    expect(run(repo, "git", "rev-list", "--count", "master..HEAD")).toBe("2");
    expect(run(repo, "git", "show", `${ctx.state.tasks.T1.commit}:shared.txt`)).toBe("one");
    expect(run(repo, "git", "show", `${ctx.state.tasks.T2.commit}:shared.txt`)).toBe("two");
    expect(parseTasks(readIp(ctx.state.ip)).map((t) => t.done)).toEqual([true, true]);
    expect(run(repo, "git", "status", "--porcelain")).toBe("");
    expect(run(repo, "git", "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });

  test("drains a running sibling after a gate without starting newly ready tasks", async () => {
    const { repo, ctx } = setupApproved([
      ...successfulTasks(["T1"]),
      { match: "pick T2", signal: "left", waitFor: ["right"], result: { status: "BLOCKED", action: "choose left behavior" } },
      ...successfulTasks(["T3"]).map((entry) => entry.match === "pick T3" ? { ...entry, signal: "right", waitForTask: { id: "T2", status: "todo" } } : entry),
    ]);
    writeFileSync(ctx.state.ip, diamond.replace("  - Depends on: T2, T3", "  - Depends on: T3"));
    ctx.config.limits.parallelTasks = 2;
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("waiting");
    expect(ctx.state.waiting?.task).toBe("T2");
    expect(ctx.state.waiting?.message).toContain("choose left behavior");
    expect(ctx.state.tasks.T3.status).toBe("passed");
    expect(readFileSync(join(repo, "T3.txt"), "utf8")).toBe("T3\n");
    expect(ctx.state.tasks.T4.status).toBe("todo");
    expect(ctx.state.history.some((entry) => entry.task === "T4")).toBe(false);
    expect(ctx.state.phase).toBe("build");
    expect(parseTasks(readIp(ctx.state.ip)).map((t) => t.done)).toEqual([true, false, true, false]);
  });

  test("preserves the first gate and resets later gated siblings to todo", async () => {
    const { repo, ctx } = setupApproved([
      ...successfulTasks(["T1"]),
      { match: "pick T2", signal: "left", waitFor: ["right"], result: { status: "BLOCKED", action: "first choice" } },
      { match: "pick T3", signal: "right", waitForTask: { id: "T2", status: "todo" }, write: { "discard.txt": "partial\n" }, result: { status: "BLOCKED", action: "second choice" } },
    ]);
    writeFileSync(ctx.state.ip, diamond);
    ctx.config.limits.parallelTasks = 2;
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("waiting");
    expect(ctx.state.waiting?.task).toBe("T2");
    expect(ctx.state.waiting?.message).toContain("first choice");
    expect(ctx.state.tasks.T3.status).toBe("todo");
    expect(ctx.state.tasks.T3.worktree).toBeUndefined();
    expect(existsSync(join(runDir(repo, "greet"), "worktrees", "T3"))).toBe(false);
    expect(existsSync(join(repo, "discard.txt"))).toBe(false);
    expect(ctx.lines.filter((line) => line.startsWith("Waiting. Answer with:"))).toHaveLength(1);
  });

  test("cleans an interrupted running task and discards its partial commit on resume", async () => {
    const { repo, ctx } = setupApproved(successfulTasks(["T1", "T2"]));
    run(repo, "git", "add", "docs/plans/greet.md");
    run(repo, "git", "commit", "-m", "Approved plan");
    run(repo, "git", "checkout", "-b", "greet");
    const tree = join(runDir(repo, "greet"), "worktrees", "T1");
    run(repo, "git", "worktree", "add", "-b", "brewery/greet/T1", tree, "HEAD");
    writeFileSync(join(tree, "partial.txt"), "discard this\n");
    run(tree, "git", "add", "partial.txt");
    run(tree, "git", "commit", "-m", "Interrupted partial work");
    ctx.state.phase = "build";
    ctx.state.branch = "greet";
    ctx.state.tasks.T1 = { status: "running", attempts: 1, worktree: tree, branch: "brewery/greet/T1", commit: run(tree, "git", "rev-parse", "HEAD") };
    saveState(ctx.state);
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("done");
    expect(existsSync(join(repo, "partial.txt"))).toBe(false);
    expect(ctx.state.tasks.T1.attempts).toBe(2);
    expect(ctx.state.tasks.T1.status).toBe("passed");
    expect(ctx.state.tasks.T1.worktree).toBeUndefined();
    expect(stepPrompts(repo, "greet", /-pick-T1-/)[0]).toContain("Interrupted build");
    expect(run(repo, "git", "log", "--format=%s", "master..HEAD").split("\n")).toEqual(["Add farewell file", "Add greeting file"]);
    expect(run(repo, "git", "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
  });

  test.each([[false, false], [true, false], [true, true]])("restores the approved IP after a preflight landing failure (tracked IP=%s, tracked collision=%s)", async (tracked, trackedCollision) => {
    const repo = tempRepo();
    const ip = join(repo, "docs/plans/greet.md");
    mkdirSync(join(repo, "docs/plans"), { recursive: true });
    writeFileSync(ip, IP("approved 2026-09-27"));
    if (tracked) {
      writeFileSync(ip, IP("draft"));
      run(repo, "git", "add", "docs/plans/greet.md");
      run(repo, "git", "commit", "-m", "Draft plan");
      writeFileSync(ip, IP("approved 2026-09-27"));
      run(repo, "git", "add", "docs/plans/greet.md");
    }
    if (trackedCollision) {
      run(repo, "git", "restore", "--staged", "docs/plans/greet.md");
      writeFileSync(join(repo, "collision.txt"), "baseline\n");
      run(repo, "git", "add", "collision.txt");
      run(repo, "git", "commit", "-m", "Baseline collision");
      run(repo, "git", "add", "docs/plans/greet.md");
    }
    const tree = join(runDir(repo, "greet"), "worktrees", "T1");
    const { config } = fakeSetup(repo, [
      { match: "pick T1", write: { "collision.txt": "task output\n" }, result: { status: "PASS", action: "built" } },
      { match: "roast T1", write: { [relative(tree, join(repo, "collision.txt"))]: "keep external file\n" }, result: { status: "PASS", action: "proven" } },
    ]);
    const ctx = quietCtx(newState({ slug: "greet", repo, ip, base: "master", phase: "approved" }), config);
    await expect(barrel(ctx, fakeCi([green("a")]))).rejects.toThrow(trackedCollision ? "uncommitted changes" : "would be overwritten");
    expect(readIp(ip)).toBe(IP("approved 2026-09-27"));
    expect(readFileSync(join(repo, "collision.txt"), "utf8")).toBe("keep external file\n");
    expect(ctx.state.landing).toBeUndefined();
    expect(run(repo, "git", "log", "--format=%s", "master..HEAD")).toBe("");
    if (tracked) expect(run(repo, "git", "diff", "--cached")).toContain("approved 2026-09-27");
  });

  test("rolls back an interrupted cherry-pick before rebuilding a running task", async () => {
    const { repo, ctx } = setupApproved(successfulTasks(["T1", "T2"]));
    run(repo, "git", "add", "docs/plans/greet.md");
    run(repo, "git", "commit", "-m", "Approved plan");
    run(repo, "git", "checkout", "-b", "greet");
    const before = run(repo, "git", "rev-parse", "HEAD");
    const tree = join(runDir(repo, "greet"), "worktrees", "T1");
    run(repo, "git", "worktree", "add", "-b", "brewery/greet/T1", tree, "HEAD");
    writeFileSync(join(tree, "T1.txt"), "T1\n");
    writeFileSync(join(tree, "partial.txt"), "discard transaction\n");
    run(tree, "git", "add", "-A");
    run(tree, "git", "commit", "-m", "Unfinished landing");
    const commit = run(tree, "git", "rev-parse", "HEAD");
    run(repo, "git", "cherry-pick", commit);
    ctx.state.phase = "build";
    ctx.state.branch = "greet";
    ctx.state.tasks.T1 = { status: "running", attempts: 1, worktree: tree, branch: "brewery/greet/T1", commit };
    ctx.state.landing = { task: "T1", head: before, ip: readIp(ctx.state.ip) };
    saveState(ctx.state);
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("done");
    expect(ctx.state.landing).toBeUndefined();
    expect(existsSync(join(repo, "partial.txt"))).toBe(false);
    expect(ctx.state.tasks.T1.attempts).toBe(2);
    expect(run(repo, "git", "log", "--format=%s", "master..HEAD").split("\n")).toEqual(["Add farewell file", "Add greeting file"]);
    expect(parseTasks(readIp(ctx.state.ip)).every((task) => task.done)).toBe(true);
  });

  test("status reports running tasks and invalid parallel overrides fail clearly", async () => {
    const { repo, ctx } = setupApproved([]);
    ctx.state.tasks = { T2: { status: "running", attempts: 1 }, T3: { status: "running", attempts: 1 } };
    saveState(ctx.state);
    const cli = join(import.meta.dir, "../src/cli.ts");
    const status = Bun.spawnSync(["bun", cli, "status", "greet"], { cwd: repo, env: { ...process.env } });
    expect(status.exitCode).toBe(0);
    expect(status.stdout.toString()).toContain("running T2, T3");
    for (const value of ["", "0", "-1", "1.5", "nope", "9007199254740992"]) {
      const proc = Bun.spawnSync(["bun", cli, "barrel", "greet", "--repo", repo, "--parallel", ...(value ? [value] : []), "--no-wait"], { env: { ...process.env } });
      expect(proc.exitCode).toBe(1);
      expect(proc.stderr.toString()).toContain("--parallel needs a positive integer");
    }
  });

  test("builds every task with a separate roast, amends retries, and finishes green", async () => {
    const { repo, ctx } = setupApproved([
      { match: "pick T1", times: 1, write: { "greeting.txt": "helo\n" }, result: { status: "PASS", action: "built" } },
      { match: "roast T1", times: 1, result: { status: "FAIL", action: "fix typo", fail: [{ need: "says hello", want: "hello", got: "helo", ev: "cat greeting.txt" }] } },
      { match: "pick T1", times: 1, write: { "greeting.txt": "hello\n" }, result: { status: "PASS", action: "fixed" } },
      { match: "roast T1", result: { status: "PASS", action: "proven" } },
      { match: "pick T2", write: { "farewell.txt": "bye\n" }, result: { status: "PASS", action: "built" } },
      { match: "roast T2", result: { status: "PASS", action: "proven" } },
      { match: "branch review", result: { status: "PASS", action: "reviewed", findings: [] } },
      { match: "brew", result: { status: "PASS", action: "opened", pr: 7 } },
    ]);
    const ci = fakeCi([green("abc")]);

    expect(await barrel(ctx, ci)).toBe("done");

    expect(run(repo, "git", "rev-parse", "--abbrev-ref", "HEAD")).toBe("greet");
    expect(run(repo, "git", "log", "--format=%s", "master..HEAD").split("\n")).toEqual(["Add farewell file", "Add greeting file"]);
    expect(run(repo, "git", "show", "HEAD~1:greeting.txt")).toBe("hello");
    expect(run(repo, "git", "status", "--porcelain")).toBe("");
    expect(parseTasks(readIp(ctx.state.ip)).every((t) => t.done)).toBe(true);
    expect(ctx.state.phase).toBe("done");
    expect(ctx.state.pr).toBe(7);

    const pickT1 = stepPrompts(repo, "greet", /-pick-T1-/);
    expect(pickT1).toHaveLength(2);
    expect(pickT1[0]).not.toContain("This is a retry");
    expect(pickT1[1]).toContain("helo");
    // roast ran as beta, a different agent from pick's alpha
    expect(ctx.state.history.filter((h) => h.stage === "roast").every((h) => h.agent === "beta")).toBe(true);
  });

  test("builds and roasts in task worktrees, then lands checked commits and removes branches", async () => {
    const { repo, ctx } = setupApproved([
      { match: "pick T1", write: { "greeting.txt": "hello\n" }, result: { status: "PASS", action: "built" } },
      { match: "roast T1", result: { status: "PASS", action: "proven" } },
      { match: "pick T2", write: { "farewell.txt": "bye\n" }, result: { status: "PASS", action: "built" } },
      { match: "roast T2", result: { status: "PASS", action: "proven" } },
      { match: "branch review", result: { status: "PASS", action: "ok", findings: [] } },
      { match: "brew", result: { status: "PASS", action: "opened", pr: 7 } },
    ]);
    const logFile = `${ctx.config.agents.alpha.env?.FAKE_PLAN}.calls.log`;
    ctx.config.worktreeSetup = [
      `printf ready > setup.txt; printf 'setup\\tsetup one\\t%s\\tfalse\\n' "$PWD" >> '${logFile}'`,
      `test -f setup.txt && printf 'setup\\tsetup two\\t%s\\tfalse\\n' "$PWD" >> '${logFile}'`,
    ];
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("done");
    const calls = readFileSync(`${ctx.config.agents.alpha.env?.FAKE_PLAN}.calls.log`, "utf8")
      .trim().split("\n").map((line) => line.split("\t"));
    for (const id of ["T1", "T2"]) {
      const tree = join(runDir(repo, "greet"), "worktrees", id);
      expect(calls.filter((call) => call[1].startsWith(`pick ${id}`) || call[1].startsWith(`roast ${id}`))
        .map((call) => call[2])).toEqual([tree, tree]);
      expect(calls.filter((call) => call[2] === tree).map((call) => call[1])).toEqual([
        "setup one", "setup two",
        `pick ${id} — ${id === "T1" ? "Add greeting file" : "Add farewell file"}`,
        `roast ${id} — ${id === "T1" ? "Add greeting file" : "Add farewell file"}`,
      ]);
      expect(existsSync(tree)).toBe(false);
      expect(run(repo, "git", "branch", "--list", `brewery/greet/${id}`)).toBe("");
      expect(stepPrompts(repo, "greet", new RegExp(`-pick-${id}-`))[0]).toContain(`IP at ${tree}/docs/plans/greet.md`);
      expect(stepPrompts(repo, "greet", new RegExp(`-pick-${id}-`))[0]).toContain(`run in ${tree}`);
    }
    expect(run(repo, "git", "worktree", "list", "--porcelain").match(/^worktree /gm)).toHaveLength(1);
    expect(parseTasks(run(repo, "git", "show", "HEAD~1:docs/plans/greet.md")).map((task) => task.done)).toEqual([true, false]);
    expect(parseTasks(run(repo, "git", "show", "HEAD:docs/plans/greet.md")).map((task) => task.done)).toEqual([true, true]);
    expect(ctx.state.tasks.T1.commit).toBe(run(repo, "git", "rev-parse", "HEAD~1"));
    expect(ctx.state.tasks.T2.commit).toBe(run(repo, "git", "rev-parse", "HEAD"));
    expect(readFileSync(join(repo, "setup.txt"), "utf8")).toBe("ready");
  });

  test("counts setup failures as attempts, preserves output, and gates without starting pick", async () => {
    const { repo, ctx } = setupApproved([]);
    ctx.config.limits.pickAttempts = 2;
    ctx.config.worktreeSetup = ["printf 'setup stdout'; printf 'setup stderr' >&2; exit 7"];
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("waiting");
    expect(ctx.state.tasks.T1.attempts).toBe(2);
    expect(ctx.state.tasks.T1.evidence).toContain("Worktree setup FAIL");
    expect(ctx.state.tasks.T1.evidence).toContain("exit 7");
    expect(ctx.state.tasks.T1.evidence).toContain("setup stdout");
    expect(ctx.state.tasks.T1.evidence).toContain("setup stderr");
    expect(ctx.state.waiting?.task).toBe("T1");
    expect(ctx.state.waiting?.message).toContain("setup stderr");
    expect(ctx.state.history).toHaveLength(0);
    expect(existsSync(join(runDir(repo, "greet"), "worktrees", "T1"))).toBe(false);
    expect(run(repo, "git", "branch", "--list", "brewery/greet/T1")).toBe("");
    expect(parseTasks(readIp(ctx.state.ip)).map((task) => task.done)).toEqual([false, false]);
    expect(run(repo, "git", "log", "--format=%s", "master..HEAD")).toBe("");
  });

  test("uses tracked approval edits in the worktree and lands them with the task", async () => {
    const { repo, ctx } = setupApproved([
      { match: "pick T1", write: { "greeting.txt": "hello\n" }, result: { status: "PASS", action: "built" } },
      { match: "roast T1", result: { status: "PASS", action: "proven" } },
      { match: "pick T2", result: { status: "BLOCKED", action: "pause" } },
    ]);
    writeFileSync(ctx.state.ip, IP("draft"));
    run(repo, "git", "add", "docs/plans/greet.md");
    run(repo, "git", "commit", "-m", "Draft plan");
    writeFileSync(ctx.state.ip, IP("approved 2026-09-27").replace("A text file.", "A text file with an approved specification."));
    // Both staged and unstaged IP edits are allowed by ensureBranch.
    run(repo, "git", "add", "docs/plans/greet.md");
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("waiting");
    const landed = run(repo, "git", "show", "HEAD:docs/plans/greet.md");
    expect(readStatus(landed)).toBe("approved 2026-09-27");
    expect(landed).toContain("approved specification");
    expect(parseTasks(landed).map((task) => task.done)).toEqual([true, false]);
  });

  test("retains a gated task's implementation for retry and still lands one commit", async () => {
    const { repo, ctx } = setupApproved([
      { match: "pick T1", times: 1, write: { "greeting.txt": "helo\n", "retained.txt": "keep\n" }, result: { status: "PASS", action: "built" } },
      { match: "roast T1", times: 1, result: { status: "FAIL", action: "fix typo" } },
      { match: "pick T1", write: { "greeting.txt": "hello\n" }, result: { status: "PASS", action: "fixed" } },
      { match: "roast T1", result: { status: "PASS", action: "proven" } },
      { match: "pick T2", result: { status: "BLOCKED", action: "pause" } },
    ]);
    ctx.config.limits.pickAttempts = 1;
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("waiting");
    const tree = join(runDir(repo, "greet"), "worktrees", "T1");
    expect(existsSync(join(tree, "retained.txt"))).toBe(true);
    expect(ctx.state.tasks.T1.commit).toBe(run(tree, "git", "rev-parse", "HEAD"));
    expect(await answer(ctx, "retry: fix the typo")).toBe("continue");
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("waiting");
    expect(readFileSync(join(repo, "retained.txt"), "utf8")).toBe("keep\n");
    expect(readFileSync(join(repo, "greeting.txt"), "utf8")).toBe("hello\n");
    expect(run(repo, "git", "log", "--format=%s", "master..HEAD")).toBe("Add greeting file");
    expect(existsSync(tree)).toBe(false);
  });

  test("refuses an IP that is not approved", async () => {
    const { ctx } = setupApproved([]);
    writeFileSync(ctx.state.ip, IP("awaiting sign-off"));
    await expect(barrel(ctx, fakeCi([green("a")]))).rejects.toThrow("not approved");
  });

  test("gates a task after the attempt limit, and 'skip' moves past it", async () => {
    const { ctx } = setupApproved([
      { match: "pick T1", result: { status: "FAIL", action: "cannot", fail: [{ need: "x", want: "y", got: "z", ev: "e" }] } },
      { match: "pick T2", write: { "farewell.txt": "bye\n" }, result: { status: "PASS", action: "built" } },
      { match: "roast T2", result: { status: "PASS", action: "proven" } },
      { match: "branch review", result: { status: "PASS", action: "ok", findings: [] } },
      { match: "brew", result: { status: "PASS", action: "opened", pr: 7 } },
    ]);
    ctx.config.limits.pickAttempts = 2;
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("waiting");
    expect(ctx.state.waiting?.task).toBe("T1");
    expect(await answer(ctx, "skip")).toBe("continue");
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("done");
    expect(ctx.state.tasks.T1.status).toBe("skipped");
  });
});

describe("finish", () => {
  test("reacts to a red head, counts the push, and stops when green", async () => {
    const repo = tempRepo();
    const { config } = fakeSetup(repo, [{ match: "taste", result: { status: "PASS", action: "fixed and pushed", sha: "b" } }]);
    const ctx = quietCtx(newState({ slug: "pr-7", repo, ip: "", base: "master", phase: "finish" }), config);
    const ci = fakeCi([red("a"), green("b"), green("b")]);
    expect(await finish(ctx, ci, 7)).toBe("done");
    expect(ctx.state.finish?.pushes).toBe(1);
    expect(ctx.state.history.filter((h) => h.stage === "taste")).toHaveLength(1);
  });

  test("gates when the same failure survives two reactions", async () => {
    const repo = tempRepo();
    const { config } = fakeSetup(repo, [{ match: "taste", result: { status: "PASS", action: "reran" } }]);
    const ctx = quietCtx(newState({ slug: "pr-7", repo, ip: "", base: "master", phase: "finish" }), config);
    expect(await finish(ctx, fakeCi([red("a")]), 7)).toBe("waiting");
    expect(ctx.state.waiting?.kind).toBe("gate");
    expect(ctx.state.history.filter((h) => h.stage === "taste")).toHaveLength(2);
  });
});
