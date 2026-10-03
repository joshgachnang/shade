# Brewery: build small, composable tasks in parallel

**Status:** Open
**Priority:** High
**Effort:** Medium batch (3-5 days)
**IP:** IP-019

Today brewery builds an approved IP strictly in order. Each task is picked, committed and roasted,
and only then does the next task start, so a six-task feature takes six tasks' worth of time even
when most of the tasks never touch each other. distill doesn't help: nothing asks it to cut work into
independent pieces, and the IP has nowhere to say which tasks actually depend on which. This change
makes distill produce small, independently testable tasks with explicit dependencies. barrel then
builds every task whose dependencies have landed at the same time, each in its own worktree, and
lands them on the feature branch one at a time. Features ship in roughly the length of their
longest dependency chain, not their task count.

> "update brewery to prefer building small parts of the final feature in parallel so we can split
> into tasks in parallel and deliver features faster, ensuring we break the desires into small
> testable and composable parts where possible"

## The idea

An IP task gains one line, `Depends on: T1, T3`, or `Depends on: none`. Together these lines
make the task list a DAG. barrel schedules over that DAG:

- A task is **ready** when every task it depends on has passed roast and **landed**, meaning it
  is on the feature branch.
- Up to `limits.parallelTasks` ready tasks run at once. Each one runs pick, then commit, then
  roast in its own worktree under `.terreno/brewery/<slug>/worktrees/<task>`, branched from the
  feature branch head at the moment it starts. Its dependencies are therefore already in its tree.
- A task that passes roast lands on the feature branch through a single serial **land** step:
  cherry-pick its commit, tick its checkbox, amend. That keeps today's history of one commit per
  task, with the IP mark inside the task's own commit.
- If the cherry-pick conflicts with a task that landed first, the land step aborts. The task goes
  back to ready, carrying the conflict as evidence, and the retry is picked fresh from the new
  head. This counts as an attempt, so the existing `pickAttempts` bound and stuck gate still
  apply.
- Once every task has landed and anything ran in parallel, one **integrated roast** checks every
  task's criteria together on the combined tree, before branch review. Pieces that pass alone can
  still break each other.

distill does the splitting. Its prompt and skill change from "a dependency-ordered tracer-bullet
list" to:

- the tracer first;
- then the smallest independently testable slices, each declaring `Depends on:` and the files
  or seams it touches;
- two tasks that touch the same file depend on each other;
- dependency chains kept short.

brewery checks the graph itself, not by asking an agent. It rejects unknown IDs, self-loops and
cycles, and returns each problem to distill's fix step as a blocking finding, so an IP with a
broken graph never reaches sign-off. cut also attacks on a new axis: false independence and
oversized tasks.

An IP with no `Depends on:` lines behaves exactly as it does today. A missing line means "the
previous task", and `parallelTasks: 1` runs the same order through the same steps. Only the
worktree is new.

Rejected alternative: parallel picks in one tree, with no worktrees. The roast for one task would
then judge a tree that another task was still editing, which breaks brewery's "roast judges a fixed
tree" rule.

## The plan

| # | Task | Depends on | Lands in | Proves it |
| --- | --- | --- | --- | --- |
| T1 | Parse and validate task dependencies | none | `ip.ts` | unit tests |
| T2 | Teach distill and cut to split work into small, parallel-ready tasks | none | `prompts.ts`, distill/cut skills | prompt unit tests |
| T3 | Build each task in its own worktree and land it on the branch | none | `barrel.ts`, `vcs.ts`, `config.ts` | flow tests |
| T4 | Return an invalid task graph to distill as a blocking finding | T1 | `commands/distill.ts` | flow test |
| T5 | Run ready tasks in parallel up to the configured limit | T1, T3 | `barrel.ts`, `state.ts`, `cli.ts` | flow tests |
| T6 | Roast the integrated branch after a parallel build | T5 | `barrel.ts`, `prompts.ts` | flow test |
| T7 | Never approve an IP with a broken task graph, and never strand sign-off | none | `commands/answer.ts`, `commands/distill.ts` | flow tests |
| T8 | Keep worktree cleanup from masking or causing failures | none | `vcs.ts`, `commands/cut.ts`, `barrel.ts` | flow tests |
| T9 | Give each task worktree a stable snapshot of the approved IP | none | `barrel.ts` | flow test |
| T10 | Reject duplicate task IDs before any task starts | none | `ip.ts` | unit and flow tests |

T7–T10 fix the four should-fix findings from the first branch review on PR #104 (steps
`013-review-claude` R1–R2 and `014-review-codex` R1–R2).

The plan follows its own rule: T1, T2 and T3 run in parallel, then T4 and T5, then T6. That is three
rounds instead of six.

Tracer: T3. It moves the existing sequential loop onto worktrees plus a land step, with no
behaviour change, so every later task builds on a seam that already works.
Out of scope: see Expansions.
Open risks: disk and memory per worktree in a zerg container (Q1, Q5).

## Tasks

- [x] **T1** — Parse and validate task dependencies in the IP
  - Depends on: none
  - Files: `tools/brewery/src/ip.ts`, `tools/brewery/test/unit.test.ts`
  - `IpTask` gains `deps: string[]`. `parseTasks` reads a `Depends on: T1, T2` / `Depends on: none`
    line from the task's details block: the indented lines after its task line, up to the next task
    line or heading. With the bullet (`- Depends on:`) or without. Case-insensitive. Separators are
    commas and/or `and`.
  - A task with no such line depends on the task before it. The first task depends on nothing.
  - `taskGraphProblems(tasks): string[]` names each unknown dependency, self-dependency and cycle,
    giving the cycle's path, for example `T2 → T4 → T2`.
  - `readyTasks(tasks, landed: Set<string>): IpTask[]` returns the not-done tasks whose
    dependencies have all landed, in IP order.
  - Acceptance:
    - unit tests cover each parse form;
    - the previous-task default;
    - `none`;
    - each problem kind;
    - `readyTasks` across a diamond (T1 → T2, T3 → T4);
    - the existing `IP()` fixture parses to the same ids, titles and done flags as before, with
      `deps` `[]` and `["T1"]`.
  - Docs: the task-line paragraph in `.claude/skills/distill/references/distilling.md`.

- [x] **T2** — Teach distill and cut to split work into small, parallel-ready tasks
  - Depends on: none
  - Files:
    - `tools/brewery/src/prompts.ts` (`distillBody`, `fixBody`, `cutBody`)
    - `.claude/skills/distill/SKILL.md` steps 7 and 9
    - `.claude/skills/distill/references/distilling.md` (new section "Splitting for a parallel
      build", the plan table gains a `Depends on` column)
    - `.claude/skills/cut/SKILL.md` (new axis 7)
    - `docs/implementationPlans/IP_TEMPLATE.md` (`Depends on:` already exists; add one line saying
      brewery reads it)
    - `tools/brewery/test/unit.test.ts`
  - Rules the prompt and skill must state:
    - tracer first;
    - each task is one independently testable behaviour that can be roasted on its own;
    - every task carries `Depends on:` and `Files:`;
    - tasks that share a file depend on each other;
    - prefer wide over deep;
    - split any task that needs more than one roast-able behaviour.
  - cut axis 7, **Decomposition**:
    - two tasks that write the same file with no dependency between them;
    - a task that is really two;
    - a chain that could be a fan-out.
  - Acceptance:
    - unit tests assert `distillBody` contains the `Depends on:` format and the split rules;
    - unit tests assert `cutBody` names the decomposition axis;
    - an existing flow test still passes with the fake agent's IP unchanged.

- [x] **T3** — Build each task in its own worktree and land it on the feature branch
  - Depends on: none
  - Files: `tools/brewery/src/commands/barrel.ts`, `tools/brewery/src/vcs.ts`,
    `tools/brewery/src/config.ts`, `tools/brewery/test/flow.test.ts`, `.brewery.json` (new, at the
    shade root)
  - `buildTask` takes a `cwd`. barrel creates `.terreno/brewery/<slug>/worktrees/<id>` with
    `git worktree add -b brewery/<slug>/<id> <dir> <feature-head>`. It runs each command in
    `config.worktreeSetup` there, then runs pick and roast with `cwd` set to the worktree and
    commits there.
  - On a roast PASS, `land()` runs in the main tree:
    - `git cherry-pick <task commit>`;
    - `markTask`, then commit with `--amend`;
    - record `ts.commit` as the landed sha;
    - remove the worktree and its branch.
  - A failed setup command is a `FAIL` with its output as evidence. It counts as an attempt.
  - New config:
    - `worktreeSetup: string[]`, default `[]`. Shade's `.brewery.json` sets `["bun bootstrap"]`,
      per `CLAUDE.md`'s "run it in any fresh clone or worktree".
    - `limits.parallelTasks`, default `3`. It is unused until T5, which reads it.
  - Acceptance:
    - the existing sequential flow tests pass unchanged, with the same commit subjects in the same
      order and checkboxes ticked inside the task commits;
    - a new flow test asserts that pick's recorded `cwd` is the worktree;
    - that test also asserts that the worktree is gone after the land step and that
      `git worktree list` holds only the main tree;
    - a failing setup command reaches the stuck gate after `pickAttempts`.
  - Docs: `tools/brewery/README.md` (the barrel diagram and a `worktreeSetup` row in the config
    example).

- [x] **T4** — Return an invalid task graph to distill as a blocking finding
  - Depends on: T1
  - Files: `tools/brewery/src/commands/distill.ts`, `tools/brewery/test/flow.test.ts`
  - `ipProblems` adds `taskGraphProblems`.
  - In `writeDraft`, a graph problem makes the attempt unusable, exactly like a missing task line.
  - In `cutAndFix`, after each fix step, graph problems are re-checked. Any that remain are passed
    to the next fix as `{severity: "blocking", axis: "decomposition", attack, evidence}` findings
    whether or not cut found anything. The run then counts as structural.
  - If problems remain after `cutRounds`, distill throws instead of sending the IP for sign-off.
  - Acceptance:
    - a flow test: the fake distill writes an IP with a cycle, the fix prompt contains the cycle
      path, the fake fix repairs it, and sign-off is reached;
    - a second flow test, where the fix never repairs the cycle, throws with the cycle in the
      message and never sets `awaiting sign-off`.

- [x] **T5** — Run ready tasks in parallel up to the configured limit
  - Depends on: T1, T3
  - Files: `tools/brewery/src/commands/barrel.ts`, `tools/brewery/src/state.ts`,
    `tools/brewery/src/cli.ts`, `tools/brewery/test/flow.test.ts`
  - The build phase becomes a scheduler loop:
    - start `readyTasks` up to the limit;
    - `await Promise.race` the running builds;
    - land each one that passes, through a single in-process queue, one land at a time;
    - repeat until nothing is ready or running.
  - `TaskState.status` gains `"running"`, with `worktree` and `branch` fields. On resume, any
    `running` task has its worktree removed and goes back to `todo`, because a crashed run leaves
    no partial credit.
  - When the land step conflicts:
    - `cherry-pick --abort`;
    - remove the worktree;
    - set evidence to the conflicting paths, plus "rebuild on the new head; T<n> landed first and
      touched these";
    - the task goes back to ready.
  - Gates:
    - when any task gates (BLOCKED or stuck), barrel starts nothing new;
    - it lets the running tasks finish and land;
    - it records the first gate in `state.waiting` and resets any later gated task to `todo`;
    - it then exits 3.
  - Step files and history entries already carry the task id, so concurrent steps don't collide.
  - `brewery status` shows `running T2, T3`.
  - `--parallel N` overrides the limit for one run. `--parallel 1` means sequential.
  - Acceptance, using flow tests with a fake agent that sleeps:
    - a diamond IP with limit 2 runs T2 and T3 concurrently: their step start times overlap
      before either ends;
    - T4 starts only after both have landed;
    - the branch has four commits;
    - with `--parallel 1` the same IP runs strictly in order;
    - two independent tasks that write the same file produce one conflict retry, and both land;
    - a gate on T2 while T3 runs: T3 still lands and the run exits 3 waiting on T2;
    - a state file left with a `running` task resumes cleanly.
  - Docs:
    - README: a "Parallel builds" section;
    - `.claude/skills/barrel/SKILL.md`: Drive step 2 and the brewery paragraph;
    - shade `CLAUDE.md`: one sentence in the brewery paragraph.

- [x] **T6** — Roast the integrated branch after a parallel build
  - Depends on: T5
  - Files: `tools/brewery/src/commands/barrel.ts`, `tools/brewery/src/prompts.ts`,
    `tools/brewery/test/flow.test.ts`
  - When at least two tasks overlapped in time during the run, recorded as `state.parallelRan`, a
    new `integrate` roast runs after the build phase and before review. The prompt is "prove every
    task's acceptance criteria on the combined tree; run the repo's full test command". It uses the
    roast fan-out.
  - On FAIL, a pick step titled `INTEGRATE` gets the evidence and fixes it in the main tree, the
    fix is committed as "Fix integration of parallel tasks", and the integrated roast runs again.
    This is bounded by `reviewRounds`, then a gate (`retry` / `ship` / `stop`).
  - A sequential run skips it.
  - Acceptance:
    - a flow test where the integrated roast FAILs once runs a fix commit and then passes into
      review;
    - a `--parallel 1` run records no `integrate` step.

- [x] **T7** — Never approve an IP with a broken task graph, and never strand sign-off
  - Depends on: none
  - Files: `tools/brewery/src/commands/answer.ts`, `tools/brewery/src/commands/distill.ts`,
    `tools/brewery/test/flow.test.ts`
  - Today the approve path in `answer` re-checks the graph only when the apply-reply step reports
    `structural: true`. A non-structural reply edit that breaks a `Depends on:` line is approved,
    and barrel then throws "invalid task graph". When `structural` is true and the graph stays
    invalid, `cutAndFix` throws after `state.waiting` was cleared and saved, so the run sits in
    `signoff` with nothing waiting and `brewery answer` fails with "not waiting on an answer".
  - Before `approve(state)`, check `taskGraphProblems` on the IP whatever `structural` says. If the
    graph is invalid, do not approve: run cut/fix with the problems as blocking findings, and if
    they remain, send the IP for sign-off again listing them.
  - No path through `answer` may leave a `signoff` run with `state.waiting` unset unless it was
    approved.
  - Acceptance:
    - a flow test where a non-structural "ok" reply leaves a cycle: the run is not approved and is
      waiting on sign-off again with the cycle named;
    - a flow test where the structural fix leaves the graph invalid: `brewery answer` still works
      afterwards (the run is waiting, not stranded).

- [ ] **T8** — Keep worktree cleanup from masking or causing failures
  - Depends on: none
  - Files: `tools/brewery/src/vcs.ts`, `tools/brewery/src/commands/cut.ts`,
    `tools/brewery/src/commands/barrel.ts`, `tools/brewery/test/flow.test.ts`
  - `removeWorktree` now throws through `git` where master used the tolerant `sh`. `runCut` calls it
    in a `finally`, so a failed cleanup replaces the real cut error or crashes a successful cut.
    buildTask's setup-failure path and `cleanupTask` crash the whole run on a cleanup hiccup.
  - Restore tolerant removal for the cut and failure paths: log a cleanup failure and keep the
    original outcome. Keep a strict variant only where the land path needs it.
  - Acceptance:
    - a flow test where cut's worktree removal fails: a cut error still surfaces as that error, and
      a successful cut still returns its findings;
    - a flow test where task cleanup fails after a setup failure: the run records the setup
      evidence instead of crashing.

- [ ] **T9** — Give each task worktree a stable snapshot of the approved IP
  - Depends on: none
  - Files: `tools/brewery/src/commands/barrel.ts`, `tools/brewery/test/flow.test.ts`
  - buildTask awaits `addWorktree` and only then copies `readIp(state.ip)`. A sibling landing in
    that window restores the tracked IP to HEAD or unlinks an untracked IP before cherry-picking,
    so a slower task can fail with ENOENT or hand Pick and Roast outdated criteria.
  - Snapshot the approved IP text while it is stable, before the asynchronous worktree startup,
    and write that snapshot into the task tree.
  - Acceptance: a deterministic flow test where worktree startup finishes while another task is
    landing, covering both a tracked IP with approval edits and an untracked IP; the task tree
    gets the approved text and the run does not fail.

- [ ] **T10** — Reject duplicate task IDs before any task starts
  - Depends on: none
  - Files: `tools/brewery/src/ip.ts`, `tools/brewery/test/unit.test.ts`,
    `tools/brewery/test/flow.test.ts`
  - `taskGraphProblems` builds a `Map` from task ids without checking for duplicates. Two `T1`
    rows that both say `Depends on: none` produce no problems and two ready rows, and barrel
    launches both into the same TaskState, branch and worktree, overwriting the `running` entry.
  - `taskGraphProblems` names each duplicate id, for example `Duplicate task id: T1`, so distill
    returns it as a blocking finding and barrel refuses to start.
  - Acceptance:
    - a unit test for the duplicate-id problem;
    - a flow test proving an IP with a duplicate id is rejected before any task starts.

## Assumptions

- The integrated roast's fan-out routing uses `stages.roast`, so no new `Stage` is needed. The
  history label reads `roast INTEGRATE`.
- Worktree branches `brewery/<slug>/<id>` are local only and are deleted on landing. Brew pushes
  only the feature branch.
- Everything stays in one process with async concurrency, so `state` writes need no locking.

## Open questions (recommendation assumed)

None.

## Expansions (follow up later)

| ID | Idea | Why it came up | Rough size | Depends on |
| --- | --- | --- | --- | --- |
| X1 | Spread ready tasks across zerg drones (one container per task) instead of worktrees in one container | Removes the per-container memory ceiling on `parallelTasks` | L | T5 |
| X2 | `brewery plan <slug>`: print the task DAG and its rounds before sign-off | Lets you judge the split at approval time | S | T1 |
| X3 | Auto-split a task that gets stuck into smaller tasks via a distill fix step | A task that fails `pickAttempts` times is often two tasks | M | T4 |

## Decisions

Settled by the sign-off reply "ok" on 2026-10-02, which accepts every recommendation.

| ID | Question asked | Answer | What it changes |
| --- | --- | --- | --- |
| Q1 | Default `limits.parallelTasks`? | 3 (recommendation accepted) | T3 |
| Q2 | How does a passed task reach the feature branch? | Cherry-pick, so each task stays one commit (recommendation accepted) | T3, T5 |
| Q3 | On a land conflict, rebuild or ask you? | Rebuild from the new head, counting an attempt (recommendation accepted) | T5 |
| Q4 | Run a combined roast after a parallel build? | Yes, only when tasks overlapped (recommendation accepted) | T6 |
| Q5 | Set up each worktree with `bun bootstrap` in shade? | Yes, through `.brewery.json` `worktreeSetup` (recommendation accepted) | T3 |
| Q6 | What does a task with no `Depends on:` line mean? | The previous task (recommendation accepted) | T1 |
| Q7 | IP-019: T1–T6 shipped in PR #104. T7–T10 were added to fix the four should-fix review findings (answer.ts sign-off graph check, tolerant worktree cleanup, stable IP snapshot per task, duplicate task ids). Approve? | Approve (reply "approve", 2026-10-03) | T7–T10 cleared for barrel; no task changes |

## Sign-off

Status: approved 2026-10-03
T1–T6 approved 2026-10-02 and shipped in PR #104. T7–T10 added 2026-10-03 and need sign-off.
Cut: 0 rounds (written by hand in a zerg session, not by `brewery distill`; run `brewery cut` on it before approving if you want the attack)
