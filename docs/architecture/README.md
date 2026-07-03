# Shade Architecture

Shade is a self-hosted personal AI butler: a multi-channel agent orchestrator that receives messages from Slack, iMessage, email, and webhooks, runs Claude agents against them, executes scheduled (cron) tasks, and takes real-world actions through MCP tools (calendar, contacts, reminders, media servers, task scheduling).

This directory is the internal documentation of how the whole app works. This page is the high-level map (1–2 sentences per component); each linked page goes deeper. For the architecture critique and the Hermes Agent comparison, see [Assessment & Hermes comparison](./assessment-and-hermes.md).

## System diagram

```
  Slack ──(socket mode)──┐
  iMessage ──(sqlite poll / edge agent)─┤
  Email ──(IMAP poll)────┤                         ┌────────────────┐
  Webhooks ──(HTTP)──────┼─▶ ChannelManager ─▶ Message (Mongo)     │
  Edge agents ──(HTTP)───┘                    │                    │
                                              ▼                    │
  ScheduledTask ──(SchedulerService tick)─▶ MessageLoop ─▶ GroupQueue
                                                              │
                                                              ▼
                                     DirectAgentRunner (Claude Agent SDK)
                                     OpenAIAgentRunner (feature planning)
                                                              │
                                          MCP tools + IPC files (data/ipc/)
                                                              │
                                                              ▼
                                       IpcWatcher ─▶ ChannelManager ─▶ outbound
                                       (send_message, rich cards, schedule_task…)
```

## Components

### Runtime & orchestration

- **[Backend core](./backend.md)** — Express + Mongoose app built on `@terreno/api`. Boots Mongo → loads the `AppConfig` singleton → hydrates `process.env` → registers auto-generated CRUD routes for ~26 models plus custom action routes and the admin UI. (`backend/src/server.ts`)
- **[Orchestrator](./orchestrator.md)** — The heart of the system: `MessageLoop` polls for unprocessed messages, `GroupQueue` serializes work per conversation group with global concurrency limits, and runners execute agents. (`backend/src/orchestrator/`)
- **[Agent runtime & tools](./agents-and-tools.md)** — `DirectAgentRunner` spawns Claude via `@anthropic-ai/claude-agent-sdk` with an in-process "Shade" MCP server (~30 tools: messaging, scheduling, storage, Apple Reminders/Contacts, radio, trivia). `OpenAIAgentRunner` handles the planning phase of feature channels. (`backend/src/orchestrator/runners/`, `backend/src/agentRunner/`)
- **Scheduler** — `SchedulerService` ticks every ~5 min, finds due `ScheduledTask` docs (cron / interval / once), and injects a synthetic message into the group queue so the task runs as a normal agent turn; every run is audited in `TaskRunLog`. Covered in [Orchestrator](./orchestrator.md).

### Channels & integrations

- **Channels** — Five connectors behind one `ChannelConnector` interface: Slack (socket mode, real-time, rich Block Kit cards), iMessage (chat.db poll + AppleScript send), email (IMAP/SMTP poll), generic webhooks, and edge agents. Covered in [Orchestrator](./orchestrator.md).
- **[Edge agents](./edge-agents.md)** — Remote daemons (e.g. an iMessage relay on a Mac mini) that register, heartbeat, pull config/commands, and push messages back over HTTP with AES-256-GCM-encrypted secrets. (`backend/src/edge/`, `packages/edge-agent-*`)
- **MCP media server** — Standalone HTTP MCP server exposing Sonarr / Radarr / NZBGet / Plex tools for media-center automation. Covered in [Backend core](./backend.md). (`backend/src/mcpMediaServer/`)
- **Apple integrations** — REST routes and MCP tools for Calendar.app, Contacts.app, and Reminders (macOS JXA/AppleScript). Covered in [Backend core](./backend.md).

### Feature verticals

- **Feature channels** — A software-building workflow: a dedicated Slack channel + Group starts in a *planning* phase (OpenAI planner), then `/implement` flips it to an *implementing* phase (Claude Agent SDK). Covered in [Agent runtime](./agents-and-tools.md).
- **Radio + trivia pipeline** — `RadioTranscriber` streams radio audio through ffmpeg → Deepgram; `TriviaMonitor` detects trivia questions with Haiku, researches answers with Sonnet + web search, and posts to webhooks. Covered in [Orchestrator](./orchestrator.md).
- **Movie analysis** — ffmpeg frame extraction → OpenRouter (Gemini) vision analysis → character tracking, searchable via Atlas Search. Covered in [Backend core](./backend.md).
- **PR watcher** — Polls GitHub PRs, notifies Slack on state changes, and can auto-review / fix conflicts with Claude. Covered in [Orchestrator](./orchestrator.md).

### Frontend & operations

- **[Frontend](./frontend.md)** — Expo (React Native + web) app using `@terreno/ui`, Expo Router, and an RTK Query SDK generated from the backend's OpenAPI spec; includes the Shade Console (agent chat UI) and a generic admin CRUD panel. (`frontend/`)
- **[Deployment](./deployment.md)** — Web frontend on Netlify (`s.nang.io`); backend on a Tailscale host under systemd with a shell watchdog that polls `/health` + `/health/slack` and restarts on failure (`shade-api.nang.io`).

### Cross-cutting patterns

- **AppConfig** — All runtime config (API keys, models, intervals, feature flags) lives in a MongoDB singleton read via `loadAppConfig()`; env vars are bootstrap-only (`MONGO_URI`, `PORT`) plus values hydrated into `process.env` for SDKs. (`backend/src/models/appConfig.ts`, `backend/src/utils/configEnv.ts`)
- **Auth & permissions** — Passport local (email/password) + JWT via Terreno; route access via `IsAuthenticated` / `IsAdmin` / `IsOwner`.
- **Persistence conventions** — Every schema gets `created`/`updated` timestamps, soft delete, and strict mode (`strict: "throw"`). Sessions/transcripts and IPC live on the filesystem under `SHADE_DATA_DIR`.
- **Observability** — `AIRequest` logs every LLM call with tokens and cost; `TaskRunLog` audits every task run; Sentry captures crashes; admin scripts surface system status and AI spend.
- **AI testability harness (IP-012)** — `SHADE_TEST_MODE=1` (`bun run dev:test`) boots the full orchestration pipeline offline: `MockAgentRunner` replaces all LLM calls (scripted via `LlmFixture`), a no-op `"test"` channel type hosts observable conversations, real integrations are stubbed/disabled, and a `/test/*` control API drives reset/tick/outbox. See [AI harness](../testing/ai-harness.md).

## Key data models (the ones that matter)

| Model | Role |
|---|---|
| `Channel` | An inbound/outbound transport instance (a Slack workspace, an IMAP account, …) |
| `Group` | A conversation thread within a channel; unit of agent context, queueing, and config |
| `Message` | Every inbound/outbound message; `processedAt` drives the message loop |
| `ScheduledTask` | Cron/interval/one-shot agent task, group-scoped |
| `TaskRunLog` | Audit record of each task execution (trigger, duration, cost, result) |
| `AgentSession` | Claude SDK session pointer + JSONL transcript path, with resume checkpoints |
| `AIRequest` | Per-LLM-call metrics and cost |
| `EdgeAgent` | A registered remote daemon (status, heartbeat, encrypted secrets, command queue) |
| `AppConfig` | The configuration singleton |
