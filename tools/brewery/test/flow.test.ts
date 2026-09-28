// End-to-end runs against a temp git repo with scripted fake agents.
import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { answer } from "../src/commands/answer.ts";
import { barrel } from "../src/commands/barrel.ts";
import { distill } from "../src/commands/distill.ts";
import { finish } from "../src/commands/finish.ts";
import { readIp, readStatus, parseTasks } from "../src/ip.ts";
import { runStage } from "../src/step.ts";
import { loadState, newState, readContext, runDir, saveState } from "../src/state.ts";
import type { PrSnapshot } from "../src/vcs.ts";
import { fakeCi, fakeSetup, IP, quietCtx, run, tempRepo } from "./helpers.ts";

const green = (sha: string): PrSnapshot => ({ sha, mergeable: "MERGEABLE", mergeState: "CLEAN", checks: [{ name: "test", bucket: "pass" }] });
const red = (sha: string): PrSnapshot => ({ sha, mergeable: "MERGEABLE", mergeState: "UNSTABLE", checks: [{ name: "test", bucket: "fail" }] });
const pending = (sha: string): PrSnapshot => ({ sha, mergeable: "MERGEABLE", mergeState: "BLOCKED", checks: [{ name: "test", bucket: "pending" }] });

const events = (repo: string, slug: string): Record<string, unknown>[] =>
  readFileSync(join(runDir(repo, slug), "events.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));

const stepPrompts = (repo: string, slug: string, pattern: RegExp): string[] => {
  const dir = join(runDir(repo, slug), "steps");
  return readdirSync(dir)
    .filter((f) => pattern.test(f) && f.endsWith(".prompt.md"))
    .sort()
    .map((f) => readFileSync(join(dir, f), "utf8"));
};

test("brewery note records verbatim mid-run text for later steps without changing phase", async () => {
  const repo = tempRepo();
  const { config } = fakeSetup(repo, [{ match: "check notes", result: { status: "PASS", action: "read" } }]);
  const state = newState({ slug: "greet", repo, ip: "", base: "master", phase: "build" });
  saveState(state);
  const note = "  Keep the existing title.\nUse the short label.  ";
  const command = Bun.spawnSync(["bun", join(import.meta.dir, "../src/cli.ts"), "note", "greet", note, "--repo", repo], { cwd: repo, env: process.env });
  expect(command.exitCode).toBe(0);
  const saved = JSON.parse(readFileSync(join(runDir(repo, "greet"), "state.json"), "utf8"));
  expect(saved.notes).toEqual([note]);
  expect(saved.phase).toBe("build");
  expect(readContext(state)).toContain(note);
  expect(events(repo, "greet").at(-1)).toMatchObject({ kind: "note", text: note });

  const ctx = quietCtx(saved, config);
  await runStage(ctx, "pick", "check notes", { task: "T3" });
  expect(stepPrompts(repo, "greet", /pick-T3/)[0]).toContain(note);
  expect(stepPrompts(repo, "greet", /pick-T3/)[0]).toContain("the human added, mid-run");

  // An already-running process may still hold the state from before the note.
  state.seq = ctx.state.seq;
  saveState(state);
  expect(loadState("greet", repo).notes).toEqual([note]);
  const staleCtx = quietCtx(state, config);
  await runStage(staleCtx, "pick", "check notes", { task: "T4" });
  expect(stepPrompts(repo, "greet", /pick-T4/)[0]).toContain(note);
});

test("brewery note rejects missing and blank text without changing the run", () => {
  const repo = tempRepo();
  fakeSetup(repo, []);
  const state = newState({ slug: "greet", repo, ip: "", base: "master", phase: "build" });
  saveState(state);
  for (const args of [["note", "greet"], ["note", "greet", "  "]]) {
    const command = Bun.spawnSync(["bun", join(import.meta.dir, "../src/cli.ts"), ...args, "--repo", repo], { cwd: repo, env: process.env });
    expect(command.exitCode).toBe(1);
  }
  expect(readContext(state)).toBe("");
  expect(JSON.parse(readFileSync(join(runDir(repo, "greet"), "state.json"), "utf8")).notes).toEqual([]);
});

test("brewery note preserves simultaneous notes and text starting with dashes", async () => {
  const repo = tempRepo();
  fakeSetup(repo, []);
  const state = newState({ slug: "greet", repo, ip: "", base: "master", phase: "build" });
  saveState(state);
  const notes = ["-- keep the title", "Use the shorter label"];
  const commands = notes.map((note) => Bun.spawn(["bun", join(import.meta.dir, "../src/cli.ts"), "note", "greet", note, "--repo", repo], { cwd: repo, env: process.env }));
  expect(await Promise.all(commands.map((command) => command.exited))).toEqual([0, 0]);
  expect(loadState("greet", repo).notes?.sort()).toEqual([...notes].sort());
  for (const note of notes) expect(readContext(state)).toContain(note);
});

test("resume recovers a killed roast and rejects concurrent run commands", async () => {
  const repo = tempRepo();
  mkdirSync(join(repo, "docs/plans"), { recursive: true });
  const ip = join(repo, "docs/plans/greet.md");
  writeFileSync(ip, IP("approved 2026-09-28"));
  fakeSetup(repo, [
    { match: "pick T1", write: { "greeting.txt": "hello\n" }, result: { status: "PASS", action: "built" } },
    { match: "roast T1", times: 1, sleepMs: 30000, result: { status: "PASS", action: "proven" } },
    { match: "roast T1", result: { status: "PASS", action: "proven" } },
    { match: "pick T2", result: { status: "BLOCKED", action: "needs decision", ask: [{ q: "Proceed?", rec: "retry", opts: ["retry", "stop"] }] } },
  ]);
  const state = newState({ slug: "greet", repo, ip, base: "master", phase: "approved" });
  saveState(state);
  const cli = join(import.meta.dir, "../src/cli.ts");
  const first = Bun.spawn(["bun", cli, "barrel", "greet", "--repo", repo, "--no-wait"], { cwd: repo, env: process.env, stdout: "pipe", stderr: "pipe" });
  const pidFile = join(runDir(repo, "greet"), "run.pid");
  try {
    for (let i = 0; i < 200 && (!existsSync(join(runDir(repo, "greet"), "events.jsonl")) || !events(repo, "greet").some((e) => e.kind === "step.start" && e.stage === "roast")); i++) await Bun.sleep(25);
    expect(existsSync(pidFile)).toBe(true);
    expect(Number(readFileSync(pidFile, "utf8"))).toBe(first.pid);
    const second = Bun.spawnSync(["bun", cli, "resume", "greet", "--repo", repo, "--go", "--no-wait"], { cwd: repo, env: process.env });
    expect(second.exitCode).toBe(1);
    expect(second.stderr.toString()).toContain("already running");
    first.kill("SIGKILL");
    await first.exited;
    const resumed = Bun.spawnSync(["bun", cli, "resume", "greet", "--repo", repo, "--go", "--no-wait"], { cwd: repo, env: process.env });
    expect(resumed.exitCode).toBe(3);
    expect(loadState("greet", repo).waiting?.kind).toBe("gate");
    expect(loadState("greet", repo).tasks.T1.status).toBe("passed");
    expect(events(repo, "greet").filter((e) => e.kind === "step.start" && e.stage === "roast")).toHaveLength(2);
    expect(existsSync(pidFile)).toBe(false);
  } finally {
    first.kill("SIGKILL");
  }
});

describe("distill → sign-off → answer", () => {
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
    const beforeAnswer = events(repo, "greet");
    expect(beforeAnswer.filter((event) => event.kind === "step.start")).toHaveLength(4);
    expect(beforeAnswer.filter((event) => event.kind === "step.end")).toHaveLength(4);
    for (const start of beforeAnswer.filter((event) => event.kind === "step.start")) {
      const end = beforeAnswer.find((event) => event.kind === "step.end" && event.seq === start.seq);
      expect(end).toBeDefined();
      expect(beforeAnswer.indexOf(start)).toBeLessThan(beforeAnswer.indexOf(end as Record<string, unknown>));
    }
    expect(beforeAnswer[0]).toMatchObject({ kind: "step.start", seq: 1, stage: "distill", agent: "alpha" });
    expect(beforeAnswer[1]).toMatchObject({ kind: "step.end", seq: 1, status: "PASS", action: "sign off" });
    expect(beforeAnswer.at(-1)).toMatchObject({ kind: "waiting", waitingKind: "signoff", ip: state.ip, message: state.waiting?.message });
    expect(beforeAnswer.every((event) => typeof event.t === "string" && !Number.isNaN(Date.parse(String(event.t))))).toBe(true);

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
    expect(events(repo, "greet").slice(-4).map((event) => event.kind)).toEqual(["resumed", "note", "step.start", "step.end"]);
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
    const stream = events(repo, "greet");
    expect(stream.filter((event) => event.kind === "step.start" && event.task === "T1").map((event) => event.stage)).toEqual(["pick", "roast", "pick", "roast"]);
    expect(stream.filter((event) => event.kind === "pr")).toEqual([expect.objectContaining({ kind: "pr", number: 7, url: "https://example.test/pr/7" })]);
    expect(stream.filter((event) => event.kind === "ci").map((event) => event.state)).toEqual(["pass"]);
    expect(stream.at(-1)).toMatchObject({ kind: "done" });

    const pickT1 = stepPrompts(repo, "greet", /-pick-T1-/);
    expect(pickT1).toHaveLength(2);
    expect(pickT1[0]).not.toContain("This is a retry");
    expect(pickT1[1]).toContain("helo");
    // roast ran as beta, a different agent from pick's alpha
    expect(ctx.state.history.filter((h) => h.stage === "roast").every((h) => h.agent === "beta")).toBe(true);
  });

  test("refuses an IP that is not approved", async () => {
    const { repo, ctx } = setupApproved([]);
    writeFileSync(ctx.state.ip, IP("awaiting sign-off"));
    await expect(barrel(ctx, fakeCi([green("a")]))).rejects.toThrow("not approved");
    saveState(ctx.state);
    const command = Bun.spawnSync(["bun", join(import.meta.dir, "../src/cli.ts"), "barrel", "greet", "--repo", repo], { cwd: repo, env: process.env });
    expect(command.exitCode).toBe(1);
    expect(events(repo, "greet").at(-1)).toMatchObject({ kind: "error", message: expect.stringContaining("not approved") });
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
    expect(events(ctx.state.repo, "greet").at(-1)).toMatchObject({ kind: "waiting", waitingKind: "gate" });
    expect(await answer(ctx, "skip")).toBe("continue");
    expect(await barrel(ctx, fakeCi([green("a")]))).toBe("done");
    expect(ctx.state.tasks.T1.status).toBe("skipped");
  });
});

describe("finish", () => {
  test("records a pending CI snapshot before the green result", async () => {
    const repo = tempRepo();
    const { config } = fakeSetup(repo, []);
    const ctx = quietCtx(newState({ slug: "pr-7", repo, ip: "", base: "master", phase: "finish" }), config);
    expect(await finish(ctx, fakeCi([pending("a"), green("a")]), 7)).toBe("done");
    expect(events(repo, "pr-7").map((event) => event.kind)).toEqual(["pr", "ci", "ci", "done"]);
    expect(events(repo, "pr-7").filter((event) => event.kind === "ci").map((event) => event.state)).toEqual(["pending", "pass"]);
  });

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
    expect(events(repo, "pr-7").filter((event) => event.kind === "ci").map((event) => event.state)).toEqual(["fail", "fail", "fail"]);
    expect(ctx.state.history.filter((h) => h.stage === "taste")).toHaveLength(2);
  });
});
