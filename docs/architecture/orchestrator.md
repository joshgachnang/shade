# Orchestrator

`backend/src/orchestrator/` is the message-routing engine: it turns inbound messages (and due scheduled tasks) into agent runs, and agent output back into channel messages.

## Message lifecycle

1. **Inbound**: a channel connector receives a message, dedupes by `(groupId, externalId)`, and stores a `Message` doc. `CommandRouter` intercepts `!`-prefixed commands (`!trivia`, `!moviesearch`) before agents see them.
2. **MessageLoop** (`messageLoop.ts`): polls for unprocessed messages every ~5s (`AppConfig.pollIntervals`), checks the group's trigger condition (`requiresTrigger` / trigger pattern), and enqueues work.
3. **GroupQueue**: serializes execution per group (one agent at a time per conversation) and enforces a global concurrency cap (`AppConfig.concurrency.maxGlobal`).
4. **Runner**: `DirectAgentRunner` (Claude Agent SDK) by default; `OpenAIAgentRunner` when the group is a feature channel in its planning phase. Prompt = system prompt from group memory (`memory.ts`, group folder `CLAUDE.md`) + last ~2 hours of conversation formatted as XML (`router.ts` `buildPromptForGroup`).
5. **Output**: agents act through MCP tools that write **IPC files** to `data/ipc/`. `IpcWatcher` polls that directory and dispatches commands: `send_message`, `rich_response`, task scheduling ops, reactions, feature creation, etc.
6. **Outbound**: `ChannelManager.sendMessageToGroup` fans the response out through the group's channel connector. Rich responses (`responses/`) render per channel: Slack Block Kit, Terreno JSON, or `fallbackText`.

## Channels (`channels/`)

All connectors implement `ChannelConnector` (`channels/types.ts`).

| Channel | Transport | Notes |
|---|---|---|
| Slack | Socket Mode (`@slack/bolt`), real-time | Rich Block Kit cards, reactions, threads, message updates; per-channel bot/app tokens |
| iMessage | chat.db SQLite poll (~5s) + AppleScript send | Text only; requires a macOS host (or an [edge agent](./edge-agents.md)) |
| Email | IMAP poll (~30s, ImapFlow) + SMTP | Attachments supported outbound; replies thread back to the most recent inbound sender (`In-Reply-To`/`References`/`Re:` from stored `metadata`, IP-011), falling back to the configured recipient when no inbound metadata exists |
| Webhook | HTTP push | Inbound `WebhookSource` docs; outbound POST, responses ignored |
| EdgeAgent | HTTP push/pull | Remote daemons push messages, pull queued commands |

## Scheduler (`services/scheduler.ts`)

- Adaptive tick (IP-011): a self-re-arming `setTimeout` chain. After each tick, the service queries `min(nextRunAt)` over active tasks and sleeps `clamp(nextRunAt - now, 5s, AppConfig.pollIntervals.scheduler)` — so `pollIntervals.scheduler` (default 5 min, re-read from config on each re-arm) is the *maximum* sleep, an empty board sleeps the max, and near-term tasks fire on time.
- `wake()` cancels the pending sleep and ticks immediately (a wake during a tick is never lost). The gateway's IPC handlers call it when tasks are created, updated, or resumed (`schedule_task`/`resume_task`), so agent-created tasks fire promptly even from workers (IPC files flow to the gateway, ~one IPC-poll delay). Tasks created via admin CRUD don't wake the scheduler — they're picked up within one max interval.
- Each tick: query `ScheduledTask` docs with `status: "active"`, compare `nextRunAt` (computed by `scheduleMath.ts`) to now.
- Due task → by default a synthetic `Message` with the task's prompt pushed into GroupQueue with `metadata: {scheduledTaskId, scheduled: true}` — so a scheduled run is just a normal agent turn. With `AppConfig.scheduler.useTaskBoard` (default false, IP-010), the scheduler instead creates an `AgentTask {deliverResult: true, scheduledTaskId}` so the run executes via the task board — i.e. on a worker process (see below). Bookkeeping is identical in both modes, but board mode ignores group-queue busyness.
- Bookkeeping: `lastRunAt`, `runCount`, next run computed; `once` tasks marked completed; every run recorded in `TaskRunLog` (trigger, duration, cost, result).
- Schedule types: `cron` (cron expression), `interval` (ms), `once` (ISO date).
- Agents create and manage tasks themselves via the `schedule_task` / `list_tasks` / `pause_task` / `resume_task` / `cancel_task` MCP tools.
- Precision caveat: ~5 s worst case for tasks known when the sleep was armed (or created through a wake-calling path); a task created via admin CRUD can still land up to one max interval (~5 min) late. No sub-second precision.

## Agent task board (`services/taskBoard.ts`, `services/taskWorker.ts`)

Durable background delegation (IP-009, Hermes Kanban pattern). An agent turn can fan work out to background sub-agents via the `delegate_task` MCP tool; the work survives process restarts because Mongo is the queue.

- **`AgentTask` model** (`models/agentTask.ts`): `groupId`, `title`, `prompt`, `priority` (higher first), `status` (`pending → claimed → running → completed | failed | cancelled`), `attempts`/`maxAttempts` (default 2), `deliverResult`, `cancelRequested`, `workerId`, `claimedAt`/`heartbeatAt`/`startedAt`/`completedAt`, `result`/`error`, plus optional `scheduledTaskId` for lineage when a scheduled run is dispatched to the board (IP-010). Admin CRUD at `/agentTasks`.
- **Claim semantics** (`taskBoard.ts`): claiming is a single atomic `findOneAndUpdate` (`pending → claimed`, sorted `{priority: -1, created: 1}`) stamped with the worker id (`${hostname}:${pid}`) — no locking library, any number of workers can share the board. `attempts` increments at claim time, so the field always reads "runs started".
- **Heartbeat & reclaim**: running tasks are heartbeated every `heartbeatMs`; a sweep at each tick reclaims `claimed`/`running` tasks whose heartbeat is older than `staleMs` (worker died mid-run) — requeued to `pending` while retry budget remains, else `failed`. The heartbeat doubles as the cancellation check: `cancel_agent_task` sets `cancelRequested`, and the worker aborts the run (AbortController) at its next beat.
- **`TaskWorkerService`** (`taskWorker.ts`): worker pool behind `AppConfig.taskWorker.enabled`. The gateway starts it in-process only while `AppConfig.taskWorker.runInGateway` is true (default; gated by `shouldRunTaskWorkerInGateway()`, IP-010); dedicated worker processes run the same service against the same board. Each tick (`pollMs`, default 5s): reclaim stale tasks, then claim while below `concurrency` (default 2). Board runs execute through `DirectAgentRunner` with a fresh session per attempt, **bypassing GroupQueue** (background work, not conversation turns), capped at `taskTimeoutMs` (default 15 min) per attempt. Failure → requeue or terminal fail per the retry budget. Every attempt writes a `TaskRunLog` with `trigger: "delegated"`.
- **Delivery**: tasks with `deliverResult: true` post `✅ <title>: <result>` to the group's channel on completion; terminal failures post `❌` so they are never silent. Otherwise the parent agent polls `get_task_result`.
- **Depth limit**: board tasks run with `isBoardTask: true` threaded into the MCP context, and `delegate_task` rejects further delegation — one level only, no runaway fan-out.
- **Process placement (IP-010)**: the claim/heartbeat/reclaim primitives are process-agnostic — coordination is entirely through Mongo (atomic claims) and the filesystem, no HTTP worker protocol — so board execution runs in dedicated worker processes (`bun run worker`, see below) with the gateway's in-process pool as a rollout fallback. Remote/multi-host workers (which would need an HTTP claim protocol) remain future work.

## Background services (`services/`)

- **RadioTranscriber** — ffmpeg tails a radio stream, Deepgram transcribes, transcripts batch into the DB and post to Slack; ACRCloud identifies songs; failed streams restart with exponential backoff.
- **TriviaMonitor** — rolling 25-message transcript window through the cheap auxiliary model (`AppConfig.agent.auxiliaryModel`, default Haiku; trivia-specific override via `models.detector`/`DETECTOR_MODEL`) to detect trivia questions; on the `[MUSIC_START]` sentinel, finalizes questions, saves to the trivia DB, posts to webhooks, and launches a Claude Sonnet research agent with web search (Brave + Exa + Tavily). `!trivia <question>` researches manually.
- **PrWatcher** — polls GitHub PRs (`PrWatch` model), posts Slack notifications on state changes, can auto-review and fix merge conflicts with Claude.

## Gateway/worker split & process supervision

Since IP-010 the backend runs as two processes on the same host, sharing MongoDB and `SHADE_DATA_DIR`:

- **Gateway** (`server.ts`, `shade-backend.service`): channels, MessageLoop, IpcWatcher, scheduler, interactive conversation turns, radio streaming, movie processing — everything latency-sensitive or stateful. It also runs an in-process `TaskWorkerService` while `taskWorker.runInGateway` is true.
- **Worker** (`backend/src/workerMain.ts`, `bun run worker`, `shade-worker.service`): `AgentTask` board work only — including scheduled runs once `scheduler.useTaskBoard` is on. Owns the claim-loop interval and serves `GET /health` on `WORKER_PORT` (default 4021) → `{status, workerId, runningTasks, uptimeSeconds}`.

Both entrypoints share `backend/src/boot.ts`: Mongo connect → `loadAppConfig()` → `hydrateEnvFromConfig()` → init data directories.

**Cross-process result delivery**: agents running on a worker deliver output by writing a `send_message` IPC file (exact MCP schema, tmp+rename) into the shared `paths.ipc` directory; the gateway's `IpcWatcher` dispatches it like any other IPC command. Results queue on disk, so a task that finishes while the gateway is down is delivered when `IpcWatcher` resumes.

**Drain semantics**: on SIGTERM/SIGINT the worker stops claiming, waits for in-flight tasks up to `taskWorker.taskTimeoutMs` (default 15 min), aborts any stragglers (stale-heartbeat reclaim retries them), and exits 0.

**Rollout flags** (each step independently reversible): 1) ship code — nothing changes (`runInGateway=true`, `useTaskBoard=false`); 2) deploy `shade-worker.service` — gateway and worker both claim (safe, claims are atomic); 3) `taskWorker.runInGateway=false` — board work is worker-only; 4) `scheduler.useTaskBoard=true` — scheduled runs go through the board, i.e. run on workers.

Supervision is external — systemd for both units, plus `deploy/shade-watchdog.sh`, which polls the gateway's `/health` and `/health/slack` and restarts **only** `shade-backend.service`; the worker is intentionally not watchdog-managed, so a gateway restart never kills in-flight board tasks (see [Deployment](./deployment.md)). Worker liveness is visible in the `systemStatus` admin script's Workers section (active `workerId`s with heartbeat ages, board status counts).
