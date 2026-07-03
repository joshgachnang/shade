# Implementation Plan: Channel & Scheduler Polish

**Status:** Open
**Priority:** Medium
**Effort:** Small batch (1-2 days)
**IP:** IP-011

**Context:** From `docs/architecture/assessment-and-hermes.md` (Hermes recommendation #4). Three small, independent fixes: (1) email replies don't thread back to the original sender (`orchestrator/channels/email.ts:334` TODO); (2) the scheduler's fixed ~5-minute tick makes near-term tasks ("remind me in 2 minutes") late; (3) `Group.modelConfig` exists but per-group model routing should be verified/honored end-to-end and an auxiliary cheap-model tier formalized. No overlap with IP-008/009/010 — this touches `email.ts`, `scheduler.ts` tick mechanics (not dispatch, which IP-010 changes), and `runners/direct.ts` model selection.

**Assumptions made (no open questions):**
- Email reply strategy: reply to the **most recent inbound email message in the group**, using stored metadata; if none exists (e.g. a scheduled task's first outbound), fall back to current behavior (configured default recipient).
- Adaptive scheduler = `setTimeout` chain aimed at the earliest `nextRunAt`, clamped to [5 s, `pollIntervals.scheduler`]. The existing interval config becomes the maximum sleep. A `wake()` method re-arms immediately when a task is created/updated through the MCP tools.
- Auxiliary model tier: one `AppConfig.agent.auxiliaryModel` field (default `claude-haiku-4-5-20251001`) consumed first by the trivia detector (which already uses Haiku ad hoc); other consumers adopt it opportunistically later.

## Models

**No new models.** Modifications:

1. **Message (email metadata)** — no schema change needed (`metadata` is already a mixed object); the email connector must store `{emailMessageId, from, subject, references}` on inbound messages if it doesn't already.
2. **AppConfig**: add `agent.auxiliaryModel: {type: String, default: "claude-haiku-4-5-20251001"}` (+ types). If the trivia detector model is currently a separate config/env field, keep it working as an override: trivia detector model = `triviaMonitor.detectorModel ?? agent.auxiliaryModel`.

## APIs

None — behavior changes only. (Group `modelConfig` is already editable via `/groups` CRUD and the admin UI.)

## Notifications

None.

## UI

None (admin UI already exposes Group and AppConfig fields generically; regenerate SDK if AppConfig types change).

## Phases

Three independent mini-phases; can land in any order as separate PRs.

- **Phase 1 — Email reply threading**
- **Phase 2 — Adaptive scheduler tick**
- **Phase 3 — Model routing**

## Feature Flags & Migrations

- None. All three are small enough to ship directly; email threading falls back to current behavior when metadata is missing (which also covers all pre-existing messages — no backfill).

## Activity Log & User Updates

- `logger.debug` when an email reply resolves a thread target vs. falls back.
- `logger.debug` of computed sleep on each scheduler re-arm.

## Not Included / Future Work

- Full email conversation threading (multiple interleaved threads per group), HTML email bodies, attachments inbound.
- Sub-second scheduler precision; per-task timezone handling.
- Per-task (as opposed to per-group) model overrides; automatic model fallback chains (Hermes-style).

## Acceptance Criteria

*Run `/ip:acceptance` for the structured version. Headline checks:*
1. Send Shade an email from any address; the agent's reply goes **to that address**, with `In-Reply-To`/`References` set so mail clients thread it, and `Re: <subject>`.
2. Create a task "in 2 minutes" via chat: it fires within ~10 s of target, not at the next 5-minute tick. A task created for +2 h does not cause busy polling (sleep clamps to the configured max).
3. Set `modelConfig.model` on a group to a different Claude model; the next turn's `AIRequest` row shows that model. Groups without an override use the global default.
4. Trivia detection uses `agent.auxiliaryModel` when no trivia-specific override is set.

---

## Task List

*Each task is a single commit-sized unit. Format: `IP-011: <title>`.*

### Phase 1: Email Reply Threading

- [ ] **Task 1.1**: Store inbound email metadata
  - Description: In the email connector's inbound handler, persist `metadata: {emailMessageId, from, subject, references}` on the created Message (verify what's already stored; add what's missing).
  - Files: `backend/src/orchestrator/channels/email.ts`
  - Depends on: none
  - Acceptance: unit test: parsed inbound mail produces a Message with the four fields.

- [ ] **Task 1.2**: Thread-aware outbound replies
  - Description: Resolve the TODO at `email.ts:334`: in `sendMessage`, find the most recent inbound Message in the group having `metadata.emailMessageId`; set `to` = its `from`, `inReplyTo` = its `emailMessageId`, `references` = its references + its id, subject = `Re: <subject>` (don't double-prefix). Fall back to current recipient when none found.
  - Files: `backend/src/orchestrator/channels/email.ts`, colocated test
  - Depends on: 1.1
  - Acceptance: unit tests for reply path and fallback path (stub SMTP transport, assert envelope/headers).

### Phase 2: Adaptive Scheduler Tick

- [ ] **Task 2.1**: setTimeout-chain scheduler with `wake()`
  - Description: In `SchedulerService`, replace `setInterval` with a self-re-arming `setTimeout`: after each tick, query `min(nextRunAt)` over active tasks and sleep `clamp(nextRunAt - now, 5_000, pollIntervals.scheduler)` (no active tasks → max). Add `wake()` that cancels the pending timeout and ticks immediately; keep the `ticking` reentrancy guard and `stop()` semantics.
  - Files: `backend/src/orchestrator/services/scheduler.ts`, colocated test
  - Depends on: none
  - Acceptance: unit tests with fake timers: near-term task shortens sleep; empty board sleeps max; `wake()` triggers immediate tick; `stop()` cancels cleanly.

- [ ] **Task 2.2**: Wake on task mutation
  - Description: Call `scheduler.wake()` from the IPC/MCP handlers that create, resume, or reschedule tasks (`schedule_task`, `resume_task` paths — wherever `handleCreateTask` etc. live in the IPC watcher).
  - Files: `backend/src/orchestrator/ipcWatcher.ts` (adjust to actual path), `backend/src/orchestrator/index.ts` (pass scheduler reference)
  - Depends on: 2.1
  - Acceptance: integration-style test: creating a `once` task due in 30 s runs it without waiting for the max interval.

### Phase 3: Model Routing

- [ ] **Task 3.1**: Honor `Group.modelConfig` in `DirectAgentRunner`
  - Description: Verify/implement: the runner's model (and any maxTurns/timeout fields present in `modelConfig`) comes from the group's `modelConfig` when set, else AppConfig defaults. Ensure the chosen model is what gets logged to `AIRequest`.
  - Files: `backend/src/orchestrator/runners/direct.ts`, colocated test
  - Depends on: none
  - Acceptance: unit test: group with override → runner options carry it; without → global default.

- [ ] **Task 3.2**: `agent.auxiliaryModel` config + trivia adoption
  - Description: Add the AppConfig field + types; trivia detector resolves `triviaMonitor` override ?? `agent.auxiliaryModel`.
  - Files: `backend/src/models/appConfig.ts`, `backend/src/types/models/appConfigTypes.ts`, `backend/src/orchestrator/services/triviaMonitor.ts`
  - Depends on: none
  - Acceptance: unit test of model resolution order; existing trivia tests stay green.
