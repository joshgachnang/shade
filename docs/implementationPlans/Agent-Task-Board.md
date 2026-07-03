# Implementation Plan: Agent Task Board & Worker Pool

**Status:** Open
**Priority:** High
**Effort:** Big batch (1-2 weeks)
**IP:** IP-009

**Context:** From `docs/architecture/assessment-and-hermes.md` (Hermes recommendation #2 / arch gap #1). Shade has no multi-agent coordination: `GroupQueue` runs one agent per group and long jobs die with the process. This IP adds a durable, claimable `AgentTask` board (Hermes's Kanban pattern: heartbeats, reclaim from dead workers, retry budgets) plus MCP tools so an agent can fan work out to background sub-agents. Execution stays **in-process** in this IP (a `TaskWorkerService` inside the backend); IP-010 moves execution to separate worker processes using the exact same claim/heartbeat semantics — that is the seam between the two IPs.

**Assumptions made (no open questions):**
- New model is named `AgentTask` (distinct from `ScheduledTask`, which stays untouched here; IP-010 optionally routes scheduled runs through the board).
- Claiming is a single atomic `findOneAndUpdate` — no locking library, no queue infra (Mongo is the queue).
- Sub-agent runs reuse `DirectAgentRunner` with the parent group's context/session machinery, but their output is NOT auto-sent to the channel unless `deliverResult` is set; the parent agent polls via `get_task_result`.
- Worker identity is `${os.hostname()}:${process.pid}`.
- Depth is limited to one level: a task created by a task cannot itself delegate (reject `delegate_task` when the current run is already a board task) — prevents runaway fan-out.
- Concurrency default: 2 board tasks at once, on top of the existing `GroupQueue` global cap (board runs bypass GroupQueue — they are background work, not conversation turns).

## Models

**New: `AgentTask`** (`backend/src/models/agentTask.ts`, types in `backend/src/types/models/agentTaskTypes.ts`, exported from both `index.ts` barrels, `addDefaultPlugins`, `strict: "throw"`):

```ts
{
  groupId: {type: Schema.Types.ObjectId, ref: "Group", required: true},
  parentTaskId: {type: Schema.Types.ObjectId, ref: "AgentTask"},   // set when delegated by another board task (blocked in v1) — kept for lineage
  sourceMessageId: {type: Schema.Types.ObjectId, ref: "Message"},   // the conversation turn that delegated it
  title: {type: String, required: true},
  prompt: {type: String, required: true},
  status: {type: String, enum: ["pending", "claimed", "running", "completed", "failed", "cancelled"], default: "pending"},
  priority: {type: Number, default: 0},                             // higher first
  workerId: {type: String},
  claimedAt: {type: Date},
  heartbeatAt: {type: Date},
  startedAt: {type: Date},
  completedAt: {type: Date},
  attempts: {type: Number, default: 0},
  maxAttempts: {type: Number, default: 2},
  deliverResult: {type: Boolean, default: false},                   // post result to the group's channel on completion
  result: {type: String},
  error: {type: String},
}
```
Indexes: `{status: 1, priority: -1, created: 1}` (claim query), `{groupId: 1, created: -1}`, `{status: 1, heartbeatAt: 1}` (reclaim sweep).

**AppConfig additions** (`appConfig.ts` + types):
```ts
taskWorker: {
  enabled: {type: Boolean, default: true},
  concurrency: {type: Number, default: 2},
  pollMs: {type: Number, default: 5000},
  heartbeatMs: {type: Number, default: 15000},
  staleMs: {type: Number, default: 60000},      // heartbeat older than this → reclaim
  taskTimeoutMs: {type: Number, default: 900000} // 15 min per attempt
}
```

## APIs

- **CRUD**: register `AgentTask` in `backend/src/api/crudRoutes.ts` at `/agentTasks` — admin writes, authenticated reads; query fields: `groupId`, `status`, `workerId`. Register the model in `backend/src/adminConfig.ts` so the generic admin UI picks it up.
- **No custom REST actions in this IP** (cancel goes through normal PATCH or the MCP tool). IP-010 adds the HTTP claim/heartbeat endpoints for remote workers.

**New MCP tools** (`backend/src/agentRunner/mcpServer.ts`, same `tool()` pattern):

| Tool | Input | Behavior |
|---|---|---|
| `delegate_task` | `{title: string, prompt: string, priority?: number, deliverResult?: boolean}` | Creates an `AgentTask` for the current group with `sourceMessageId` from context. Returns the task id and "running in background". Rejected with an explanatory error if the current run is itself a board task. |
| `get_task_result` | `{taskId: string}` | Returns status; for `completed` include `result`, for `failed` include `error` and attempts. |
| `list_agent_tasks` | `{status?: string, limit?: number (default 10)}` | Group-scoped listing, newest first: id, title, status, age. |
| `cancel_agent_task` | `{taskId: string}` | Sets `cancelled` if `pending`; if `claimed`/`running`, sets a cancel flag the worker loop checks between heartbeats (best-effort abort via the runner's `AbortController`). |

## Notifications

- When a task with `deliverResult: true` completes, `TaskWorkerService` sends the result to the task's group through the existing outbound path (`ChannelManager.sendMessageToGroup`, after `formatOutboundMessage`), prefixed `✅ <title>:` (or `❌` on terminal failure). Terminal failures of `deliverResult` tasks are always delivered so they're never silent.
- No push/email beyond the group channel itself.

## UI

- Generic admin CRUD at `/admin/agentTasks` (free via `adminConfig.ts` registration + `bun run sdk` regeneration). No custom screens in v1.

## Phases

- **Phase 1 — Model & CRUD**: `AgentTask`, AppConfig block, routes, admin registration.
- **Phase 2 — Worker service**: claim/run/heartbeat/complete/retry/reclaim in-process.
- **Phase 3 — MCP tools**: delegate/get/list/cancel + prompt block.
- **Phase 4 — SDK subagents**: enable Claude Agent SDK's native subagents for intra-turn parallelism.
- **Phase 5 — Docs**.

## Feature Flags & Migrations

- `AppConfig.taskWorker.enabled` (default `true`) gates the service loop; `delegate_task` returns "task board disabled" when off.
- No migrations (new collection only).

## Activity Log & User Updates

- Write a `TaskRunLog` entry per attempt with `trigger: "delegated"` (extend the trigger enum in `backend/src/models/taskRunLog.ts`), duration, cost, result/error — same audit trail as scheduled runs.
- `logger.info` on claim, complete, fail, reclaim; `logger.warn` on stale-heartbeat reclaim.

## Not Included / Future Work

- Out-of-process / remote workers, HTTP claim protocol, systemd units → **IP-010**.
- Multi-level delegation trees, task dependencies/DAGs, cross-group tasks.
- Hermes-style "hallucination gate" output verification.
- Kanban UI beyond generic admin CRUD.
- Routing `ScheduledTask` runs through the board (→ IP-010).

## Acceptance Criteria

*Run `/ip:acceptance` for the structured version. Headline checks:*
1. Agent told "research X, Y, and Z in the background and message me when done" creates 3 `AgentTask`s via `delegate_task`; they run concurrently (up to `concurrency`) and results arrive in the channel (`deliverResult`).
2. Killing the process mid-run: on restart, the stale task is reclaimed (attempts+1) and re-runs; after `maxAttempts` it lands in `failed` with the error recorded.
3. Parent agent can poll `get_task_result` and report status.
4. A board task calling `delegate_task` is rejected.
5. Every attempt appears in `TaskRunLog`; tasks are visible/editable in the admin UI.

---

## Task List

*Each task is a single commit-sized unit. Format: `IP-009: <title>`.*

### Phase 1: Model & CRUD

- [ ] **Task 1.1**: `AgentTask` model + types
  - Description: Schema above with indexes; export from model/type barrels.
  - Files: `backend/src/models/agentTask.ts`, `backend/src/types/models/agentTaskTypes.ts`, `backend/src/models/index.ts`, `backend/src/types/models/index.ts`
  - Depends on: none
  - Acceptance: model unit test (create, status transitions, index presence); `bun run test` green.

- [ ] **Task 1.2**: `taskWorker` AppConfig block
  - Description: Add config fields + types.
  - Files: `backend/src/models/appConfig.ts`, `backend/src/types/models/appConfigTypes.ts`
  - Depends on: none
  - Acceptance: defaults load via `loadAppConfig()`; editable in admin.

- [ ] **Task 1.3**: CRUD route + admin registration + `TaskRunLog` trigger enum
  - Description: `/agentTasks` in `crudRoutes.ts` (admin write / auth read; query: groupId, status, workerId); register in `adminConfig.ts`; add `"delegated"` to the TaskRunLog trigger enum.
  - Files: `backend/src/api/crudRoutes.ts`, `backend/src/adminConfig.ts`, `backend/src/models/taskRunLog.ts`
  - Depends on: 1.1
  - Acceptance: `GET /agentTasks` works authenticated; model appears in admin UI after `bun run sdk`.

### Phase 2: Worker Service

- [ ] **Task 2.1**: Claim/reclaim primitives
  - Description: `backend/src/orchestrator/services/taskBoard.ts` — `claimNextTask(workerId)` (atomic `findOneAndUpdate` pending→claimed, sort `{priority: -1, created: 1}`), `heartbeatTask(taskId)`, `completeTask/failTask` (fail: attempts < maxAttempts → back to pending, else failed), `reclaimStaleTasks(staleMs)`.
  - Files: `backend/src/orchestrator/services/taskBoard.ts`, `backend/src/orchestrator/services/taskBoard.test.ts`
  - Depends on: 1.1
  - Acceptance: unit tests: two concurrent claims get different tasks; stale reclaim increments attempts; exhausted attempts → failed.

- [ ] **Task 2.2**: `TaskWorkerService`
  - Description: `backend/src/orchestrator/services/taskWorker.ts`, modeled on `scheduler.ts` (start/stop, interval tick, `ticking` guard). Each tick: `reclaimStaleTasks`, then claim while below `concurrency`. Per task: mark `running`, start heartbeat interval, execute via `DirectAgentRunner` with the group's context (build system prompt from group memory; the task `prompt` is the user prompt; honor `taskTimeoutMs` via AbortController), write `TaskRunLog`, `completeTask`/`failTask`, deliver result when `deliverResult` (via `ChannelManager.sendMessageToGroup`). Check the cancel flag between heartbeats.
  - Files: `backend/src/orchestrator/services/taskWorker.ts`, `backend/src/orchestrator/services/taskWorker.test.ts`
  - Depends on: 2.1, 1.2
  - Acceptance: unit test with a stubbed runner: happy path, failure→retry, timeout→abort, deliverResult sends through a stubbed ChannelManager.

- [ ] **Task 2.3**: Wire service into orchestrator startup
  - Description: Instantiate/start in `orchestrator/index.ts` behind `taskWorker.enabled`; stop on shutdown.
  - Files: `backend/src/orchestrator/index.ts`
  - Depends on: 2.2
  - Acceptance: boot log shows service started; disabling the flag skips it.

### Phase 3: MCP Tools

- [ ] **Task 3.1**: `delegate_task` + `get_task_result` + `list_agent_tasks` + `cancel_agent_task`
  - Description: Per the APIs table. Context must indicate whether the current run is a board task (thread a `isBoardTask` flag through `McpContext` from `TaskWorkerService` runs) to enforce the one-level rule.
  - Files: `backend/src/agentRunner/mcpServer.ts`, `backend/src/orchestrator/runners/direct.ts` (context flag)
  - Depends on: 2.2
  - Acceptance: unit tests for all four handlers incl. depth rejection and group scoping.

- [ ] **Task 3.2**: Delegation prompt block
  - Description: System-prompt guidance: use `delegate_task` for independent >1-minute subtasks or explicit "in the background" requests; poll or set `deliverResult`; don't delegate trivial lookups. Append in `buildSystemPrompt` when `taskWorker.enabled`.
  - Files: `backend/src/orchestrator/memory.ts` (or shared prompt-block module if IP-008 landed)
  - Depends on: 3.1
  - Acceptance: block present when enabled; unit test.

### Phase 4: SDK Subagents

- [ ] **Task 4.1**: Enable Claude Agent SDK subagents in `DirectAgentRunner`
  - Description: Add `AppConfig.agent.enableSubagents` (default `true`); when set, include the SDK's agent/Task capability in the `query()` options and add `Task` to allowed tools so a single turn can fan out short-lived parallel subagents (complementary to the board: intra-turn vs. durable background).
  - Files: `backend/src/orchestrator/runners/direct.ts`, `backend/src/models/appConfig.ts`, `backend/src/types/models/appConfigTypes.ts`
  - Depends on: none (parallel to Phases 1–3)
  - Acceptance: with flag on, a prompt like "check these 3 URLs in parallel" spawns SDK subagents (verify via session transcript); flag off restores current behavior.

### Phase 5: Docs

- [ ] **Task 5.1**: Update architecture docs
  - Description: Add the task board to `docs/architecture/orchestrator.md` and `agents-and-tools.md` (limitations section update), note IP-010 seam.
  - Files: `docs/architecture/orchestrator.md`, `docs/architecture/agents-and-tools.md`
  - Depends on: 3.1
  - Acceptance: docs match shipped behavior.
