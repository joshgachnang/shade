---
name: blend
description: Turn a spec, ticket, or feature request into an Implementation Plan (IP) document. Use when the user asks for a new feature or asks to plan one. Use ONLY for IP creation — not code implementation, PR submission, or post-PR review handling.
---

# Blend

Turn a raw request into an Implementation Plan (IP) using the existing `docs/implementationPlans/` structure and lifecycle. Runs in the current repository.

## Overview

- Output is the IP document (plus optional acceptance criteria and optional E2E test scaffolding when requested).
- Keep scope bounded and explicit.
- Preserve existing project conventions, tool usage, and repository patterns.

## Step 0: Complexity triage (always first)

Read the request and classify it before anything else:

**SIMPLE** — all of these hold:
- Small, bounded scope (roughly one screen, one route, one model change, or one behavior tweak).
- No ambiguity in data ownership, schema shape, or API contract — the codebase has clear precedent to copy.
- No product decisions the user hasn't already made in the request.
- No migrations, feature flags, or rollout concerns.

**COMPLEX** — anything else: multiple subsystems, ambiguous requirements, new data models without precedent, external integrations, security/permissions questions, or the request reads as a direction rather than a spec.

**For SIMPLE requests, skip every confirmation pause:** do a focused research pass (Step 2, lightweight), then write the IP and task list directly (Step 6). State any assumptions you made in an `## Assumptions` section of the IP instead of asking. Do not run Steps 1's confirmation, Step 3, Step 5, or Steps 9–11.

**For COMPLEX requests, run the full workflow below** — question-first: do not write the IP (or any section that commits product or architecture decisions) until blocking questions are asked and the user has answered. Present options as questions or labeled alternatives (A/B/C), not as a finalized plan.

## Planning Workflow

### Step 1: Ingest the request

- Accept a file path or inline text.
- Summarize problem, business impact, stakeholders, constraints.
- COMPLEX only: ask for confirmation before research.

### Step 2: Research context

Produce a research artifact before any committed plan shape:

1. Scope statement and what will be investigated.
2. Deep codebase read (models/routes/screens/components/tests/docs/rules). For SIMPLE requests this can be a targeted read of the precedent code being copied.
3. External research for APIs/libraries/best practices (skip for SIMPLE unless a new dependency is involved).
4. Findings with summary, **candidate options with tradeoffs** (do not pick a single "chosen" architecture as fact), **open questions**, references.
5. COMPLEX only: save draft research and **stop** for user input on factual gaps or repo-specific ambiguities if needed; save final research as `research.md`.

### Step 3: Clarification pass (COMPLEX only — blocks Steps 4–6)

**Stop here before writing the IP or task list with decided outcomes.**

1. Emit a numbered **Blocking questions** list: product scope, data ownership, API/auth patterns, UX/navigation, rollout/feature flags, migrations, and anything not inferable with high confidence from the request + repo.
2. For each item where multiple approaches exist, present **options** (e.g. A/B/C) and the tradeoffs — **do not state one option as the plan** until the user chooses.
3. Optionally add a short **Non-blocking / nice-to-have** questions section (can default if user defers).
4. **End this step with an explicit pause:** ask the user to answer the blocking questions (or explicitly approve named assumptions). **Do not proceed** until you have those answers.

### Step 4: Shape

#### Phase 1: Models + APIs first

Draft the feature shape through data and contract boundaries:

- Model/schema changes, fields, relationships, indexes/plugins/migrations.
- API surface (methods, paths, auth, request/response contracts, errors).

#### Phase 2: Remaining shape

Define:

- Notifications and activity logging.
- UI flows/states/navigation and testID expectations.
- Delivery phases.
- Risks and mitigations.
- Explicit not-included scope.

Ground every decision in the user's answers (COMPLEX) or stated assumptions (SIMPLE); call out any residual ambiguity as a follow-up question before generating the IP.

### Step 5: Plan sections (optional deep pass, COMPLEX only)

Deepen any section as needed. Skip or shorten if the user wants a lighter IP.

1. Models
2. APIs
3. Notifications
4. UI
5. Phases
6. Feature flags and migrations
7. Activity log and user updates
8. Not included / future work

### Step 6: Generate IP output

Write the final IP:

- Models
- APIs
- Notifications
- UI
- Phases
- Feature flags & migrations
- Activity log & user updates
- Not included / future work
- Assumptions (SIMPLE path: everything you decided without asking)
- Task list grouped by phase

Persist planning artifacts in the standard repo paths:

- Save the final IP document under `docs/implementationPlans/`.
- Save the executable task breakdown under `docs/tasks/`.

### Step 7: Acceptance criteria (optional)

- Parse the IP into testable outcomes.
- Add criteria covering happy path, edge/error paths, auth/permissions, data integrity, and regressions.
- Ensure testIDs required by criteria are explicitly called out.

### Step 8: E2E test planning/generation (optional)

- Read IP + acceptance criteria.
- Identify files to create and missing `testID`s that must be added first.
- Generate Playwright plan/tests where requested.

### Step 9: Dual-model review (optional, COMPLEX only)

Run independent review passes (parallel) and merge findings: issues by severity, unresolved questions, verified critical claims, review log in the IP.

### Step 10: Attack and adjust (optional, COMPLEX only)

Stress-test assumptions, then tighten scope/plan before implementation. Document what changed (scope cuts, new risks, deferred work). **If Step 10 runs, you must continue to Step 11.**

### Step 11: Post-attack clarification (mandatory when Step 10 ran)

1. Summarize attack outcomes: what was challenged, tightened, deferred, or newly exposed.
2. Emit numbered **blocking follow-up questions** raised by the attack pass.
3. Present options where tradeoffs remain — **do not** bake unresolved attack findings into the IP as silent decisions.
4. **Pause** for explicit user answers or named-assumption approval.
5. Only then update `docs/implementationPlans/` and `docs/tasks/` to match.

## Handoff

When the IP is final, implementation happens via the **roast** skill (`.claude/skills/roast/SKILL.md`): it creates a dedicated git worktree for the PR and bootstraps the environment with `bun bootstrap`.

## Lifecycle Operations

- `Init` — create `docs/implementationPlans/` (+ `archive/`), `docs/tasks/`, `PLAN_INDEX.md` (Active/Completed/Deferred-Closed/Backlog sections), and `IP_TEMPLATE.md`; ensure project `CLAUDE.md` documents the lifecycle conventions.
- `Explore` — three parallel explore passes (project overview, IP history, recent activity) merged into one briefing with a quick-reference table.
- `Deep Analysis` — four parallel explore agents on distinct angles; verify key claims and resolve contradictions before the synthesis (agreements, tensions, surprises, corrections, recommendation, next step).
- `Status` — sync index rows to IP file `**Status:**` values (file wins), archive finished IPs, detect orphans, compute task progress from `docs/tasks/`, print the Active Plans table.
- `Close` — set the IP status (`Complete`/`Closed`/`Deferred`), update `PLAN_INDEX.md`, archive the IP (and task file) under `docs/implementationPlans/archive/`, and summarize.

## Conventions

- Keep inline annotations (`%%`) behavior for user-provided instructions in plan/task artifacts.
- Keep recommendations opinionated and evidence-based **after** the clarification pass; during research and Step 3, frame strong takes as options to choose from, not as the committed plan. The same applies after Step 10 until Step 11 is complete.
