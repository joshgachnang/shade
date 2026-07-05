# Implementation Plan: AI Testability Harness

**Status:** Pending Verification
**Priority:** High
**Effort:** Big batch (~1 week)
**IP:** IP-012

## Problem

Shade has no way for an AI (or a human without production credentials) to boot the app, send a command, and observe the result. `POST /command` and full Mongo observability (`Message`, `TaskRunLog`, `AIRequest`) already exist, but every agent turn calls the real Claude Agent SDK, channels require real Slack/IMAP credentials, and the `FakeConnector` pattern lives only inside bun tests — the *running server* cannot host an observable conversation. This IP delivers a deterministic, offline, $0 feedback loop: boot with one command, send a command, see the full orchestration pipeline (message loop → group queue → runner → IPC → channel delivery) produce a result in under a second.

Scope = "Option D + Option A" from the 2026-07-03 analysis: the test-mode chassis plus a mock agent at the existing `AgentRunner` seam. Faking the Anthropic wire API (Option B) and a real-Haiku smoke tier (Option C) are explicitly future work.

*Adversarially reviewed 2026-07-03 (Opus red-team, verdict REVISE); all verified findings folded in below.*

## Design Decisions

- **Test mode activation:** `SHADE_TEST_MODE=1` env var. This is legitimately bootstrap-level (per the AppConfig rule's bootstrap exception): it must gate connector wiring, runner selection, and service startup before/independent of the DB. Everything runtime-tunable (fixtures, intervals) stays in AppConfig/Mongo.
- **Mock seam:** the existing `AgentRunner` interface (`orchestrator/runners/types.ts`). The gateway constructs one `DirectAgentRunner` at `orchestrator/index.ts:131` and shares that single instance with `GroupQueue` (:167), `PrWatcher` (:274), and `TaskWorkerService` (:307); the worker constructs its own at `workerMain.ts:48`. Swapping construction at those two sites therefore covers every consumer. The mock also serves as the planner runner (no OpenAI in test mode).
- **Audit records are the callers' job, not the runner's.** `GroupQueue.executeAgentRun` creates the `TaskRunLog` (`groupQueue.ts:211`) and `AIRequest` (`groupQueue.ts:458`) and appends session transcripts; `TaskWorkerService` does the equivalent for board tasks. The mock runner therefore writes **no** audit rows itself — it gets audit parity for free by returning a normal `AgentRunResult`. Mock runs are labeled by widening the `modelBackend` enum with `"mock"` (see Models) and seeding the test group with `modelConfig.defaultBackend: "mock"`, since `GroupQueue` stamps the backend from group config (`groupQueue.ts:215`).
- **Side effects via real IPC — with the writer made shareable.** Fixture actions (send_message, schedule_task, create_task) execute by writing the same IPC file format the real MCP tools write. Today `writeIpcFile` is a non-exported local in `agentRunner/mcpServer.ts:59`, and `DirectAgentRunner` hardcodes `path.join(process.cwd(), "data/ipc")` (`direct.ts:89,105`) while `IpcWatcher` reads `paths.ipc` (`ipc.ts:163`), which honors `SHADE_DATA_DIR` — a latent divergence this IP fixes: extract `writeIpcFile` into `orchestrator/ipc.ts` (exported, rooted at `paths.ipc`) and point both `mcpServer.ts` and `direct.ts` at it. `IpcWatcher` → `ChannelManager` delivery then stays fully real for mock actions.
- **Test channel type:** add `"test"` to the Channel type enum and a `createTestConnector` factory in `defaultConnectorFactories` (`orchestrator/channels/manager.ts:25`). The connector is a pure no-op transport implementing the **full** `ChannelConnector` interface. It does **not** touch Message docs — `ChannelManager.sendMessageToGroup` already persists every outbound message as a `Message` with `isFromBot: true` after the connector returns (`manager.ts:329`), and that is the observation source of truth.
- **`/test/outbox` reads Message docs** (`isFromBot: true`, filtered by group/time) rather than any connector-side metadata, since the connector never sees the Message document (`ChannelConnector.sendMessage(groupExternalId, content)` — `channels/types.ts:50`).
- **Determinism without clock injection:** `SchedulerService.wake()` already exists; expose it plus force-ticks for `MessageLoop`, `IpcWatcher`, and `TaskWorkerService` via `POST /test/tick`. The task-worker target is required because board tasks (`AgentTask`) are claimed on an independent 5s poll (`taskWorker.pollMs`) that no other tick reaches. Test-profile poll intervals are seeded short (~250ms) as a fallback.
- **`/test/reset` is defense-in-depth guarded:** beyond `SHADE_TEST_MODE` and the `NODE_ENV !== "production"` mount guard, the handler itself asserts the connected Mongo database name is `shade-test` (or ends in `-test`) before any destructive operation, since we cannot rely on `NODE_ENV=production` being set on the prod host.

## Models

- **`Channel`** (`backend/src/models/channel.ts:8`): add `"test"` to the `type` enum.
- **Backend enum widening (deliberate schema change):** add `"mock"` to the `modelBackend`/`defaultBackend`/`fallbackBackend` enums in `backend/src/models/taskRunLog.ts:19`, `backend/src/models/group.ts` (`modelConfig`), and the `AgentRunConfig.modelBackend` union in `backend/src/orchestrator/runners/types.ts:7`, plus corresponding files in `backend/src/types/models/`. Without this, `TaskRunLog` creation throws on enum validation for mock-labeled runs. Additive and backward-compatible; no data migration.
- **`LlmFixture`** (new, `backend/src/models/llmFixture.ts`): scripted responses for the mock runner.
  - Fields: `name` (string), `match` (`{groupId?, pattern?}` — regex tested against the incoming prompt), `response` (string), `actions` (array of `{tool: "send_message" | "schedule_task" | "create_task" | "add_reaction", args: Mixed}`), `delayMs` (number, default 0), `priority` (number — higher wins on multiple matches), `consumeOnce` (boolean), standard timestamps/soft-delete per project conventions.
  - `pattern` is validated at save time (compile in try/catch; reject invalid regex; cap length at 500 chars). ReDoS from an admin-authored pattern is an accepted residual risk (admin-gated, test-mode-only), noted in the runbook.
  - `consumeOnce` fixtures are claimed **atomically** (`findOneAndUpdate` setting the soft-delete flag in the same operation as the match-winning read) so concurrent runs cannot both consume a one-shot fixture.
- **`AppConfig`** (`backend/src/models/appConfig.ts` + `backend/src/types/models/appConfigTypes.ts`): add `testMode: {echoFallback: boolean (default true), simulateLatencyMs: number (default 0)}`. No new secrets; no `hydrateEnvFromConfig` changes.
- **No changes** to `Message`, `AgentTask`, `AIRequest`.

## APIs

New `TestHarnessPlugin` (`backend/src/api/testHarness.ts`), **mounted only when `SHADE_TEST_MODE=1` and `NODE_ENV !== "production"`**, all routes behind `Permissions.IsAdmin`:

- `POST /test/reset` — asserts the connected DB name is `shade-test`/`*-test` (403 otherwise), then wipes collections (except User + AppConfig), re-runs seed, clears IPC dir and sandbox transcripts. Returns seeded IDs.
- `GET /test/outbox?groupId=&since=` — outbound bot messages (`Message` docs with `isFromBot: true`), including `richPayload`; the single "what did Shade say" observation point.
- `POST /test/tick` — body `{target: "scheduler" | "messageLoop" | "ipc" | "taskWorker" | "all"}`; forces immediate ticks for deterministic scheduled-task, board-task, and delivery tests.
- `POST /test/llm-fixtures` / `GET /test/llm-fixtures` / `DELETE /test/llm-fixtures/:id` — runtime programming of the mock's next responses (thin wrapper over `LlmFixture`; `modelRouter` CRUD is acceptable if simpler).
- `GET /test/state` — snapshot of counts (pending messages, active runs, pending/running agent tasks, scheduled tasks due) for loop-closing assertions.

Existing endpoints (`POST /command`, `GET /messages`, CRUD for groups/scheduledTasks/agentTasks) are the primary drive surface and need no changes.

## Notifications

None. No push/email/in-app alerts. In test mode, outbound "delivery" terminates at the TestChannelConnector by design.

## UI

None in scope. The frontend admin CRUD panel picks up `LlmFixture` and the Channel enum value for free via the generated SDK; no new screens. (Per `.claude/auto-test-generation.md`, no QA test cases or Playwright specs are required — this IP has no frontend flows.)

## Phases

### Phase 1 — Test-mode boot, seed, and TestChannelConnector
`bun run dev:test` boots offline with zero credentials: sandboxed `SHADE_DATA_DIR`, dedicated `shade-test` DB, seeded admin user + test channel + test group + fast-poll AppConfig. `TestChannelConnector` registered as a first-class `"test"` channel type.

### Phase 2 — MockAgentRunner + fixture registry
Backend enum widening, shared IPC writer extraction, `MockAgentRunner` implementing `AgentRunner` (fixture matching, echo fallback, scripted IPC side effects). Wired into `orchestrator/index.ts` and `workerMain.ts` under test mode (gateway and worker paths).

### Phase 3 — Test control API
`TestHarnessPlugin` with reset/outbox/tick/fixtures/state routes.

### Phase 4 — Sensitive-integration guards
Test mode never starts TriviaMonitor, PrWatcher, RadioTranscriber, or real channel connectors; Apple Calendar/Contacts routes return fixture data instead of shelling out.

### Phase 5 — Runbook + harness self-test
`docs/testing/ai-harness.md`, project skill `.claude/skills/shade-harness/SKILL.md`, and an end-to-end bun test that drives the loop through HTTP only.

## Feature Flags & Migrations

- `SHADE_TEST_MODE` env var is the single gate; absent → zero behavior change in dev/prod.
- Channel and backend enum additions are additive; no data migration. `LlmFixture` is a new collection; no migration.
- Rollout safety is layered: `TestHarnessPlugin` refuses to mount when `NODE_ENV === "production"` even with the env var set, **and** `/test/reset` independently verifies the DB name before wiping (we do not assume the prod host sets `NODE_ENV`).

## Activity Log & User Updates

Mock runs are audited identically to real runs because the audit writers (`GroupQueue`, `TaskWorkerService`) are unchanged and runner-agnostic: `TaskRunLog` + `AIRequest` rows appear with `modelBackend: "mock"` (via the seeded group's `defaultBackend`) and zero cost, plus session JSONL transcripts in the sandboxed data dir. `/test/reset` and fixture mutations log at `logger.info`.

## Not Included / Future Work

- **Option B** — fake Anthropic Messages API via `ANTHROPIC_BASE_URL` so the real Agent SDK + MCP tool loop runs against scripted `tool_use` turns (requires making `OPENAI_API_URL` an AppConfig field and passing `baseURL` to the raw Anthropic clients in TriviaMonitor/PrWatcher). Natural follow-on IP.
- **Option C** — real-Haiku contained smoke tier with spend cap.
- Clock/timer injection refactor for SchedulerService/TaskWorkerService (`/test/tick` + short intervals cover the need).
- Frontend test console UI; Playwright coverage of the harness.
- Mock coverage for TriviaMonitor/PrWatcher/RadioTranscriber internals (they are simply disabled in test mode).
- ReDoS-proof regex engine for fixture patterns (accepted risk: admin-gated, test-mode-only).

---

## Task List

### Phase 1: Test-mode boot, seed, and TestChannelConnector

- [x] **Task 1.1**: Test-mode bootstrap flag and sandbox
  - Description: Add `isTestMode()` helper (`backend/src/testMode/flag.ts`) reading `SHADE_TEST_MODE`; in test mode, default `MONGO_URI` db name to `shade-test` and `SHADE_DATA_DIR` to `backend/data-test/` (created by `initDirectories`). Add `dev:test` script to `backend/package.json` (`SHADE_TEST_MODE=1 bun run --watch src/index.ts` with PORT 4020).
  - Files: `backend/src/testMode/flag.ts` (new), `backend/src/boot.ts`, `backend/src/config.ts`, `backend/package.json`
  - Depends on: none
  - Acceptance: `bun run dev:test` boots with no credentials and no real `MONGO_URI`/data-dir collisions; `bun run dev` behavior unchanged.

- [x] **Task 1.2**: TestChannelConnector as first-class channel type
  - Description: Add `"test"` to the Channel enum; implement `createTestConnector` (`orchestrator/channels/test.ts`) satisfying the **entire** `ChannelConnector` interface (`channels/types.ts`) — `connect`/`disconnect`/`getHealth` as no-ops reporting connected, `sendMessage`/`sendMessageWithTs`/`updateMessage`/`addReaction`/`createChannel`/`inviteToChannel` as logging no-op stubs (`sendMessageWithTs` returns a synthetic ts, `createChannel` a synthetic id). The connector does **not** touch Message docs; outbound persistence is `ChannelManager`'s existing job. Register in `defaultConnectorFactories`.
  - Files: `backend/src/models/channel.ts`, `backend/src/orchestrator/channels/test.ts` (new), `backend/src/orchestrator/channels/manager.ts`, `backend/src/orchestrator/channels/test.test.ts` (new)
  - Depends on: none
  - Acceptance: bun test proves ChannelManager initializes a `"test"` channel and `sendMessageToGroup` produces an `isFromBot: true` Message without network access.

- [x] **Task 1.3**: Idempotent test seed
  - Description: `backend/src/testMode/seed.ts` — upsert admin user reusing the existing test identity from `testHelper.ts` (`admin@shade-test.com` / `TestPassword123!` — one seed identity across bun tests and the harness; `password123`-style values may fail password policy), one `"test"` channel, one test group (`requiresTrigger: false`, `modelConfig.defaultBackend: "mock"`), AppConfig tuned for the harness (pollIntervals message/ipc ≈ 250ms, scheduler minSleep low, `taskWorker.runInGateway: true`, `taskWorker.pollMs: 250`, `scheduler.useTaskBoard: false`, `concurrency.maxGlobal` pinned ≥ 5, empty apiKeys, `testMode` defaults). Run from `boot()` when in test mode.
  - Files: `backend/src/testMode/seed.ts` (new), `backend/src/boot.ts`, `backend/src/testMode/seed.test.ts` (new)
  - Depends on: Task 1.1, Task 1.2, Task 2.1 (for the `"mock"` backend enum on Group)
  - Acceptance: two consecutive boots produce exactly one admin/channel/group; `POST /command` against the seeded group returns 200.

### Phase 2: MockAgentRunner + fixture registry

- [x] **Task 2.1**: Widen backend enums with `"mock"`
  - Description: Add `"mock"` to `modelBackend` in `taskRunLog.ts`, `defaultBackend`/`fallbackBackend` in `group.ts` `modelConfig`, the `AgentRunConfig.modelBackend` union in `runners/types.ts`, and matching `backend/src/types/models/` definitions. Purely additive.
  - Files: `backend/src/models/taskRunLog.ts`, `backend/src/models/group.ts`, `backend/src/orchestrator/runners/types.ts`, `backend/src/types/models/*`
  - Depends on: none
  - Acceptance: bun test creates a `TaskRunLog` with `modelBackend: "mock"` and a Group with `defaultBackend: "mock"` without validation errors; existing tests pass.

- [x] **Task 2.2**: Shared IPC writer
  - Description: Extract `writeIpcFile` from `agentRunner/mcpServer.ts:59` into `orchestrator/ipc.ts` as an exported function rooted at `paths.ipc` (honors `SHADE_DATA_DIR`); update `mcpServer.ts` to import it and `direct.ts:89,105` to derive its `ipcDir`/`SHADE_IPC_DIR` from `paths.ipc` instead of the hardcoded `process.cwd()/data/ipc`. Fixes the latent writer/reader divergence for any non-default data dir.
  - Files: `backend/src/orchestrator/ipc.ts`, `backend/src/agentRunner/mcpServer.ts`, `backend/src/orchestrator/runners/direct.ts`
  - Depends on: none
  - Acceptance: bun test with `SHADE_DATA_DIR` overridden shows a written IPC file is picked up by `IpcWatcher.poll()`; existing IPC tests pass.

- [x] **Task 2.3**: LlmFixture model
  - Description: Implement `LlmFixture` per the Models section, with project schema conventions (timestamps, soft delete, `strict: "throw"`), indexed on `{priority: -1, created: 1}`; `pattern` validated at save (regex compiles, ≤500 chars). Register in models index and expose via `modelRouter` (admin-only).
  - Files: `backend/src/models/llmFixture.ts` (new), `backend/src/types/models/llmFixtureTypes.ts` (new), models index, CRUD route registration, `backend/src/models/llmFixture.test.ts` (new)
  - Depends on: none
  - Acceptance: bun test covers create, invalid-regex rejection, and length cap; CRUD endpoints appear in `openapi.json`.

- [x] **Task 2.4**: MockAgentRunner
  - Description: `orchestrator/runners/mock.ts` implementing `AgentRunner`. On `run(config)`: query active fixtures, regex-match against prompt inside try/catch (a throwing pattern logs a warning and is skipped), highest priority wins; `consumeOnce` fixtures are claimed atomically via `findOneAndUpdate` (soft-delete in the same op) so concurrent runs can't double-fire; apply `simulateLatencyMs`/`delayMs`; execute `actions` by writing IPC files via the shared writer from Task 2.2; return the fixture `response` as a normal `AgentRunResult` — or echo (`"[mock] received: <prompt excerpt>"`) when `testMode.echoFallback` and nothing matches. The mock writes **no** `TaskRunLog`/`AIRequest`/transcript rows — `GroupQueue`/`TaskWorkerService` own those and remain unchanged.
  - Files: `backend/src/orchestrator/runners/mock.ts` (new), `backend/src/orchestrator/runners/mock.test.ts` (new)
  - Depends on: Task 2.2, Task 2.3
  - Acceptance: bun test: pattern match, priority, atomic consumeOnce under two concurrent `run()` calls, invalid-pattern skip, echo fallback, and a send_message action that lands an IPC file under `paths.ipc`.

- [x] **Task 2.5**: Wire mock runner into gateway and worker
  - Description: In `orchestrator/index.ts:131-135` and `workerMain.ts:48`, construct `MockAgentRunner` instead of `DirectAgentRunner`/`OpenAIAgentRunner` when in test mode (mock serves as both runner and plannerRunner; the shared instance automatically covers `GroupQueue`, `PrWatcher`, and `TaskWorkerService`).
  - Files: `backend/src/orchestrator/index.ts`, `backend/src/workerMain.ts`
  - Depends on: Task 2.4, Task 1.3
  - Acceptance: with `bun run dev:test` running, `POST /command` → bot Message appears in the group within 2s with no network access, and its `TaskRunLog` row shows `modelBackend: "mock"`; same via an `AgentTask` with `deliverResult: true` (after `POST /test/tick {target: "taskWorker"}` or within the seeded 250ms poll).

### Phase 3: Test control API

- [x] **Task 3.1**: TestHarnessPlugin with reset/outbox/state
  - Description: New plugin mounted only when test mode AND `NODE_ENV !== "production"`; admin-gated. `/test/reset` first asserts the connected Mongo DB name is `shade-test`/`*-test` and returns 403 otherwise, then wipes non-User/AppConfig collections, clears IPC + transcript sandbox, re-seeds. `/test/outbox` queries `Message` docs (`isFromBot: true`, `groupId`, `since`). `/test/state` per the APIs section.
  - Files: `backend/src/api/testHarness.ts` (new), `backend/src/server.ts`, `backend/src/api/testHarness.test.ts` (new)
  - Depends on: Task 1.3
  - Acceptance: bun test drives seed → command → outbox shows the bot reply → reset → outbox empty; reset against a non-`-test` DB name returns 403 without deleting; plugin absent from `openapi.json` when flag unset.

- [x] **Task 3.2**: Force-tick endpoint
  - Description: `POST /test/tick` — expose `SchedulerService.wake()`; add a public `tickNow()` on `MessageLoop` **with an in-flight/reentrancy guard** (poll currently has none — `messageLoop.ts:51` — and `processedAt` is only set post-run, so an unguarded forced tick racing the 250ms interval double-runs messages); add an IPC-poll trigger and a `TaskWorkerService.tickNow()` (reclaim + claim cycle) so board tasks are deterministic. Orchestrator handles passed into the plugin. `{target: "all"}` runs the full chain in order.
  - Files: `backend/src/api/testHarness.ts`, `backend/src/orchestrator/messageLoop.ts`, `backend/src/orchestrator/services/taskWorker.ts`, `backend/src/orchestrator/index.ts`
  - Depends on: Task 3.1
  - Acceptance: bun test: (a) `ScheduledTask` due now → tick scheduler → `TaskRunLog` exists without a natural tick; (b) pending `AgentTask` → tick taskWorker → task claimed and completed; (c) concurrent `tickNow()` + interval poll processes a message exactly once.

### Phase 4: Sensitive-integration guards

- [x] **Task 4.1**: Skip real services and connectors in test mode
  - Description: In test mode, do not start TriviaMonitor, PrWatcher, RadioTranscriber; ChannelManager skips initializing non-`"test"` channel docs (log a warning instead). Guard lives at service-start sites, not inside the services.
  - Files: `backend/src/orchestrator/index.ts`, `backend/src/server.ts`, `backend/src/orchestrator/channels/manager.ts`
  - Depends on: Task 1.1
  - Acceptance: test-mode boot with a leftover Slack channel doc in the DB makes zero network attempts (verified by log assertions in bun test).

- [x] **Task 4.2**: Fixture-backed Apple Calendar/Contacts
  - Description: In test mode, `backend/src/utils/appleCalendar.ts` and `backend/src/utils/appleContacts.ts` (and the plugin routes that call them) return static fixture data (2-3 events/contacts) from `backend/src/testMode/fixtures.ts` instead of shelling out to JXA/AppleScript. Note: the real path is macOS-only anyway, so this guard is what makes the harness deterministic on Linux/CI as well as offline on macOS.
  - Files: `backend/src/utils/appleCalendar.ts`, `backend/src/utils/appleContacts.ts`, associated plugin route files, `backend/src/testMode/fixtures.ts` (new)
  - Depends on: Task 1.1
  - Acceptance: bun test (platform-independent): calendar/contacts endpoints return fixtures in test mode and no child process is spawned (exec mocked and asserted uncalled).

### Phase 5: Runbook + harness self-test

- [x] **Task 5.1**: End-to-end harness self-test
  - Description: Bun test that exercises the loop strictly over HTTP: boot test server → login → program a fixture with a send_message action → `POST /command` → poll `/test/outbox` for both the direct response and the action-delivered message → `POST /test/tick` a scheduled task and a board task → `/test/reset`. Extends `testHelper.ts` with `resetHarness()` / `getOutbox()` helpers (same seed identity as Task 1.3, so no second seeding regime).
  - Files: `backend/src/tests/harness.e2e.test.ts` (new), `backend/src/tests/testHelper.ts`
  - Depends on: Tasks 2.5, 3.1, 3.2
  - Acceptance: `bun test harness.e2e` passes offline in under 30s.

- [x] **Task 5.2**: AI-facing runbook and project skill
  - Description: `docs/testing/ai-harness.md` (start, send, observe, program fixtures, tick, reset — with curl examples) and project skill `.claude/skills/shade-harness/SKILL.md` that encodes the same loop for agent sessions. Document known noise: `checkModelsStrict()` logs non-fatal failures on boot with empty apiKeys (`server.ts:48`) — expected in test mode. Link from `CLAUDE.md` testing section and `docs/architecture/README.md`.
  - Files: `docs/testing/ai-harness.md` (new), `.claude/skills/shade-harness/SKILL.md` (new), `CLAUDE.md`, `docs/architecture/README.md`
  - Depends on: Task 5.1
  - Acceptance: a fresh agent session can complete send → observe using only the skill/runbook, no code spelunking.
