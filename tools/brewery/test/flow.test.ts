// End-to-end runs against a temp git repo with scripted fake agents.
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { answer } from "../src/commands/answer.ts";
import { barrel } from "../src/commands/barrel.ts";
import { distill } from "../src/commands/distill.ts";
import { finish } from "../src/commands/finish.ts";
import { readIp, readStatus, parseTasks } from "../src/ip.ts";
import { newState, readContext, runDir } from "../src/state.ts";
import type { PrSnapshot } from "../src/vcs.ts";
import { fakeCi, fakeSetup, IP, quietCtx, run, tempRepo } from "./helpers.ts";

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
