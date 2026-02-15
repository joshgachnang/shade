# Task List: Shade Orchestrator

Structured task breakdown for automated implementation. Each task should be independently implementable and testable. All CRUD routes use `modelRouter` from `@terreno/api`. Frontend uses auto-generated SDK hooks via `bun run sdk`.

---

## Phase 1: Core Infrastructure

- [ ] **Task 1.1**: Create TypeScript type definitions for all models
  - Description: Define Document, Model, Methods, Statics, and Schema types for all 10 new models following the existing `DefaultDoc`/`DefaultModel`/`DefaultStatics` pattern in `userTypes.ts`.
  - Files: `backend/src/types/models/channelTypes.ts`, `backend/src/types/models/groupTypes.ts`, `backend/src/types/models/messageTypes.ts`, `backend/src/types/models/scheduledTaskTypes.ts`, `backend/src/types/models/taskRunLogTypes.ts`, `backend/src/types/models/agentSessionTypes.ts`, `backend/src/types/models/remoteAgentTypes.ts`, `backend/src/types/models/commandClassificationTypes.ts`, `backend/src/types/models/pluginTypes.ts`, `backend/src/types/models/webhookSourceTypes.ts`, `backend/src/types/models/index.ts`
  - Depends on: none
  - Acceptance: All type files compile with `tsc`. Barrel export in `types/models/index.ts` includes all new types.

- [ ] **Task 1.2**: Create Channel model
  - Description: Mongoose schema for Channel with fields: name, type (enum: slack/webhook), status (enum: connected/disconnected/error), config (Mixed), lastConnectedAt. Apply `addDefaultPlugins`. Register in `models/index.ts`.
  - Files: `backend/src/models/channel.ts`, `backend/src/models/index.ts`
  - Depends on: 1.1
  - Acceptance: Model compiles, can be instantiated in a test.

- [ ] **Task 1.3**: Create Group model
  - Description: Mongoose schema for Group with fields: name, folder (unique), channelId (ref Channel), externalId, trigger, requiresTrigger, isMain, modelConfig subdocument, executionConfig subdocument. Apply `addDefaultPlugins`.
  - Files: `backend/src/models/group.ts`, `backend/src/models/index.ts`
  - Depends on: 1.1, 1.2
  - Acceptance: Model compiles, channelId ref resolves.

- [ ] **Task 1.4**: Create Message model
  - Description: Mongoose schema for Message with fields: groupId (ref Group, indexed), channelId (ref Channel), externalId, sender, senderExternalId, content, isFromBot, processedAt, metadata (Mixed). Compound indexes on (groupId, created) and (groupId, processedAt). Apply `addDefaultPlugins`.
  - Files: `backend/src/models/message.ts`, `backend/src/models/index.ts`
  - Depends on: 1.1, 1.3
  - Acceptance: Model compiles, indexes created.

- [ ] **Task 1.5**: Create ScheduledTask model
  - Description: Mongoose schema with fields: groupId (ref Group), name, prompt, scheduleType (enum: cron/interval/once), schedule, status (enum: active/paused/completed/cancelled), classification (enum: public/internal/sensitive/critical), contextMode (enum: group/isolated), nextRunAt, lastRunAt, runCount, maxRuns. Index on (status, nextRunAt). Apply `addDefaultPlugins`.
  - Files: `backend/src/models/scheduledTask.ts`, `backend/src/models/index.ts`
  - Depends on: 1.1, 1.3
  - Acceptance: Model compiles, index created.

- [ ] **Task 1.6**: Create TaskRunLog model
  - Description: Mongoose schema with fields: taskId (ref ScheduledTask), groupId (ref Group), trigger (enum), classification (enum), modelBackend (enum: claude/ollama/codex), modelName, status (enum: running/completed/failed/timeout), prompt, result, error, durationMs, startedAt, completedAt. Index on (groupId, startedAt desc). Apply `addDefaultPlugins`.
  - Files: `backend/src/models/taskRunLog.ts`, `backend/src/models/index.ts`
  - Depends on: 1.1, 1.5
  - Acceptance: Model compiles, index created.

- [ ] **Task 1.7**: Create AgentSession model
  - Description: Mongoose schema with fields: groupId (ref Group), sessionId (unique), transcriptPath, status (enum: active/closed/archived), messageCount, lastActivityAt, resumeSessionAt. Apply `addDefaultPlugins`.
  - Files: `backend/src/models/agentSession.ts`, `backend/src/models/index.ts`
  - Depends on: 1.1, 1.3
  - Acceptance: Model compiles.

- [ ] **Task 1.8**: Create RemoteAgent model
  - Description: Mongoose schema with fields: name (unique), capabilities (String array), status (enum: online/offline/busy), lastHeartbeatAt, connectionInfo subdocument (host, port, platform), authToken. Apply `addDefaultPlugins`.
  - Files: `backend/src/models/remoteAgent.ts`, `backend/src/models/index.ts`
  - Depends on: 1.1
  - Acceptance: Model compiles.

- [ ] **Task 1.9**: Create CommandClassification model
  - Description: Mongoose schema with fields: pattern, classification (enum: public/internal/sensitive/critical), routeTo (enum: claude/ollama/codex), description, priority. Apply `addDefaultPlugins`.
  - Files: `backend/src/models/commandClassification.ts`, `backend/src/models/index.ts`
  - Depends on: 1.1
  - Acceptance: Model compiles.

- [ ] **Task 1.10**: Create Plugin model
  - Description: Mongoose schema with fields: name (unique), path, enabled, hooks (String array), config (Mixed), version. Apply `addDefaultPlugins`.
  - Files: `backend/src/models/plugin.ts`, `backend/src/models/index.ts`
  - Depends on: 1.1
  - Acceptance: Model compiles.

- [ ] **Task 1.11**: Create WebhookSource model
  - Description: Mongoose schema with fields: name, type (enum: webhook/websocket), groupId (ref Group), endpoint, secret, classification (enum), enabled, lastReceivedAt, config (Mixed). Apply `addDefaultPlugins`.
  - Files: `backend/src/models/webhookSource.ts`, `backend/src/models/index.ts`
  - Depends on: 1.1, 1.3
  - Acceptance: Model compiles.

- [ ] **Task 1.12**: Create all CRUD API routes
  - Description: Create route files for all 10 models using `modelRouter` from `@terreno/api`. Each route file exports an `add<Model>Routes(router, options)` function. Register all routes in `server.ts`. Routes use lowerCamelCase paths. Permissions per the API spec (most: list/read IsAuthenticated, CUD IsAdmin; scheduledTasks: CU IsAuthenticated).
  - Files: `backend/src/api/channels.ts`, `backend/src/api/groups.ts`, `backend/src/api/messages.ts`, `backend/src/api/scheduledTasks.ts`, `backend/src/api/taskRunLogs.ts`, `backend/src/api/agentSessions.ts`, `backend/src/api/remoteAgents.ts`, `backend/src/api/commandClassifications.ts`, `backend/src/api/plugins.ts`, `backend/src/api/webhookSources.ts`, `backend/src/server.ts`
  - Depends on: 1.2-1.11
  - Acceptance: All endpoints respond to CRUD requests. `GET /openapi.json` includes all new routes.

- [ ] **Task 1.13**: Create config module
  - Description: Create `src/config.ts` with environment-based settings: assistant name, poll intervals (message: 2s, task: 60s, IPC: 1s), concurrency limits, path constants (groups dir, sessions dir, IPC dir, data dir), trigger pattern default.
  - Files: `backend/src/config.ts`
  - Depends on: none
  - Acceptance: Config exports typed constants. Env vars override defaults.

- [ ] **Task 1.14**: Create directory structure initialization
  - Description: On server start, create required directories if they don't exist: `data/groups/`, `data/sessions/`, `data/ipc/`, `data/plugins/`. Add initialization call to `server.ts` start function.
  - Files: `backend/src/utils/directories.ts`, `backend/src/server.ts`
  - Depends on: 1.13
  - Acceptance: Directories created on first boot. Idempotent on subsequent boots.

- [ ] **Task 1.15**: Set up Pino logger
  - Description: Configure Pino logger with structured output, log levels, and pino-pretty for dev. Replace or wrap the existing `@terreno/api` logger if needed.
  - Files: `backend/src/utils/logger.ts`
  - Depends on: none
  - Acceptance: Logger outputs structured JSON in production, pretty-printed in dev.

---

## Phase 2: Bot Loop & Slack

- [ ] **Task 2.1**: Install Slack dependencies
  - Description: Add `@slack/bolt` and `@slack/web-api` to backend dependencies via `bun add`.
  - Files: `backend/package.json`
  - Depends on: none
  - Acceptance: Packages installed, imports resolve.

- [ ] **Task 2.2**: Implement Slack channel connector
  - Description: Create Slack channel implementation conforming to the Channel interface. Use `@slack/bolt` with Socket Mode. Handle `app_mention` and `message` events. Store messages to MongoDB via Message model. Send responses. Manage connection status (update Channel document). Handle reconnection (Bolt handles natively). Typing indicators if supported.
  - Files: `backend/src/orchestrator/channels/slack.ts`, `backend/src/orchestrator/channels/index.ts`
  - Depends on: 1.2, 1.4, 2.1
  - Acceptance: Bot connects to Slack workspace, receives messages, stores them in MongoDB, can send responses.

- [ ] **Task 2.3**: Implement webhook channel connector
  - Description: Create webhook channel implementation. Registers Express routes for inbound webhooks. Validates webhook signatures. Stores messages to MongoDB. Sends responses via configured callback URL or stores for polling.
  - Files: `backend/src/orchestrator/channels/webhook.ts`
  - Depends on: 1.2, 1.4, 1.11
  - Acceptance: POST to `/webhooks/:sourceId` stores a message. Invalid signatures rejected.

- [ ] **Task 2.4**: Implement Channel interface and channel manager
  - Description: Define the TypeScript Channel interface. Create a channel manager that initializes channels from Channel documents in MongoDB, tracks connection state, and provides send/receive abstractions.
  - Files: `backend/src/orchestrator/channels/types.ts`, `backend/src/orchestrator/channels/manager.ts`
  - Depends on: 2.2, 2.3
  - Acceptance: Channel manager can initialize multiple channels, route messages to the correct channel for sending.

- [ ] **Task 2.5**: Implement message router
  - Description: Create message formatting and routing logic. XML message formatting for agent input. Trigger pattern matching (regex, case-insensitive). Conversation catch-up (collect messages since last agent interaction). Outbound formatting: strip `<internal>` tags, add assistant name prefix.
  - Files: `backend/src/orchestrator/router.ts`
  - Depends on: 1.4, 1.13
  - Acceptance: Messages formatted correctly as XML. Trigger pattern matches. Internal tags stripped from output.

- [ ] **Task 2.6**: Implement group queue
  - Description: Per-group concurrency control. Only one agent per group at a time (configurable via `executionConfig.maxConcurrent`). Global concurrency limit from config. Pending messages queued. Tasks prioritized over messages. Retry with exponential backoff (5s base, max 5 retries). Message piping to active agents via IPC.
  - Files: `backend/src/orchestrator/groupQueue.ts`
  - Depends on: 1.3, 1.13
  - Acceptance: Only one agent runs per group. Pending messages queued and delivered. Retry works on failure.

- [ ] **Task 2.7**: Implement message polling loop
  - Description: Poll MongoDB for new unprocessed messages every 2s (configurable). Check registered groups. Apply trigger logic. Enqueue triggered messages to group queue. Update message `processedAt` after enqueuing.
  - Files: `backend/src/orchestrator/messageLoop.ts`
  - Depends on: 1.3, 1.4, 2.5, 2.6
  - Acceptance: New messages detected within poll interval. Only triggered messages enqueued. Non-triggered messages accumulated as context.

- [ ] **Task 2.8**: Integrate orchestrator into server startup
  - Description: Initialize the orchestrator (channel manager, message loop, group queue) on server start. Only start if channels are configured in the database. Graceful shutdown on SIGTERM/SIGINT.
  - Files: `backend/src/orchestrator/index.ts`, `backend/src/server.ts`
  - Depends on: 2.4, 2.6, 2.7
  - Acceptance: Orchestrator starts with the server. Shuts down cleanly.

---

## Phase 3: Agent Execution

- [ ] **Task 3.1**: Install Claude Code SDK
  - Description: Add `@anthropic-ai/claude-code` to backend dependencies.
  - Files: `backend/package.json`
  - Depends on: none
  - Acceptance: Package installed, imports resolve.

- [ ] **Task 3.2**: Implement direct agent runner
  - Description: Spawn agent processes via `Bun.spawn`. Pass config via stdin as JSON. Parse output via stdout markers (`---SHADE_OUTPUT_START---` / `---SHADE_OUTPUT_END---`). Manage timeouts (idle + hard). Set `cwd` to group folder. Pass secrets via env. Clean up on completion/timeout.
  - Files: `backend/src/orchestrator/runners/direct.ts`, `backend/src/orchestrator/runners/types.ts`
  - Depends on: 1.3, 1.13
  - Acceptance: Agent process spawns, receives config, outputs parsed correctly. Timeouts work.

- [ ] **Task 3.3**: Implement agent runner entry point
  - Description: The subprocess that runs inside the agent process. Reads config from stdin. Runs Claude Code SDK query with `bypassPermissions`. Uses `AsyncIterable<SDKUserMessage>` prompt for agent teams support. Streams results via stdout markers. Polls IPC input directory for follow-up messages. Exits on `_close` sentinel.
  - Files: `backend/src/agentRunner/index.ts`, `backend/src/agentRunner/package.json`
  - Depends on: 3.1
  - Acceptance: Agent runner reads config, executes SDK query, outputs results. Responds to follow-up messages.

- [ ] **Task 3.4**: Implement MCP stdio server
  - Description: Stdio-based MCP server that runs alongside the agent. Provides tools: `send_message`, `schedule_task`, `list_tasks`, `get_task`, `update_task`, `pause_task`, `resume_task`, `cancel_task`. Writes IPC files (atomic: write .tmp, rename to .json). Context passed via environment variables (`SHADE_GROUP_ID`, `SHADE_CHANNEL_ID`, etc.).
  - Files: `backend/src/agentRunner/mcpServer.ts`
  - Depends on: 3.3
  - Acceptance: MCP tools callable from agent. IPC files written correctly.

- [ ] **Task 3.5**: Implement IPC watcher
  - Description: Poll IPC directories every 1s (configurable). Process message files (route to channel). Process task files (CRUD operations on ScheduledTask). Authorization checks: main group can do anything, non-main restricted to own group. Clean up processed files.
  - Files: `backend/src/orchestrator/ipc.ts`
  - Depends on: 1.5, 2.4
  - Acceptance: IPC files processed within poll interval. Authorization enforced. Files cleaned up.

- [ ] **Task 3.6**: Implement agent session management
  - Description: Create/resume agent sessions. Store session ID in AgentSession MongoDB document. JSONL transcripts written to `data/sessions/{groupId}/`. Pass `resume` and `resumeSessionAt` to SDK. Update session metadata (messageCount, lastActivityAt) after each interaction.
  - Files: `backend/src/orchestrator/sessions.ts`
  - Depends on: 1.7, 3.3
  - Acceptance: Sessions created and resumed correctly. JSONL files written. Metadata updated.

- [ ] **Task 3.7**: Implement memory system
  - Description: CLAUDE.md hierarchy: global memory at `data/groups/CLAUDE.md`, per-group memory at `data/groups/{folder}/CLAUDE.md`. Agent runs with `cwd` set to group folder so SDK auto-loads both. Main group can write global memory. Non-main groups write only their own.
  - Files: `backend/src/orchestrator/memory.ts`
  - Depends on: 1.3, 1.14
  - Acceptance: Agent sees both global and group CLAUDE.md. Write permissions enforced.

- [ ] **Task 3.8**: Implement credential handling
  - Description: Pass secrets to agent via SDK's `env` option. Implement `PreToolUse` hook that strips secret env vars (`ANTHROPIC_API_KEY`, `CLAUDE_CODE_OAUTH_TOKEN`, etc.) from Bash commands via `unset` prefix. Store channel secrets encrypted or in env vars, never in agent-accessible files.
  - Files: `backend/src/orchestrator/security.ts`
  - Depends on: 3.2
  - Acceptance: Secrets available to SDK but not leakable via Bash. Sanitization hook strips vars.

- [ ] **Task 3.9**: Wire agent execution into group queue
  - Description: Connect the group queue to the agent runner. When a message is dequeued, format it via the router, spawn an agent via the runner, parse the result, send the response via the channel manager. Handle errors and retries.
  - Files: `backend/src/orchestrator/groupQueue.ts` (modify), `backend/src/orchestrator/index.ts` (modify)
  - Depends on: 2.6, 3.2, 2.5, 2.4
  - Acceptance: End-to-end: Slack message → agent → Slack response.

---

## Phase 4: Scheduling & Classification

- [ ] **Task 4.1**: Implement task scheduler
  - Description: Poll MongoDB for due tasks (status: active, nextRunAt <= now) every 60s. Calculate next run based on schedule type (cron via a cron parser lib, interval via addition, once marks completed). Run tasks as full agents in their group's context. Log runs to TaskRunLog. Update task metadata (lastRunAt, runCount, nextRunAt).
  - Files: `backend/src/orchestrator/taskScheduler.ts`
  - Depends on: 1.5, 1.6, 3.2
  - Acceptance: Due tasks execute on schedule. Run logs created. Next run calculated correctly.

- [ ] **Task 4.2**: Install cron parser dependency
  - Description: Add a cron parsing library (e.g., `cron-parser`) to parse cron expressions and calculate next run times.
  - Files: `backend/package.json`
  - Depends on: none
  - Acceptance: Cron expressions parsed correctly.

- [ ] **Task 4.3**: Implement command classifier
  - Description: Classify incoming messages/tasks by matching against CommandClassification rules (sorted by priority desc). Default classification is 'internal' if no rules match. Allow explicit overrides via message prefix (`!sensitive`, `!coding`, `!public`, `!critical`). Return classification + optional model routing override.
  - Files: `backend/src/orchestrator/classifier.ts`
  - Depends on: 1.9
  - Acceptance: Messages classified correctly. Explicit overrides work. Default fallback works.

- [ ] **Task 4.4**: Implement task-type model router
  - Description: Given a classification and optional `routeTo` override, determine which model backend to use. Default routing: `public` → cheapest (ollama), `internal` → claude, `sensitive` → ollama (local), `critical` → ollama (local, air-gapped). Respect group's `modelConfig.defaultBackend` as base. Respect `CommandClassification.routeTo` as override.
  - Files: `backend/src/orchestrator/modelRouter.ts`
  - Depends on: 4.3, 1.3
  - Acceptance: Correct model selected per classification. Overrides respected. Fallback chain works.

- [ ] **Task 4.5**: Integrate classifier and scheduler into orchestrator
  - Description: Wire the classifier into the message processing pipeline (classify before spawning agent). Wire the task scheduler into the orchestrator startup/shutdown. Classification determines model backend passed to agent runner.
  - Files: `backend/src/orchestrator/index.ts` (modify), `backend/src/orchestrator/groupQueue.ts` (modify)
  - Depends on: 4.1, 4.3, 4.4
  - Acceptance: Messages classified before agent execution. Model backend selected per classification. Scheduler runs alongside message loop.

---

## Phase 5: Multi-Model

- [ ] **Task 5.1**: Define model backend interface
  - Description: Create a common interface for model backends: `query(prompt, options) → AsyncIterable<string>`, `isAvailable() → boolean`, `name: string`, `supportsTools: boolean`. Options include model name, temperature, max tokens, tools.
  - Files: `backend/src/orchestrator/models/types.ts`
  - Depends on: none
  - Acceptance: Interface defined, documented.

- [ ] **Task 5.2**: Implement Claude backend
  - Description: Wrap Claude Code SDK as a model backend. Pass through to existing agent runner. Supports full tool use, session resume, agent teams.
  - Files: `backend/src/orchestrator/models/claude.ts`
  - Depends on: 5.1, 3.2
  - Acceptance: Claude backend implements interface. Existing agent execution works through it.

- [ ] **Task 5.3**: Implement Ollama backend
  - Description: HTTP client for Ollama API (`/api/chat`). Streaming response parsing. Support local (`localhost:11434`) and remote endpoints. Tool use simulation for non-tool models (parse tool calls from response text). Configurable model name.
  - Files: `backend/src/orchestrator/models/ollama.ts`
  - Depends on: 5.1
  - Acceptance: Queries Ollama, streams responses. Works with local and remote Ollama instances.

- [ ] **Task 5.4**: Implement Codex/OpenAI backend
  - Description: OpenAI API client with tool execution loop. Streaming support. Tool definitions translated from MCP format. Manual tool call → result → continue loop.
  - Files: `backend/src/orchestrator/models/codex.ts`
  - Depends on: 5.1
  - Acceptance: Queries OpenAI API. Tool execution loop works. Streaming works.

- [ ] **Task 5.5**: Implement model manager
  - Description: Registry of available model backends. Initializes backends based on available API keys/endpoints. Provides `getBackend(name)` and `isAvailable(name)` methods. Handles fallback: if primary unavailable, try fallback from group config.
  - Files: `backend/src/orchestrator/models/manager.ts`, `backend/src/orchestrator/models/index.ts`
  - Depends on: 5.2, 5.3, 5.4
  - Acceptance: Model manager returns correct backend. Fallback works when primary unavailable.

- [ ] **Task 5.6**: Integrate model manager into agent execution
  - Description: Agent runner uses model manager to get the correct backend based on classification routing. Pass model config to agent runner. Non-Claude backends use a simplified execution path (no Claude Code SDK, just prompt → response with optional tool loop).
  - Files: `backend/src/orchestrator/runners/direct.ts` (modify), `backend/src/orchestrator/groupQueue.ts` (modify)
  - Depends on: 5.5, 4.4
  - Acceptance: Different tasks route to different backends. Ollama tasks don't use Claude SDK. Claude tasks use full SDK.

---

## Phase 6: Reactive Inputs & Remote Agents

- [ ] **Task 6.1**: Implement webhook receiver
  - Description: Express route at `/webhooks/:sourceId`. Look up WebhookSource by ID. Validate signature if secret configured. Parse payload. Store as Message linked to the source's group. Trigger message processing pipeline.
  - Files: `backend/src/api/webhooks.ts`, `backend/src/server.ts`
  - Depends on: 1.11, 2.7
  - Acceptance: Webhooks received, validated, stored, and trigger agent processing.

- [ ] **Task 6.2**: Implement WebSocket client manager
  - Description: Connect to external WebSocket sources defined in WebhookSource (type: websocket). Auto-reconnect with exponential backoff. Parse incoming messages. Store as Message linked to the source's group. Trigger processing pipeline. Track connection state (update lastReceivedAt).
  - Files: `backend/src/orchestrator/websocketClient.ts`
  - Depends on: 1.11, 2.7
  - Acceptance: Connects to configured WebSocket endpoints. Reconnects on disconnect. Messages stored and processed.

- [ ] **Task 6.3**: Implement remote agent WebSocket server
  - Description: WebSocket endpoint at `/ws/remoteAgent`. Token-based authentication (validate against RemoteAgent.authToken). Handle connection lifecycle: register, heartbeat, task dispatch, result collection. Update RemoteAgent status (online/offline/busy) and lastHeartbeatAt.
  - Files: `backend/src/orchestrator/remoteAgentServer.ts`, `backend/src/server.ts`
  - Depends on: 1.8
  - Acceptance: Remote agents connect via WebSocket. Auth validated. Heartbeats tracked. Status updated.

- [ ] **Task 6.4**: Implement remote agent task dispatch
  - Description: When a task is routed to a remote agent (based on required capabilities), dispatch via WebSocket. Wait for result. Handle timeouts. Log to TaskRunLog. If remote agent offline, queue task or fall back to local execution.
  - Files: `backend/src/orchestrator/remoteAgentDispatch.ts`
  - Depends on: 6.3, 2.6
  - Acceptance: Tasks dispatched to capable remote agents. Results collected. Timeouts handled. Offline fallback works.

- [ ] **Task 6.5**: Implement remote agent runner (standalone)
  - Description: Standalone Bun process that runs on remote machines. Connects to central server via WebSocket. Receives tasks, executes them locally, sends results back. Heartbeat loop. Configurable capabilities. Can be compiled to single executable.
  - Files: `backend/src/remoteAgent/index.ts`, `backend/src/remoteAgent/package.json`
  - Depends on: 6.3
  - Acceptance: Remote agent connects, receives tasks, executes, reports results. Reconnects on disconnect.

- [ ] **Task 6.6**: Integrate reactive inputs into orchestrator
  - Description: Initialize WebSocket client manager and remote agent server on startup. Load WebhookSource configs from MongoDB. Start/stop connections based on enabled state. Graceful shutdown.
  - Files: `backend/src/orchestrator/index.ts` (modify)
  - Depends on: 6.1, 6.2, 6.3
  - Acceptance: All reactive input sources start with the orchestrator.

---

## Phase 7: Plugins & Self-Building

- [ ] **Task 7.1**: Implement plugin loader
  - Description: Discover and load TS/JS modules from `data/plugins/` directory. Each plugin exports a default function that receives a plugin API object. Load enabled plugins from Plugin model. Validate plugin structure (must export default function).
  - Files: `backend/src/orchestrator/plugins/loader.ts`
  - Depends on: 1.10
  - Acceptance: Plugins discovered, loaded, and initialized. Invalid plugins rejected with error log.

- [ ] **Task 7.2**: Implement plugin API and hook system
  - Description: Define the plugin API surface: hooks (onMessage, onTaskComplete, onWebhook, onSchedule, onAgentStart, onAgentEnd), context (send message, schedule task, read config), and lifecycle (onEnable, onDisable). Event emitter pattern for hook dispatch.
  - Files: `backend/src/orchestrator/plugins/api.ts`, `backend/src/orchestrator/plugins/types.ts`
  - Depends on: 7.1
  - Acceptance: Plugins receive hook calls. Plugin API methods work. Lifecycle hooks fire.

- [ ] **Task 7.3**: Implement plugin lifecycle management
  - Description: Enable/disable plugins at runtime (update Plugin model, load/unload module). Config updates without restart. Hot reload on file change (watch `data/plugins/` directory).
  - Files: `backend/src/orchestrator/plugins/manager.ts`, `backend/src/orchestrator/plugins/index.ts`
  - Depends on: 7.1, 7.2
  - Acceptance: Plugins enable/disable without server restart. Config changes applied. File changes trigger reload.

- [ ] **Task 7.4**: Implement skills system
  - Description: Support `.claude/skills/` directory for skill definitions. Skills are SKILL.md files that teach the agent how to modify the codebase. Agent can create new skills via file writes. Skill detection: list available skills, detect project type.
  - Files: `backend/.claude/skills/` (directory), `backend/src/orchestrator/skills.ts`
  - Depends on: 3.3
  - Acceptance: Skills directory exists. Agent can read/write skill files. Skills listed in agent context.

- [ ] **Task 7.5**: Enable self-modification
  - Description: Configure the main group's agent with write access to the project source code. Agent can create new models, routes, plugins, and skills. Mount the project root as a writable directory for the main agent. Non-main agents cannot self-modify.
  - Files: `backend/src/orchestrator/runners/direct.ts` (modify), `backend/src/orchestrator/memory.ts` (modify)
  - Depends on: 7.4, 3.7
  - Acceptance: Main agent can create files in the project. Non-main agents restricted.

- [ ] **Task 7.6**: Integrate plugins into orchestrator
  - Description: Wire plugin hook dispatch into the message processing pipeline, task scheduler, and agent lifecycle. Plugins receive events at appropriate points. Plugin manager starts/stops with orchestrator.
  - Files: `backend/src/orchestrator/index.ts` (modify)
  - Depends on: 7.3
  - Acceptance: Plugins receive hook calls during normal operation.

---

## Phase 8: Frontend Dashboard

- [ ] **Task 8.1**: Regenerate frontend SDK
  - Description: Run `bun run sdk` to regenerate `openApiSdk.ts` with all new model endpoints. Verify all CRUD hooks are generated (useGetChannels, useGetChannelsById, usePostChannels, etc. for all 10 models).
  - Files: `frontend/store/openApiSdk.ts`
  - Depends on: 1.12
  - Acceptance: SDK includes hooks for all 10 new models. No TypeScript errors.

- [ ] **Task 8.2**: Create shared dashboard components
  - Description: Build reusable components: `StatusBadge` (colored status indicator), `ActivityFeed` (scrolling event list), `FilterBar` (horizontal filter chips), `DetailRow` (label/value pair), `CodeBlock` (read-only code display). All use `@terreno/ui` primitives.
  - Files: `frontend/components/StatusBadge.tsx`, `frontend/components/ActivityFeed.tsx`, `frontend/components/FilterBar.tsx`, `frontend/components/DetailRow.tsx`, `frontend/components/CodeBlock.tsx`
  - Depends on: none
  - Acceptance: Components render correctly. Props typed.

- [ ] **Task 8.3**: Implement Dashboard home screen
  - Description: Replace placeholder home screen. Show system status: active agents count, connected channels count, queue depths. Activity feed showing recent TaskRunLogs. Connect to `/ws/dashboard` WebSocket for real-time updates.
  - Files: `frontend/app/(tabs)/index.tsx` (replace)
  - Depends on: 8.1, 8.2
  - Acceptance: Dashboard shows live system status. Activity feed updates in real-time.

- [ ] **Task 8.4**: Implement Channels list and detail screens
  - Description: Channels tab showing list of channels with StatusBadge for connection state. Tap to navigate to detail screen showing config, associated groups, message volume.
  - Files: `frontend/app/(tabs)/channels.tsx`, `frontend/app/channels/[id].tsx`
  - Depends on: 8.1, 8.2
  - Acceptance: Channels listed with status. Detail screen shows config and groups.

- [ ] **Task 8.5**: Implement Groups list and detail screens
  - Description: Groups tab showing list of groups with active agent indicator and last activity time. Detail screen shows group config, model config, recent messages, CLAUDE.md content in CodeBlock, active session info.
  - Files: `frontend/app/(tabs)/groups.tsx`, `frontend/app/groups/[id].tsx`
  - Depends on: 8.1, 8.2
  - Acceptance: Groups listed with indicators. Detail screen shows all group info including memory.

- [ ] **Task 8.6**: Implement Tasks list and detail screens
  - Description: Tasks tab showing scheduled tasks with FilterBar for status (active/paused/completed/cancelled). Detail screen shows task config, schedule info, run history from TaskRunLog.
  - Files: `frontend/app/(tabs)/tasks.tsx`, `frontend/app/tasks/[id].tsx`
  - Depends on: 8.1, 8.2
  - Acceptance: Tasks listed with filters. Detail screen shows run history.

- [ ] **Task 8.7**: Implement Agents screen
  - Description: Combined view of local active agents (from orchestrator status API) and remote agents (from RemoteAgent model). Show status, capabilities, last heartbeat for remote agents.
  - Files: `frontend/app/(tabs)/agents.tsx`
  - Depends on: 8.1, 8.2
  - Acceptance: Both local and remote agents displayed with status.

- [ ] **Task 8.8**: Implement Logs screen
  - Description: Filterable list of TaskRunLogs. FilterBar with filters for group, trigger type, model backend, status, and date range. Sortable by startedAt.
  - Files: `frontend/app/(tabs)/logs.tsx`
  - Depends on: 8.1, 8.2
  - Acceptance: Logs displayed with all filters working. Pagination if needed.

- [ ] **Task 8.9**: Update tab navigation
  - Description: Update tab layout to include all new tabs: Dashboard, Channels, Groups, Tasks, Agents, Logs, Profile. Assign appropriate FontAwesome icons.
  - Files: `frontend/app/(tabs)/_layout.tsx`
  - Depends on: 8.3-8.8
  - Acceptance: All tabs visible and navigable.

- [ ] **Task 8.10**: Implement dashboard WebSocket connection
  - Description: Create a WebSocket hook/provider that connects to `/ws/dashboard`. Receives real-time events (agent started/stopped, message received, task completed, channel status change). Distributes events to relevant screens via React context or Redux.
  - Files: `frontend/store/dashboardSocket.ts`, `frontend/app/_layout.tsx` (modify)
  - Depends on: 8.1
  - Acceptance: WebSocket connects on app load. Events received and distributed. Reconnects on disconnect.

- [ ] **Task 8.11**: Implement custom orchestrator API endpoints
  - Description: Add custom endpoints to backend: `GET /orchestrator/status`, `GET /orchestrator/groups/:id/queue`, `POST /orchestrator/groups/:id/trigger`, `POST /orchestrator/groups/:id/stop`, `GET /orchestrator/groups/:id/memory`. Add corresponding SDK extensions in `store/sdk.ts`.
  - Files: `backend/src/api/orchestrator.ts`, `backend/src/server.ts`, `frontend/store/sdk.ts`
  - Depends on: 2.8
  - Acceptance: All custom endpoints respond correctly. Frontend SDK hooks available.

- [ ] **Task 8.12**: Implement dashboard WebSocket server endpoint
  - Description: WebSocket endpoint at `/ws/dashboard` on the backend. Broadcasts orchestrator events to connected dashboard clients. Auth required (validate session token). Events: agentStarted, agentStopped, messageReceived, taskCompleted, channelStatusChanged.
  - Files: `backend/src/api/dashboardSocket.ts`, `backend/src/server.ts`
  - Depends on: 2.8
  - Acceptance: Dashboard clients receive real-time events. Auth enforced.
