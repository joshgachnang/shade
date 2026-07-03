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
| Email | IMAP poll (~30s, ImapFlow) + SMTP | Attachments supported outbound; reply-to threading incomplete (TODO in `email.ts`) |
| Webhook | HTTP push | Inbound `WebhookSource` docs; outbound POST, responses ignored |
| EdgeAgent | HTTP push/pull | Remote daemons push messages, pull queued commands |

## Scheduler (`services/scheduler.ts`)

- Interval tick (default 5 min, `AppConfig.pollIntervals.scheduler`).
- Each tick: query `ScheduledTask` docs with `status: "active"`, compare `nextRunAt` (computed by `scheduleMath.ts`) to now.
- Due task → synthetic `Message` with the task's prompt pushed into GroupQueue with `metadata: {scheduledTaskId, scheduled: true}` — so a scheduled run is just a normal agent turn.
- Bookkeeping: `lastRunAt`, `runCount`, next run computed; `once` tasks marked completed; every run recorded in `TaskRunLog` (trigger, duration, cost, result).
- Schedule types: `cron` (cron expression), `interval` (ms), `once` (ISO date).
- Agents create and manage tasks themselves via the `schedule_task` / `list_tasks` / `pause_task` / `resume_task` / `cancel_task` MCP tools.
- Precision caveat: a task can fire up to one tick (~5 min) late.

## Agent task board (`services/taskBoard.ts`, `services/taskWorker.ts`)

Durable background delegation (IP-009, Hermes Kanban pattern). An agent turn can fan work out to background sub-agents via the `delegate_task` MCP tool; the work survives process restarts because Mongo is the queue.

- **`AgentTask` model** (`models/agentTask.ts`): `groupId`, `title`, `prompt`, `priority` (higher first), `status` (`pending → claimed → running → completed | failed | cancelled`), `attempts`/`maxAttempts` (default 2), `deliverResult`, `cancelRequested`, `workerId`, `claimedAt`/`heartbeatAt`/`startedAt`/`completedAt`, `result`/`error`. Admin CRUD at `/agentTasks`.
- **Claim semantics** (`taskBoard.ts`): claiming is a single atomic `findOneAndUpdate` (`pending → claimed`, sorted `{priority: -1, created: 1}`) stamped with the worker id (`${hostname}:${pid}`) — no locking library, any number of workers can share the board. `attempts` increments at claim time, so the field always reads "runs started".
- **Heartbeat & reclaim**: running tasks are heartbeated every `heartbeatMs`; a sweep at each tick reclaims `claimed`/`running` tasks whose heartbeat is older than `staleMs` (worker died mid-run) — requeued to `pending` while retry budget remains, else `failed`. The heartbeat doubles as the cancellation check: `cancel_agent_task` sets `cancelRequested`, and the worker aborts the run (AbortController) at its next beat.
- **`TaskWorkerService`** (`taskWorker.ts`): in-process worker pool started from orchestrator startup behind `AppConfig.taskWorker.enabled`. Each tick (`pollMs`, default 5s): reclaim stale tasks, then claim while below `concurrency` (default 2). Board runs execute through `DirectAgentRunner` with a fresh session per attempt, **bypassing GroupQueue** (background work, not conversation turns), capped at `taskTimeoutMs` (default 15 min) per attempt. Failure → requeue or terminal fail per the retry budget. Every attempt writes a `TaskRunLog` with `trigger: "delegated"`.
- **Delivery**: tasks with `deliverResult: true` post `✅ <title>: <result>` to the group's channel on completion; terminal failures post `❌` so they are never silent. Otherwise the parent agent polls `get_task_result`.
- **Depth limit**: board tasks run with `isBoardTask: true` threaded into the MCP context, and `delegate_task` rejects further delegation — one level only, no runaway fan-out.
- **IP-010 seam**: execution is in-process today, but the claim/heartbeat/reclaim primitives are process-agnostic; IP-010 exposes them as HTTP claim endpoints and moves execution to separate worker processes using the exact same semantics.

## Background services (`services/`)

- **RadioTranscriber** — ffmpeg tails a radio stream, Deepgram transcribes, transcripts batch into the DB and post to Slack; ACRCloud identifies songs; failed streams restart with exponential backoff.
- **TriviaMonitor** — rolling 25-message transcript window through Claude Haiku to detect trivia questions; on the `[MUSIC_START]` sentinel, finalizes questions, saves to the trivia DB, posts to webhooks, and launches a Claude Sonnet research agent with web search (Brave + Exa + Tavily). `!trivia <question>` researches manually.
- **PrWatcher** — polls GitHub PRs (`PrWatch` model), posts Slack notifications on state changes, can auto-review and fix merge conflicts with Claude.

## Process supervision

There is no in-process watchdog; supervision is external — systemd + `deploy/shade-watchdog.sh`, which polls `/health` and `/health/slack` and restarts the service on failure (see [Deployment](./deployment.md)).
