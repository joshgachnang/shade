---
name: ip
description: "Implementation Plan (/ip) — build an implementation plan from a PRD through an interactive, multi-step process"
disable-model-invocation: true
---

# Implementation Plan (/ip)

Build an implementation plan from a PRD through an interactive, multi-step process. Produces both a human-readable implementation plan and a structured task list for bot consumption.

## Overview

This command walks through the Shape Up-inspired process of turning a raw PRD into a concrete implementation plan. Each step is a separate subcommand so you can re-run individual steps if needed.

**Every IP targets a specific project.** The project must be specified via the `$PROJECT` argument or selected interactively.

## Project Registry

| Alias(es) | GitHub Repo | Local Dir |
|-----------|-------------|-----------|
| `fl`, `flourish` | `flourishhealth/flourish` | `~/src/flourish` |
| `ter`, `terreno` | `flourishhealth/terreno` | `~/src/terreno` |
| `nang` | `joshgachnang/nang.io` | `~/src/nang.io` |
| `gs`, `gitsight` | `flourishhealth/gitsight` | `~/src/gitsight` |
| `zoom` | `flourishhealth/zoom-notifier` | `~/src/zoom-notifier` |
| `am`, `amoeba` | `joshgachnang/amoeba` | `~/src/amoeba` |
| `sh`, `shade` | `joshgachnang/shade` | `~/src/shade` |
| `sky`, `skybound` | `skyboundtherapy/skybound` | `~/src/skybound` |

Local Dir is derived from the repo name (the part after `/`). All repos clone into `~/src/`.

If a project isn't in the registry, attempt to resolve it via `gh repo view <input>`. If found, use it. If not, ask the user for the full `owner/repo`.

## Planning Workflow

Run the following steps in order. Each step builds on the previous one.

### Step 0: Project Setup (always runs first)

This step is **mandatory** and runs before everything else, even when `$STEP` is provided.

#### 0a. GitHub Auth Check

```bash
gh auth status
```

If not authenticated, tell the user:
> You need to authenticate with GitHub. Run this in your terminal:
> `! gh auth login --web`
> Follow the prompts to open the browser link and enter the code.

Then **stop** — do not proceed until the user confirms auth is complete.

#### 0b. Resolve Project

If `$PROJECT` was provided, match it against the registry aliases (case-insensitive). If no `$PROJECT`, show the registry table and ask the user to pick one.

#### 0c. Clone if Needed

Check if the local directory exists:
```bash
ls -d ~/src/{repo-name} 2>/dev/null
```

If it doesn't exist, clone it:
```bash
gh repo clone {owner/repo} ~/src/{repo-name}
```

#### 0d. Fetch Latest & Enter Worktree

Navigate to the repo and ensure we have the latest code:
```bash
cd ~/src/{repo-name} && git fetch origin && git checkout master && git pull origin master
```

(If the default branch is `main` instead of `master`, detect it with `git remote show origin | grep 'HEAD branch'` and use that.)

Then create a worktree for this IP using the `EnterWorktree` tool:
- **name**: `ip-{feature-slug}` (derive from the PRD title once known, or use a temporary name like `ip-draft` and note that it can be renamed)

Since the PRD title isn't known yet at this point, use `ip-draft` as the worktree name. After Step 1 (Ingest), if the worktree name doesn't match the feature, note the mismatch but continue — the branch can be renamed later.

#### 0e. Confirm Ready

Print a summary:
```
Project: {repo-name} ({owner/repo})
Branch: {worktree-branch}
Working dir: {worktree-path}
Latest master: {short SHA + date of HEAD}
```

Proceed to Step 1.

### Step 1: Ingest PRD
Run subcommand `/ip:ingest` to collect the PRD input.

### Step 2: Research Context

Investigate the codebase and gather context for the PRD topic. Do this inline — do not invoke `/research` via the Skill tool. Follow this procedure:

1. **Scope** — restate the topic in one sentence and tell the user what you plan to investigate. Ask if they want anything specific covered.
2. **Codebase deep dive** — read relevant source files in depth (models, routes, screens, components, configs, tests). Search for existing patterns, conventions, and dependencies. Check `docs/`, `README.md`, `CLAUDE.md`, and any feature documentation. Note file paths, function names, and line numbers as you go.
3. **External research** — search the web for any APIs, libraries, or best practices that aren't already in the codebase.
4. **Present findings** — output a complete research document in chat with: Summary, Context, Findings (with file paths and snippets), Options Considered (table with pros/cons/effort), Recommendation (be opinionated), Open Questions, References.
5. **Iterate** — ask "Anything you want me to dig deeper on, adjust, or investigate further?" If the user gives feedback, investigate and re-output the **full** updated document.
6. **Save** — once the user is satisfied, write the final version to `research.md` in the project root and continue to Step 3.

Be specific (file paths, line numbers, code snippets) and opinionated (recommend an approach, don't just list options).

### Step 3: Shape & Question
Run subcommand `/ip:shape` to define models and APIs first (get user buy-in), then draft everything else (notifications, activity log, UI, phases, etc.) in a single pass.

### Step 4: Generate Output
Run subcommand `/ip:generate` to produce the final implementation plan and task list.

### Step 5: Acceptance Criteria
Run `/ip:acceptance` to generate structured acceptance criteria that work for both manual human testing and automated Playwright E2E tests. This reads the IP (and any existing criteria from the PRD), then produces detailed, testable criteria with specific steps, expected results, and required testIDs.

### Step 6: E2E Tests (optional)
Run `/ip:e2e` to generate Playwright test files directly from the acceptance criteria. Requires acceptance criteria to exist in the IP first.

### Step 7: Review (optional)
Run `/ip:review` to have both Claude and Codex review the plan in parallel, surface issues, ask questions, and update the plan based on your answers.

### Step 8: Attack & Adjust

Adversarially red-team the plan and then update it inline based on what comes back. This is the last thing `/ip` does before handing off to implementation.

1. **Locate the plan** — use the file just saved in Step 4 (`docs/implementationPlans/[feature-name].md`). Read it, plus the task file in `docs/tasks/` if present.

2. **Gather focused context** — collect what an external reviewer will need:
   - `CLAUDE.md` (tech stack, conventions, constraints)
   - 3–5 of the most critical existing files referenced in the plan's "Files to Create/Modify"
   - Current definitions of any models the plan touches
   - `git log --oneline -10` for recent momentum

3. **Build the attack prompt** at `$TMPDIR/ip-attack-prompt.md`:

   ```markdown
   # Adversarial Review: {plan title}

   You are a senior staff engineer conducting a hostile review of this implementation plan. Find every flaw, gap, risk, and unstated assumption. Be uncharitable — assume nothing works until proven otherwise.

   ## The Plan
   {full plan content}

   ## Task Breakdown
   {task list content, if available}

   ## Codebase Context
   {CLAUDE.md excerpt + relevant source file excerpts}

   ## Your Review

   For each finding, cite the section of the plan and explain exactly what's wrong or missing. Cover:

   1. **Missing Requirements** — what the PRD implies but the plan ignores; uncovered user flows and error states.
   2. **Unstated Assumptions** — what the plan assumes about codebase/infra/data/scale that isn't verified.
   3. **Technical Risks** — parts harder than the plan suggests; highest rewrite probability.
   4. **Security & Data Integrity** — injection, auth gaps, input validation, race conditions.
   5. **Task Breakdown Gaps** — tasks not actually independent/testable; wrong dependencies; missing setup/migration/testing/docs tasks.
   6. **Architecture Concerns** — fit with existing patterns; tech debt; simpler approaches overlooked.
   7. **Verdict** — SHIP IT / REVISE / RETHINK.

   Classify each finding: CRITICAL / HIGH / MEDIUM / LOW.
   ```

4. **Run the attacker — OpenAI first, Opus fallback:**

   Try OpenAI Codex CLI:
   ```bash
   codex --model o3-pro --quiet --approval-mode full-auto "$TMPDIR/ip-attack-prompt.md"
   ```
   If `o3-pro` is unavailable or rate-limited, try `o3`, then `o4-mini`.

   If the `codex` CLI is missing or every model fails, fall back to an Opus subagent: spawn a `general-purpose` Agent with `model: "opus"` and pass it the same prompt file contents, telling it to act as the hostile reviewer. Report clearly which path was taken.

5. **Process the findings:**
   - Deduplicate overlapping issues.
   - For each CRITICAL/HIGH finding, verify with Glob/Grep/Read before treating it as real — reviewers hallucinate.
   - Drop anything the plan actually already addresses.

6. **Report to the user** in this shape:

   ```
   ## Adversarial Review: {plan title}

   **Reviewer:** {OpenAI model used, or "Opus fallback"}
   **Verdict:** {SHIP IT / REVISE / RETHINK}

   ### Critical / High / Medium / Low
   {findings grouped by severity, each with a one-line plan-section reference}

   ### Verified vs Unverified
   - Verified: {confirmed against the codebase}
   - Unverified: {couldn't confirm — may be false positives}
   ```

7. **Adjust the plan** — don't stop at reporting. For every verified CRITICAL/HIGH finding, edit the IP file in place: tighten assumptions, add missing tasks, patch acceptance criteria, rewrite risky phases. For MEDIUM/LOW, ask the user which to fold in. Show the diff of your plan edits and ask "Anything else to adjust, or is this ready for implementation?"

If the user provides a `$STEP` argument, skip to that step (assumes prior steps have been completed and context is available in conversation).

## Lifecycle Commands

These commands manage IPs through their lifecycle after creation:

| Command | Purpose |
|---------|---------|
| `/ip:init` | Set up IP tracking (index, template, directories) in current project |
| `/ip:explore` | Explore project -- overview, IP history, recent activity |
| `/ip:deep` | Deep parallel analysis -- 4 agents explore a hard problem from different angles |
| `/ip:status` | Show active IPs with status and grooming |
| `/verify` | Post-implementation: compare implementation against the plan, flag drift |
| `/ip:review` | Dual-model review -- Claude + Codex review plan, ask questions, update |
| `/ip:acceptance` | Generate structured acceptance criteria for manual + automated testing |
| `/ip:e2e` | Generate Playwright E2E tests from acceptance criteria |
| `/ip:close` | Complete/close an IP, archive file, update index |

## Submitting the IP

Once the plan is finalized, use `/submit` to commit the IP files, push the branch, and create a PR on the target project's GitHub repo. The worktree is already on a dedicated branch, so `/submit` works directly.

## Arguments

$PROJECT: Project alias or `owner/repo` (required — if omitted, user is prompted to select from the registry)
$STEP: Optional step to skip to (ingest, research, shape, generate, acceptance, e2e, review, attack). Note: Step 0 (project setup) always runs regardless of $STEP.
$PRD: Optional path to a PRD markdown file (skips the paste prompt in ingest step)
