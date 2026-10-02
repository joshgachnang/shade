// Approved IP → green PR. Each Pick, each Roast, the branch review, and Brew are
// separate agent processes; brewery commits between them so Roast judges a fixed tree.
import type { Finding } from "../agents.ts";
import { isApproved, markTask, parseTasks, readIp, writeIp } from "../ip.ts";
import { brewBody, pickBody, reviewBody, reviewFixBody, roastBody, roastReviewFixBody } from "../prompts.ts";
import { runDir, saveState, type TaskState } from "../state.ts";
import { evidenceText, mergeVerdicts, runStage, type Ctx } from "../step.ts";
import { addWorktree, removeWorktree, anyChanges, commitAll, currentBranch, ensureExcluded, git, headSha, sh, trackedChanges, type Ci } from "../vcs.ts";
import { finish, type Outcome } from "./finish.ts";
import { asksFrom, gate } from "./gate.ts";
import { dirname, join, relative } from "node:path";
import { existsSync, mkdirSync, unlinkSync } from "node:fs";

const ensureBranch = async (ctx: Ctx): Promise<void> => {
  const { state } = ctx;
  const branch = state.branch ?? state.slug;
  const current = await currentBranch(state.repo);
  if (current === branch) {
    state.branch = branch;
    return;
  }
  if (current !== state.base) {
    throw new Error(`brewery: on branch ${current}. Switch to ${state.base} or ${branch} first.`);
  }
  const ipRel = relative(state.repo, state.ip);
  const stray = (await trackedChanges(state.repo)).filter((line) => !line.endsWith(ipRel));
  if (stray.length) throw new Error(`brewery: uncommitted changes on ${current}:\n${stray.join("\n")}`);
  const exists = (await sh(state.repo, ["git", "rev-parse", "--verify", "--quiet", branch])).code === 0;
  await git(state.repo, "checkout", ...(exists ? [branch] : ["-b", branch]));
  state.branch = branch;
  ctx.log(`on branch ${branch}`);
};

type StepOutcome = "next" | "waiting";

const land = async (ctx: Ctx, id: string, taskTitle: string, ts: TaskState): Promise<void> => {
  const { state } = ctx;
  if (!ts.commit) throw new Error(`brewery: ${id} has no commit to land`);
  const ip = readIp(state.ip);
  const ipRel = relative(state.repo, state.ip);
  const index = await git(state.repo, "ls-files", "--stage", "--", ipRel);
  const tracked = /^(\d+) ([a-f0-9]+) 0\t/.exec(index);
  // Approval edits belong in the task commit. Move them out of the way while
  // cherry-picking the worktree's copy, preserving them if landing fails.
  if (tracked) await git(state.repo, "restore", "--source=HEAD", "--staged", "--worktree", "--", ipRel);
  else unlinkSync(state.ip);
  try {
    await git(state.repo, "cherry-pick", ts.commit);
  } catch (error) {
    writeIp(state.ip, ip);
    if (tracked) await git(state.repo, "update-index", "--cacheinfo", tracked[1], tracked[2], ipRel);
    throw error;
  }
  writeIp(state.ip, markTask(readIp(state.ip), id));
  ts.commit = await commitAll(state.repo, taskTitle, true);
  ts.status = "passed";
  ts.evidence = undefined;
  saveState(state);
};

const taskContext = (ctx: Ctx, cwd: string): Ctx => {
  const skillsRel = relative(ctx.state.repo, ctx.config.skillsDir);
  return {
    ...ctx,
    state: { ...ctx.state, repo: cwd, ip: join(cwd, relative(ctx.state.repo, ctx.state.ip)) },
    config: {
      ...ctx.config,
      skillsDir: skillsRel.startsWith("..") ? ctx.config.skillsDir : join(cwd, skillsRel),
    },
  };
};

const buildTask = async (ctx: Ctx, cwd: string, id: string, taskTitle: string, ts: TaskState): Promise<StepOutcome> => {
  const { state, config } = ctx;
  for (;;) {
    if (ts.attempts >= config.limits.pickAttempts) {
      const last = ts.evidence?.slice(0, 600) ?? "no evidence recorded";
      await gate(
        ctx,
        [{ q: `${id} (${taskTitle}) failed ${ts.attempts} attempts. How should I proceed?`, rec: "retry: <a hint>", opts: ["retry: <a hint>", "skip", "stop"] }],
        `${id} is stuck`,
        `Last failure: ${last}`,
        id,
      );
      return "waiting";
    }
    ts.attempts += 1;
    saveState(state);

    const branch = `brewery/${state.slug}/${id}`;
    const taskCtx = taskContext(ctx, cwd);
    if (!existsSync(cwd)) {
      await addWorktree(state.repo, cwd, branch, await headSha(state.repo));
      // The current approved IP can have tracked edits or still be untracked.
      mkdirSync(dirname(taskCtx.state.ip), { recursive: true });
      writeIp(taskCtx.state.ip, readIp(state.ip));
      let setupFailed = false;
      for (const command of config.worktreeSetup) {
        const setup = await sh(cwd, ["bash", "-lc", command]);
        if (setup.code === 0) continue;
        ts.evidence = `Worktree setup FAIL: ${command} (exit ${setup.code})\n${setup.out}\n${setup.err}`;
        ctx.log(`  ${ts.evidence}`);
        await removeWorktree(state.repo, cwd);
        await git(state.repo, "branch", "-D", branch);
        saveState(state);
        setupFailed = true;
        break;
      }
      if (setupFailed) continue;
    }

    const [{ result: picked }] = await runStage(ctx, "pick", pickBody(taskCtx, id, taskTitle, ts.evidence), { task: id, cwd });
    if (picked.status === "BLOCKED") {
      await gate(ctx, asksFrom(picked, picked.action), `a decision on ${id}`, picked.summary ?? picked.action, id);
      return "waiting";
    }
    if (picked.status !== "PASS") {
      ts.evidence = evidenceText(picked);
      continue;
    }
    if (!(await anyChanges(cwd))) {
      if (!ts.commit) {
        ts.evidence = "Pick reported PASS but changed no files.";
        continue;
      }
    } else {
      // Retries amend the task's own unpushed commit instead of stacking fix-ups.
      const amend = Boolean(ts.commit) && ts.commit === (await headSha(cwd));
      ts.commit = await commitAll(cwd, taskTitle, amend);
    }
    saveState(state);

    const verdict = mergeVerdicts(await runStage(ctx, "roast", roastBody(taskCtx, id, taskTitle, state.base), { task: id, cwd }));
    if (await anyChanges(cwd)) ctx.log(`  note: roast left changes in the tree; folding them into ${id}`);
    if (verdict.status === "PASS") {
      if (await anyChanges(cwd)) ts.commit = await commitAll(cwd, taskTitle, true);
      await land(ctx, id, taskTitle, ts);
      return "next";
    }
    if (verdict.status === "BLOCKED") {
      await gate(ctx, asksFrom(verdict, verdict.action), `a decision on ${id}`, verdict.action, id);
      return "waiting";
    }
    ts.evidence = evidenceText(verdict);
  }
};

const reviewBranch = async (ctx: Ctx): Promise<StepOutcome> => {
  const { state, config } = ctx;
  let open: Finding[] = [];
  while (state.reviewRounds < config.limits.reviewRounds) {
    state.reviewRounds += 1;
    const results = await runStage(ctx, "review", reviewBody(ctx, state.base), { parallel: true });
    open = results.flatMap((r) => (r.result.findings ?? []).filter((f) => f.severity === "blocking").map((f) => ({ ...f, agent: r.agent })));
    ctx.log(`  review round ${state.reviewRounds}: ${open.length} blocking findings`);
    if (!open.length) return "next";
    const [{ result: fixed }] = await runStage(ctx, "pick", reviewFixBody(ctx, open), { task: "REVIEW" });
    if (fixed.status === "BLOCKED") {
      await gate(ctx, asksFrom(fixed, fixed.action), "a decision on review findings", fixed.summary ?? fixed.action);
      return "waiting";
    }
    if (fixed.status !== "PASS" || !(await anyChanges(state.repo))) continue;
    await commitAll(state.repo, "Fix issues found in branch review", false);
    const verdict = mergeVerdicts(await runStage(ctx, "roast", roastReviewFixBody(ctx, open), { task: "REVIEW" }));
    if (verdict.status === "PASS") open = [];
    saveState(state);
  }
  if (!open.length) return "next";
  await gate(
    ctx,
    [{ q: `${open.length} blocking review findings remain after ${state.reviewRounds} rounds. Ship anyway?`, rec: "retry", opts: ["retry", "ship", "stop"] }],
    "blocking review findings",
    open.map((f) => `${f.where ?? ""}: ${f.attack}`).join("; ").slice(0, 600),
  );
  return "waiting";
};

const submit = async (ctx: Ctx, ci: Ci): Promise<StepOutcome> => {
  const { state } = ctx;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const [{ result }] = await runStage(ctx, "brew", brewBody(ctx, state.base));
    if (result.status === "BLOCKED") {
      await gate(ctx, asksFrom(result, result.action), "a decision before the PR", result.summary ?? result.action);
      return "waiting";
    }
    const pr = Number(result.pr) || (await ci.prForBranch(state.repo));
    if ((result.status === "PASS" || result.status === "PENDING") && pr) {
      state.pr = pr;
      saveState(state);
      return "next";
    }
    ctx.log(`  brew attempt ${attempt}: ${result.action}`);
  }
  await gate(ctx, [{ q: "Brew could not open the PR twice. What should I do?", rec: "retry", opts: ["retry", "stop"] }], "PR submission failed", "See the brew logs.");
  return "waiting";
};

export const barrel = async (ctx: Ctx, ci: Ci): Promise<Outcome> => {
  const { state } = ctx;
  if (state.waiting) throw new Error(`brewery: ${state.slug} is waiting on you. Answer with: brewery answer ${state.slug} "<reply>"`);
  if (state.phase === "finish") return finish(ctx, ci);
  if (state.phase === "done") {
    ctx.log(`${state.slug} is already done (PR #${state.pr}).`);
    return "done";
  }
  if (!isApproved(readIp(state.ip))) {
    throw new Error(`brewery: ${relative(state.repo, state.ip)} is not approved. Run distill and sign off first.`);
  }
  await ensureExcluded(state.repo);
  await ensureBranch(ctx);
  if (state.phase === "approved" || state.phase === "signoff" || state.phase === "distill") state.phase = "build";
  saveState(state);

  if (state.phase === "build") {
    for (const task of parseTasks(readIp(state.ip))) {
      state.tasks[task.id] ??= { status: task.done ? "passed" : "todo", attempts: 0 };
      const ts = state.tasks[task.id];
      const cwd = join(runDir(state.repo, state.slug), "worktrees", task.id);
      const cleanup = async (): Promise<void> => {
        if (!existsSync(cwd)) return;
        await removeWorktree(state.repo, cwd);
        await git(state.repo, "branch", "-D", `brewery/${state.slug}/${task.id}`);
      };
      if (ts.status !== "todo") {
        await cleanup();
        continue;
      }
      ctx.log(`■ ${task.id} — ${task.title}`);
      if ((await buildTask(ctx, cwd, task.id, task.title, ts)) === "waiting") return "waiting";
      await cleanup();
    }
    state.phase = "review";
    saveState(state);
  }
  if (state.phase === "review") {
    if ((await reviewBranch(ctx)) === "waiting") return "waiting";
    state.phase = "brew";
    saveState(state);
  }
  if (state.phase === "brew") {
    if ((await submit(ctx, ci)) === "waiting") return "waiting";
    state.phase = "finish";
    saveState(state);
  }
  return finish(ctx, ci);
};
