---
name: roast
description: Implement an approved IP in code via strict TDD with independent review checkpoints and drift detection. Use ONLY when an approved IP exists — not for creating IPs, opening PRs, or monitoring CI/review comments after a PR is open.
---

# Roast

Implement from an IP using strict TDD, with independent review checkpoints and drift detection at every commit.

## Preconditions

- An approved IP/spec exists.
- Scope is implementation, not planning or PR operations.

## Step 0: Worktree + environment (always first)

Never implement on the main checkout. Every roast run gets its own worktree for the PR:

1. Derive a kebab-case branch name from the IP/feature (e.g. `add-reminder-filters`).
2. `git fetch origin` and create the worktree off the default branch:
   `git worktree add ../<repo>-<branch> -b <branch> origin/<default-branch>`
3. `cd` into the worktree and set up the environment by running **`bun bootstrap`** at the worktree root. All projects support `bootstrap` at the root; if it's missing, fall back to `bun install` and flag the gap to the user.
4. Verify the toolchain works (lint/typecheck run clean) before writing any code.

All subsequent work happens inside this worktree.

## Execution Model

- Follow red -> green -> refactor (`Specify -> Encode -> Fulfill -> Clean the Kitchen`) for each behavior.
- Keep commits small and behavior-scoped.
- After each commit, verify the branch still matches the IP. If drift is found, stop and surface mismatch before continuing.

## Mandatory Independent Reviews

At meaningful checkpoints (minimum: after each commit):

1. Spawn an independent review sub-agent in a fresh context to assess code correctness and IP alignment.
2. Spawn a separate independent test-quality sub-agent in its own fresh context before trusting test coverage.

If either sub-agent flags issues, fix and rerun review before continuing.

## Test-Quality Audit Rules (strict)

The test-quality sub-agent must enforce all of these:

- Avoid global mocks; keep mocks scoped to the test needing them.
- Do not over-mock; mock only at external boundaries.
- Never mock the database on the backend.
- Never mock the store on the frontend unless there is genuinely no way around it.

## TDD Cycle

### 1) Specify

Define one behavior in plain language.

### 2) Encode

Write exactly one failing test for that behavior; verify failure reason is correct.

### 3) Fulfill

Implement the minimum code required to pass that test.

### 4) Clean the Kitchen

Refactor safely, remove dead/debug code, improve naming, and keep lint/type checks clean.

Repeat until scoped behavior is complete.

## Before Coding a Slice

- Consider multiple approaches (brainstorm alternatives first).
- Choose the best approach and proceed with smallest safe increment.

## Package/Domain Guardrails

### General

- Use Bun workflows (`bun run lint`, `bunx tsc --noEmit`, targeted tests).
- Prefer real integrations over heavy mocking.
- Preserve repo coding conventions (TypeScript patterns, error handling, logging rules, Luxon for dates).

### Backend

- Use real test DB patterns and route-level tests where appropriate.
- Never use raw `Model.findOne`; use `findExactlyOne`/`findOneOrNone` patterns.
- Apply schema-safety checks for any model change (types, indexes, migration/backfill risks, cross-package ripple).
- Runtime configuration lives in `AppConfig` (via `loadAppConfig()`), never ad-hoc env vars.

### Backend tests mutating env

- Treat the package preload `beforeEach` as the baseline reset source of truth.
- Mutate only the keys needed by the test; do not use whole-env snapshot/restore patterns.
- Use `Reflect.deleteProperty(process.env, "KEY")` when a key must be unset.

### Backend API surface changes

If backend API shape changes, regenerate the SDK via the established workflow:

- Start the backend
- Run frontend SDK generation (`cd frontend && bun run sdk`)
- Never hand-edit `frontend/store/openApiSdk.ts`

## Per-Commit Verification Checklist

For every commit:

1. Confirm changed behavior maps to IP tasks/criteria.
2. Run targeted tests and required lint/compile checks.
3. Run independent code review sub-agent.
4. Run independent test-quality sub-agent.
5. Proceed only if alignment + quality checks pass.

## Done Criteria for Roast

- All planned implementation tasks for the scoped slice are complete.
- Tests are credible under anti-mocking rules.
- No unresolved review findings remain from independent sub-agents.
- Work is ready for **Pour** (`.claude/skills/pour/SKILL.md`), which commits, pushes, and opens the PR from this worktree.
