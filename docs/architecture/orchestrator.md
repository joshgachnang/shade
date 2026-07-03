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

## Background services (`services/`)

- **RadioTranscriber** — ffmpeg tails a radio stream, Deepgram transcribes, transcripts batch into the DB and post to Slack; ACRCloud identifies songs; failed streams restart with exponential backoff.
- **TriviaMonitor** — rolling 25-message transcript window through Claude Haiku to detect trivia questions; on the `[MUSIC_START]` sentinel, finalizes questions, saves to the trivia DB, posts to webhooks, and launches a Claude Sonnet research agent with web search (Brave + Exa + Tavily). `!trivia <question>` researches manually.
- **PrWatcher** — polls GitHub PRs (`PrWatch` model), posts Slack notifications on state changes, can auto-review and fix merge conflicts with Claude.

## Process supervision

There is no in-process watchdog; supervision is external — systemd + `deploy/shade-watchdog.sh`, which polls `/health` and `/health/slack` and restarts the service on failure (see [Deployment](./deployment.md)).
