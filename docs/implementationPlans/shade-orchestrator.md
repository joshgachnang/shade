# Implementation Plan: Shade Orchestrator

*When an engineer is assigned to a project but before you begin coding, you should fill in the implementation plan and get feedback from the engineering team. Once you have finished or you make any changes, tag Josh with the @ symbol so he can review. Also tag anyone else that needs to be notified, has conflicting work, etc.*

## Models

10 new Mongoose models. All use `addDefaultPlugins(schema)` for created/updated/deleted fields, `strict: 'throw'`, and `toJSON/toObject: { virtuals: true }`.

### 1. Channel

Represents a connected messaging platform (Slack, webhook, etc.)

```typescript
const channelSchema = new mongoose.Schema<ChannelDocument, ChannelModel>({
  name: { type: String, required: true, trim: true },
  type: { type: String, required: true, enum: ['slack', 'webhook'] },
  status: { type: String, default: 'disconnected', enum: ['connected', 'disconnected', 'error'] },
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
  // Slack: { botToken, appToken, signingSecret }
  // Webhook: { secret, allowedIPs }
  lastConnectedAt: { type: Date },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });
```

### 2. Group

A registered channel/conversation the bot responds to.

```typescript
const groupSchema = new mongoose.Schema<GroupDocument, GroupModel>({
  name: { type: String, required: true, trim: true },
  folder: { type: String, required: true, unique: true },
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
  externalId: { type: String, required: true }, // Slack channel ID, webhook source ID
  trigger: { type: String, default: '@Shade' },
  requiresTrigger: { type: Boolean, default: true },
  isMain: { type: Boolean, default: false },
  modelConfig: {
    defaultBackend: { type: String, enum: ['claude', 'ollama', 'codex'], default: 'claude' },
    defaultModel: { type: String },
    endpoint: { type: String },
    fallbackBackend: { type: String, enum: ['claude', 'ollama', 'codex'] },
  },
  executionConfig: {
    mode: { type: String, enum: ['direct', 'container'], default: 'direct' },
    timeout: { type: Number, default: 300000 },
    idleTimeout: { type: Number, default: 60000 },
    maxConcurrent: { type: Number, default: 1 },
  },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });
```

### 3. Message

Stored messages from registered groups.

```typescript
const messageSchema = new mongoose.Schema<MessageDocument, MessageModel>({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true, index: true },
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Channel', required: true },
  externalId: { type: String },
  sender: { type: String, required: true },
  senderExternalId: { type: String },
  content: { type: String, required: true },
  isFromBot: { type: Boolean, default: false },
  processedAt: { type: Date },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });

messageSchema.index({ groupId: 1, created: 1 });
messageSchema.index({ groupId: 1, processedAt: 1 });
```

### 4. ScheduledTask

Recurring or one-time tasks.

```typescript
const scheduledTaskSchema = new mongoose.Schema<ScheduledTaskDocument, ScheduledTaskModel>({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  name: { type: String, required: true, trim: true },
  prompt: { type: String, required: true },
  scheduleType: { type: String, required: true, enum: ['cron', 'interval', 'once'] },
  schedule: { type: String, required: true },
  status: { type: String, default: 'active', enum: ['active', 'paused', 'completed', 'cancelled'] },
  classification: { type: String, default: 'internal', enum: ['public', 'internal', 'sensitive', 'critical'] },
  contextMode: { type: String, default: 'isolated', enum: ['group', 'isolated'] },
  nextRunAt: { type: Date },
  lastRunAt: { type: Date },
  runCount: { type: Number, default: 0 },
  maxRuns: { type: Number },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });

scheduledTaskSchema.index({ status: 1, nextRunAt: 1 });
```

### 5. TaskRunLog

Execution history per task run.

```typescript
const taskRunLogSchema = new mongoose.Schema<TaskRunLogDocument, TaskRunLogModel>({
  taskId: { type: mongoose.Schema.Types.ObjectId, ref: 'ScheduledTask' },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  trigger: { type: String, required: true, enum: ['scheduled', 'message', 'webhook', 'websocket', 'manual'] },
  classification: { type: String, required: true, enum: ['public', 'internal', 'sensitive', 'critical'] },
  modelBackend: { type: String, required: true, enum: ['claude', 'ollama', 'codex'] },
  modelName: { type: String },
  status: { type: String, required: true, enum: ['running', 'completed', 'failed', 'timeout'] },
  prompt: { type: String },
  result: { type: String },
  error: { type: String },
  durationMs: { type: Number },
  startedAt: { type: Date, required: true },
  completedAt: { type: Date },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });

taskRunLogSchema.index({ groupId: 1, startedAt: -1 });
```

### 6. AgentSession

Metadata for agent sessions (transcripts stored as JSONL on disk).

```typescript
const agentSessionSchema = new mongoose.Schema<AgentSessionDocument, AgentSessionModel>({
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  sessionId: { type: String, required: true, unique: true },
  transcriptPath: { type: String, required: true },
  status: { type: String, default: 'active', enum: ['active', 'closed', 'archived'] },
  messageCount: { type: Number, default: 0 },
  lastActivityAt: { type: Date },
  resumeSessionAt: { type: String },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });
```

### 7. RemoteAgent

Remote agent hosts connected via WebSocket.

```typescript
const remoteAgentSchema = new mongoose.Schema<RemoteAgentDocument, RemoteAgentModel>({
  name: { type: String, required: true, trim: true, unique: true },
  capabilities: [{ type: String }],
  status: { type: String, default: 'offline', enum: ['online', 'offline', 'busy'] },
  lastHeartbeatAt: { type: Date },
  connectionInfo: {
    host: { type: String },
    port: { type: Number },
    platform: { type: String },
  },
  authToken: { type: String, required: true },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });
```

### 8. CommandClassification

Configurable rules for classifying commands.

```typescript
const commandClassificationSchema = new mongoose.Schema<CommandClassificationDocument, CommandClassificationModel>({
  pattern: { type: String, required: true },
  classification: { type: String, required: true, enum: ['public', 'internal', 'sensitive', 'critical'] },
  routeTo: { type: String, enum: ['claude', 'ollama', 'codex'] },
  description: { type: String },
  priority: { type: Number, default: 0 },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });
```

### 9. Plugin

Registered runtime plugins.

```typescript
const pluginSchema = new mongoose.Schema<PluginDocument, PluginModel>({
  name: { type: String, required: true, trim: true, unique: true },
  path: { type: String, required: true },
  enabled: { type: Boolean, default: true },
  hooks: [{ type: String }],
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
  version: { type: String },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });
```

### 10. WebhookSource

Registered webhook/WebSocket input sources.

```typescript
const webhookSourceSchema = new mongoose.Schema<WebhookSourceDocument, WebhookSourceModel>({
  name: { type: String, required: true, trim: true },
  type: { type: String, required: true, enum: ['webhook', 'websocket'] },
  groupId: { type: mongoose.Schema.Types.ObjectId, ref: 'Group', required: true },
  endpoint: { type: String },
  secret: { type: String },
  classification: { type: String, default: 'internal', enum: ['public', 'internal', 'sensitive', 'critical'] },
  enabled: { type: Boolean, default: true },
  lastReceivedAt: { type: Date },
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });
```

## APIs

### Standard CRUD (via modelRouter)

All routes use lowerCamelCase. All CRUD routes use `modelRouter` from `@terreno/api`. Frontend uses auto-generated SDK hooks via `bun run sdk` (e.g., `useGetChannels`, `useGetChannelsById`, `usePostChannels`, `usePatchChannelsById`, `useDeleteChannelsById`).

| Route | Model | Permissions | Query Fields | Sort |
|-------|-------|-------------|--------------|------|
| `/channels` | Channel | list/read: IsAuthenticated, CUD: IsAdmin | type, status | name |
| `/groups` | Group | list/read: IsAuthenticated, CUD: IsAdmin | channelId, isMain, name | name |
| `/messages` | Message | list/read: IsAuthenticated, CD: IsAdmin | groupId, isFromBot, processedAt | -created |
| `/scheduledTasks` | ScheduledTask | list/read: IsAuthenticated, CU: IsAuthenticated, D: IsAdmin | groupId, status, scheduleType, classification | -created |
| `/taskRunLogs` | TaskRunLog | list/read: IsAuthenticated, D: IsAdmin | groupId, taskId, trigger, status, modelBackend | -startedAt |
| `/agentSessions` | AgentSession | list/read: IsAuthenticated, D: IsAdmin | groupId, status | -lastActivityAt |
| `/remoteAgents` | RemoteAgent | list/read: IsAuthenticated, CUD: IsAdmin | status, capabilities | name |
| `/commandClassifications` | CommandClassification | list/read: IsAuthenticated, CUD: IsAdmin | classification | -priority |
| `/plugins` | Plugin | list/read: IsAuthenticated, CUD: IsAdmin | enabled | name |
| `/webhookSources` | WebhookSource | list/read: IsAuthenticated, CUD: IsAdmin | type, groupId, enabled, classification | name |

### Custom Endpoints

| Method | Path | Description | Permission |
|--------|------|-------------|------------|
| `GET` | `/orchestrator/status` | System status: active agents, connected channels, queue depths, uptime | IsAuthenticated |
| `GET` | `/orchestrator/groups/:id/queue` | Queue state for a group | IsAuthenticated |
| `POST` | `/orchestrator/groups/:id/trigger` | Manually trigger an agent run | IsAdmin |
| `POST` | `/orchestrator/groups/:id/stop` | Stop currently running agent | IsAdmin |
| `GET` | `/orchestrator/groups/:id/memory` | Read group's CLAUDE.md | IsAuthenticated |
| `POST` | `/webhooks/:sourceId` | Inbound webhook receiver | Public (secret validated) |
| `WS` | `/ws/remoteAgent` | Remote agent connection | Token auth |
| `WS` | `/ws/dashboard` | Real-time dashboard updates | IsAuthenticated |

## Notifications

No push notifications, emails, or in-app alerts for v1. Communication happens through:

- **Slack messages** — Bot responses sent back to the triggering channel
- **Dashboard WebSocket** — Real-time status updates to the frontend
- **Structured logs** — Pino logger for debugging and monitoring

## UI

Read-only monitoring dashboard. All screens use `@terreno/ui` components.

### Screens

| Screen | Tab | Description |
|--------|-----|-------------|
| Dashboard | Home | System status overview, active agents count, connected channels, activity feed |
| Channels | Channels | List with connection status indicators |
| Channel Detail | — | Config, associated groups, message volume |
| Groups | Groups | List with active agent indicators, last activity |
| Group Detail | — | Config, model config, recent messages, CLAUDE.md viewer, session info |
| Tasks | Tasks | Scheduled tasks with status filters |
| Task Detail | — | Config, schedule info, run history |
| Agents | Agents | Local active agents + remote agents with status |
| Logs | Logs | Filterable TaskRunLog list |

### Navigation

```
Tabs:
├── Dashboard (home)
├── Channels
├── Groups
├── Tasks
├── Agents
├── Logs
└── Profile (existing)
```

### New Components

- `StatusBadge` — colored badge for status fields
- `ActivityFeed` — real-time scrolling event list
- `FilterBar` — horizontal filter chips for list screens
- `DetailRow` — label/value pair for detail screens
- `CodeBlock` — read-only code/text display

## Phases

### Phase 1: Core Infrastructure
- All Mongoose models + type definitions
- All modelRouter CRUD endpoints
- Config system, logger, directory structure

### Phase 2: Bot Loop & Slack
- Slack channel connector (`@slack/bolt`, Socket Mode)
- Message storage pipeline
- Message router: trigger matching, catch-up, XML formatting
- Group queue: per-group concurrency, retry, message piping
- Message polling loop, outbound formatting

### Phase 3: Agent Execution
- Direct agent runner (Bun.spawn, stdin/stdout protocol)
- Claude Code SDK integration (query, session resume, AsyncIterable prompt)
- MCP stdio server (send_message, schedule_task, list/pause/resume/cancel)
- IPC watcher, agent session management, memory system, credential handling

### Phase 4: Scheduling & Classification
- Task scheduler: poll for due tasks, cron/interval/once, run logging
- Command classification: pattern matching, classification rules
- Task-type routing: classifier picks model backend
- Security enforcement per classification tier

### Phase 5: Multi-Model
- Ollama integration: HTTP client, streaming, tool simulation
- Codex/OpenAI integration: API client, tool loop
- Model abstraction layer, fallback chain
- Per-task model routing based on classification

### Phase 6: Reactive Inputs & Remote Agents
- Webhook receiver endpoint
- WebSocket client manager for external sources
- Remote agent WebSocket server
- Remote agent protocol: task dispatch, results, heartbeat

### Phase 7: Plugins & Self-Building
- Plugin loader and hook system
- Plugin lifecycle: enable/disable, config, hot reload
- Skills system: `.claude/skills/` directory
- Self-modification: agent creates skills/plugins for itself

### Phase 8: Frontend Dashboard
- Regenerate SDK
- All dashboard screens (Dashboard, Channels, Groups, Tasks, Agents, Logs)
- Dashboard WebSocket for real-time updates
- New UI components (StatusBadge, ActivityFeed, FilterBar, DetailRow, CodeBlock)

## Feature Flags & Migrations

**Feature flags:** None needed. Greenfield build.

**Data migrations:** None. All models are new. Existing User model unchanged.

**Rollout:** Each phase merges to master when complete. Bot features are inert until configured (no Slack token = no connection, no groups = no processing). Orchestrator loops start only when channels are configured.

## Activity Log & User Updates

No dedicated activity log model. Existing models serve this purpose:

- **TaskRunLog** — primary activity log for all agent executions
- **Message** — full message history per group
- **AgentSession** — session lifecycle tracking

Dashboard activity feed queries TaskRunLogs sorted by `startedAt` descending.

## Not Included / Future Work

- **URL/RSS feed polling** — periodic monitoring of web pages and RSS feeds
- **macOS app integrations** — iMessage, Mail, Calendar via remote Mac agent
- **Additional channels** — Discord, Telegram, WhatsApp (added via skills)
- **Container-based isolation** — Docker execution as opt-in per-group
- **Frontend chat interface** — web chat as another channel
- **Frontend admin controls** — start/stop agents, create tasks from UI
- **Agent teams/swarms** — multi-agent coordination
- **Cost tracking** — per-model, per-group usage and budgeting
- **Browser automation** — Chromium + agent-browser
- **Compiled executables** — `bun build --compile` for single-binary deployment
- **systemd/launchd service files** — production deployment config
