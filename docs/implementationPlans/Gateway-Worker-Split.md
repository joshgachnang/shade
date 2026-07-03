# Implementation Plan: Gateway/Worker Process Split

**Status:** Pending Verification
**Priority:** Medium
**Effort:** Big batch (1-2 weeks)
**IP:** IP-010

**Context:** From `docs/architecture/assessment-and-hermes.md` (Hermes recommendation #3 / arch gap #3). Today one process hosts channels, the orchestrator, ffmpeg radio streaming, movie processing, and every agent run — so a watchdog restart (triggered by, say, a stuck Slack socket) kills healthy in-flight work. This IP splits execution along the seam IP-009 created: the **gateway** keeps channels, MessageLoop, IpcWatcher, scheduler, and interactive conversation turns (latency-sensitive); **worker processes** run `AgentTask` board work and scheduled-task runs. This mirrors Hermes's gateway-daemon vs. execution-backend split.

**Depends on:** IP-009 (Agent Task Board) must be complete — workers are just `TaskWorkerService` running in a separate process.

**Assumptions made (no open questions):**
- Workers run **on the same host** as the gateway, sharing `SHADE_DATA_DIR` (sessions, groups, ipc) and the local MongoDB. Coordination happens through Mongo (the task board) and the filesystem (IPC files written by worker-run agents are picked up by the gateway's `IpcWatcher`) — **no HTTP worker protocol in v1**. Remote workers are future work.
- Same repo, second entrypoint (`backend/src/workerMain.ts`) — no new package; `@shade/worker` (`packages/shade-worker`) is superseded for this purpose and left untouched.
- Interactive turns stay in the gateway. Moving chat turns out-of-process buys little (they're short) and costs latency.
- Scheduled tasks move to the board: `SchedulerService` creates an `AgentTask` (`deliverResult: true`) instead of a synthetic message, behind a flag — this is the main blast-radius win, since scheduled jobs are the long-running ones.
- Radio streaming (stateful ffmpeg) stays in the gateway; movie processing offload is future work.

## Models

**No new models.** AppConfig additions:
```ts
taskWorker: {
  // ...existing IP-009 fields...
  runInGateway: {type: Boolean, default: true},   // false once external workers are deployed
}
scheduler: {
  useTaskBoard: {type: Boolean, default: false},  // scheduled runs → AgentTask instead of synthetic message
}
```
`ScheduledTask` and `AgentTask` are unchanged (`AgentTask.sourceMessageId` stays null for scheduled runs; add optional `scheduledTaskId: ObjectId` field to `AgentTask` for lineage — one-line schema addition).

## APIs

- **New: worker health endpoint.** The worker process runs a tiny Express app (pattern from `mcpMediaServer/index.ts`) exposing `GET /health` → `{status, workerId, runningTasks, uptime}` on `WORKER_PORT` (default 4021). Not registered in the main server.
- No other API changes; workers talk to Mongo directly.

## Notifications

None beyond IP-009's `deliverResult` behavior (which is how scheduled-run output continues to reach its group).

## UI

None. Worker liveness is observable via `AgentTask.workerId`/`heartbeatAt` in the existing admin CRUD and the `systemStatus` admin script (extend it to show distinct active `workerId`s and last-heartbeat ages).

## Phases

- **Phase 1 — Worker entrypoint**: `workerMain.ts` boot path + graceful shutdown.
- **Phase 2 — Scheduler → board**: flag-gated `AgentTask` dispatch for scheduled runs.
- **Phase 3 — Deploy**: systemd unit, setup script, watchdog scope.
- **Phase 4 — Cutover & observability**: `runInGateway=false`, systemStatus extension, docs.

## Feature Flags & Migrations

Rollout order (each step independently reversible):
1. Ship code; nothing changes (`runInGateway=true`, `useTaskBoard=false`).
2. Deploy `shade-worker.service`; both gateway and worker claim board tasks (safe — claims are atomic).
3. Set `taskWorker.runInGateway=false` → board work is worker-only.
4. Set `scheduler.useTaskBoard=true` → scheduled runs go through the board, i.e. run on workers.

No data migrations.

## Activity Log & User Updates

- Worker logs go to its own systemd journal (`shade-worker.service`).
- `TaskRunLog` continues to capture every run; `workerId` on `AgentTask` attributes runs to processes.

## Not Included / Future Work

- Remote/multi-host workers (requires an HTTP claim protocol + shared session storage — the edge-agent auth pattern is the template).
- Moving movie processing (`services/moviePipeline.ts`) and radio streaming out of the gateway.
- Interactive conversation turns on workers.
- Autoscaling / multiple worker processes per host (works in principle via atomic claims; untested, undocumented).

## Acceptance Criteria

*Run `/ip:acceptance` for the structured version. Headline checks:*
1. `bun run worker` (and the systemd unit) starts a process that claims and completes board tasks, with the gateway's `runInGateway=false`.
2. `systemctl restart shade-backend` while a worker task runs: the task completes and its result reaches the channel after the gateway returns (IPC file waits until IpcWatcher resumes).
3. `systemctl stop shade-worker` mid-task: SIGTERM lets the in-flight task finish (up to a drain timeout) before exit; a SIGKILL'd task is reclaimed by the next worker start via IP-009 stale-heartbeat reclaim.
4. With `scheduler.useTaskBoard=true`, a due `ScheduledTask` produces an `AgentTask` that runs on the worker and delivers output to its group; `TaskRunLog` still records it.
5. The watchdog only restarts the gateway; worker tasks survive gateway restarts.

---

## Task List

*Each task is a single commit-sized unit. Format: `IP-010: <title>`.*

### Phase 1: Worker Entrypoint

- [x] **Task 1.1**: `workerMain.ts` boot path
  - Description: New entrypoint that reuses the gateway boot helpers: connect Mongo, `loadAppConfig()`, `hydrateEnvFromConfig()`, init filesystem paths, then start ONLY `TaskWorkerService` + the `/health` mini-app. Extract shared boot steps from `server.ts` into `backend/src/boot.ts` so both entrypoints call the same code. Add `"worker": "bun run src/workerMain.ts"` script to `backend/package.json`.
  - Files: `backend/src/workerMain.ts` (new), `backend/src/boot.ts` (new, extracted), `backend/src/server.ts` (use extracted helpers), `backend/package.json`
  - Depends on: IP-009 complete
  - Acceptance: `bun run worker` boots, claims a seeded pending `AgentTask`, completes it; `curl :4021/health` returns worker status; `bun run dev` (gateway) unaffected.

- [x] **Task 1.2**: Graceful shutdown + `runInGateway` flag
  - Description: SIGTERM/SIGINT handler in the worker: stop claiming, wait for in-flight tasks up to `taskWorker.taskTimeoutMs` (then abort so reclaim handles it), exit 0. In `orchestrator/index.ts`, start `TaskWorkerService` only when `taskWorker.runInGateway` is true.
  - Files: `backend/src/workerMain.ts`, `backend/src/orchestrator/index.ts`, `backend/src/models/appConfig.ts`, `backend/src/types/models/appConfigTypes.ts`
  - Depends on: 1.1
  - Acceptance: unit test for drain logic (stubbed task); gateway with `runInGateway=false` never claims.

### Phase 2: Scheduler → Board

- [x] **Task 2.1**: Flag-gated board dispatch for scheduled tasks
  - Description: Add `scheduler.useTaskBoard` config + optional `scheduledTaskId` field on `AgentTask`. In `orchestrator/services/scheduler.ts`, when the flag is on, create `AgentTask {groupId, title: task.name, prompt: task.prompt, deliverResult: true, scheduledTaskId}` instead of the synthetic message; bookkeeping (`lastRunAt`, `runCount`, `nextRunAt`, once→completed) unchanged.
  - Files: `backend/src/orchestrator/services/scheduler.ts`, `backend/src/models/agentTask.ts`, `backend/src/types/models/agentTaskTypes.ts`, `backend/src/models/appConfig.ts`, `backend/src/types/models/appConfigTypes.ts`
  - Depends on: 1.1
  - Acceptance: unit test: flag on → AgentTask created, no synthetic message, bookkeeping updated; flag off → current behavior byte-identical.

### Phase 3: Deploy

- [x] **Task 3.1**: systemd unit + setup script
  - Description: `deploy/shade-worker.service` mirroring `shade-backend.service` (ExecStart `bun run worker`, same user/env file/`SHADE_DATA_DIR`, `TimeoutStopSec` ≥ drain timeout); extend `deploy/setup-server.sh` to install/enable it.
  - Files: `deploy/shade-worker.service` (new), `deploy/setup-server.sh`
  - Depends on: 1.2
  - Acceptance: shellcheck-clean; unit file references only existing paths/env.

- [x] **Task 3.2**: Watchdog scope check
  - Description: Verify `deploy/shade-watchdog.sh` restarts only `shade-backend.service`; add a comment stating workers are intentionally out of scope; add worker `/health` port to `config/shade-worker.env.example`.
  - Files: `deploy/shade-watchdog.sh`, `config/shade-worker.env.example`
  - Depends on: 3.1
  - Acceptance: watchdog script contains no reference to shade-worker restarts.

### Phase 4: Cutover & Observability

- [x] **Task 4.1**: Extend `systemStatus` admin script
  - Description: Add a workers section: distinct `workerId`s active in the last 5 min (from `AgentTask.heartbeatAt`), running/pending/failed counts.
  - Files: `backend/src/admin/scripts/systemStatus.ts` (adjust to actual path)
  - Depends on: 1.1
  - Acceptance: script output includes worker section; dry-run safe.

- [x] **Task 4.2**: Update architecture docs
  - Description: Update `docs/architecture/orchestrator.md` (process supervision section), `deployment.md` (worker service, rollout flags), and the assessment gap list.
  - Files: `docs/architecture/orchestrator.md`, `docs/architecture/deployment.md`, `docs/architecture/assessment-and-hermes.md`
  - Depends on: 2.1, 3.1
  - Acceptance: docs match shipped behavior, including the four-step rollout.
