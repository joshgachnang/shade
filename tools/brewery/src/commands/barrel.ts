// Approved IP → green PR. Each Pick, each Roast, the branch review, and Brew are
// separate agent processes; brewery commits between them so Roast judges a fixed tree.
import { appendEvent } from "../events.ts";
import { isApproved, markTask, parseTasks, readIp, writeIp } from "../ip.ts";
import { brewBody, pickBody, reviewBody, reviewFixBody, roastBody, roastReviewFixBody } from "../prompts.ts";
import { saveState, type TaskState } from "../state.ts";
import { evidenceText, mergeVerdicts, runStage, type Ctx } from "../step.ts";
import { anyChanges, commitAll, currentBranch, ensureExcluded, git, headSha, sh, trackedChanges, type Ci } from "../vcs.ts";
import { finish, type Outcome } from "./finish.ts";
import { asksFrom, gate } from "./gate.ts";
import { relative } from "node:path";

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

const buildTask = async (ctx: Ctx, id: string, taskTitle: string, ts: TaskState): Promise<StepOutcome> => {
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

    const [{ result: picked }] = await runStage(ctx, "pick", pickBody(ctx, id, taskTitle, ts.evidence), { task: id });
    if (picked.status === "BLOCKED") {
      await gate(ctx, asksFrom(picked, picked.action), `a decision on ${id}`, picked.summary ?? picked.action, id);
      return "waiting";
    }
    if (picked.status !== "PASS") {
      ts.evidence = evidenceText(picked);
      continue;
    }
    if (!(await anyChanges(state.repo))) {
      if (!ts.commit) {
        ts.evidence = "Pick reported PASS but changed no files.";
        continue;
      }
    } else {
      // Retries amend the task's own unpushed commit instead of stacking fix-ups.
      const amend = Boolean(ts.commit) && ts.commit === (await headSha(state.repo));
      ts.commit = await commitAll(state.repo, taskTitle, amend);
    }
    saveState(state);

    const verdict = mergeVerdicts(await runStage(ctx, "roast", roastBody(ctx, id, taskTitle, state.base), { task: id }));
    if (await anyChanges(state.repo)) ctx.log(`  note: roast left changes in the tree; folding them into ${id}`);
    if (verdict.status === "PASS") {
      writeIp(state.ip, markTask(readIp(state.ip), id));
      ts.commit = await commitAll(state.repo, taskTitle, true);
      ts.status = "passed";
      ts.evidence = undefined;
      saveState(state);
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
  let open = state.reviewFindings;
  while (state.reviewPending || state.reviewRounds < config.limits.reviewRounds) {
    // An interrupted round must finish even when it is the final allowed round.
    if (!state.reviewPending) state.reviewRounds += 1;
    state.reviewPending = true;
    saveState(state);
    const results = await runStage(ctx, "review", reviewBody(ctx, state.base), { parallel: true });
    open = results.flatMap((r) => (r.result.findings ?? []).filter((f) => f.severity === "blocking").map((f) => ({ ...f, agent: r.agent })));
    for (const {agent, result} of results) {
      if (result.status !== "PASS" && !(result.findings ?? []).some((f) => f.severity === "blocking")) {
        open.push({id: `review-${agent}`, severity: "blocking", attack: `Review did not pass: ${result.action}`, evidence: evidenceText(result), agent});
      }
    }
    state.reviewFindings = open;
    saveState(state);
    ctx.log(`  review round ${state.reviewRounds}: ${open.length} blocking findings`);
    if (!open.length) {
      state.reviewPending = false;
      saveState(state);
      return "next";
    }
    const [{ result: fixed }] = await runStage(ctx, "pick", reviewFixBody(ctx, open), { task: "REVIEW" });
    if (fixed.status === "BLOCKED") {
      state.reviewPending = false;
      await gate(ctx, asksFrom(fixed, fixed.action), "a decision on review findings", fixed.summary ?? fixed.action);
      return "waiting";
    }
    if (fixed.status !== "PASS" || !(await anyChanges(state.repo))) {
      state.reviewPending = false;
      saveState(state);
      continue;
    }
    await commitAll(state.repo, "Fix issues found in branch review", false);
    const verdict = mergeVerdicts(await runStage(ctx, "roast", roastReviewFixBody(ctx, open), { task: "REVIEW" }));
    if (verdict.status === "PASS") open = [];
    state.reviewFindings = open;
    state.reviewPending = false;
    saveState(state);
  }
  if (open?.length === 0) return "next";
  await gate(
    ctx,
    [{ q: `${open?.length ?? "Unverified"} blocking review findings remain after ${state.reviewRounds} rounds. Ship anyway?`, rec: "retry", opts: ["retry", "ship", "stop"] }],
    "blocking review findings",
    open?.map((f) => `${f.where ?? ""}: ${f.attack}`).join("; ").slice(0, 600) ?? "No completed review outcome was saved. Retry review before submitting the PR.",
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
      appendEvent(state, { kind: "pr", number: pr, url: await ci.prUrl(state.repo, pr) });
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
      if (ts.status !== "todo") continue;
      ctx.log(`■ ${task.id} — ${task.title}`);
      if ((await buildTask(ctx, task.id, task.title, ts)) === "waiting") return "waiting";
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
