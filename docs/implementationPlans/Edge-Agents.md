# Implementation Plan: Edge Agents

**Status:** Open
**Priority:** High
**Effort:** Big batch (1-2 weeks)
**IP:** IP-005

Small, single-purpose agents compiled to standalone Bun executables and deployed to edge machines (Mac Mini, Linux servers). Each agent does one thing (e.g. iMessage bridge). Agents self-register with the central Shade server, require admin approval, then receive config/secrets and begin operating. Communication is REST-based: agents push data via heartbeat and POST, Shade sends commands back via heartbeat response.

## Design Notes

### EdgeAgent vs RemoteAgent

`EdgeAgent` replaces the existing `RemoteAgent` model. RemoteAgent was a placeholder for WebSocket-connected tool hosts in the orchestrator system. EdgeAgent is a concrete, deployed binary with a well-defined lifecycle:

- Self-registers on first boot (requires bootstrap secret)
- Requires admin approval before receiving config
- Phones home via heartbeat polling (no inbound connectivity required)
- Receives commands piggybacked on heartbeat responses
- Pushes data to Shade via REST

### Command Queue via Heartbeat

Instead of Shade calling the agent directly (requires network reachability), commands piggyback on heartbeat responses. This works behind NAT, firewalls, and Tailscale without requiring the agent to expose a port.

```
Agent heartbeat request  →  Shade returns pending commands
Agent executes commands   →  Reports results in next heartbeat
```

### Approval Flow

Agents register in `pending` status. An admin must approve them in the Shade UI before they receive config/secrets. This prevents unauthorized agents from joining the network.

`pending` → `approved` → `online` ↔ `offline` / `error`

### EdgeAgentChannelConnector (Orchestrator Bridge)

Edge agents don't run inside the backend process, so they can't be a normal `ChannelConnector`. Instead, an `EdgeAgentChannelConnector` is registered in the `ChannelManager` for each edge-agent-backed Channel. This connector:

- **Inbound**: The data push endpoint (`POST /api/edge/data`) calls `ChannelManager.handleInboundMessage()` directly, reusing existing Group lookup and Message creation logic. No duplication.
- **Outbound**: When the orchestrator calls `connector.sendMessage()`, the connector queues a `send_message` command on the EdgeAgent's `pendingCommands` array (delivered on next heartbeat).

This keeps message flow unified through the existing ChannelManager pipeline.

### Channel + Group Auto-Creation

When an edge agent requests a channel (`type: "channel_request"`), Shade creates both:
1. A `Channel` (type matching agentType, e.g. "imessage", status: "connected")
2. A default `Group` linked to that Channel, with a generated `externalId` and `folder`

The admin can then configure the Group (trigger pattern, model config, etc.) via the existing Groups UI. Without a Group, pushed messages have no home in the orchestrator.

### Agent Token Auth: SHA-256 (not bcrypt)

Agent tokens are validated via SHA-256 hash comparison, not bcrypt. bcrypt is intentionally slow (~100ms) and inappropriate for high-frequency heartbeats (every 30s per agent). The `authTokenHash` field stores `SHA-256(token)`. Registration still generates a cryptographically random token.

### Secrets Encryption

The `secrets` field is encrypted at rest using AES-256-GCM with a server-side key (`SHADE_SECRETS_KEY` env var). Secrets are decrypted only when served to the agent via `GET /api/edge/config`. This prevents plaintext secret exposure if the database is compromised.

### Atomic Command Delivery

Command delivery on heartbeat uses `findOneAndUpdate` with `$set: { pendingCommands: [] }` returning the old document. This is atomic — no race condition between concurrent heartbeats.

### Sent Message Deduplication

The iMessage reader filters `is_from_me = 0` (same as the existing connector), so messages sent by the agent via AppleScript are not re-ingested as inbound messages.

---

## Models

2 new Mongoose models. 1 existing model (`RemoteAgent`) is replaced. All use `addDefaultPlugins(schema)` for created/updated/deleted fields, `strict: 'throw'`, and `toJSON/toObject: { virtuals: true }`.

### 1. EdgeAgent

Represents a deployed agent binary running on an edge machine. Replaces `RemoteAgent`.

```typescript
const edgeAgentSchema = new mongoose.Schema<EdgeAgentDocument, EdgeAgentModel>({
  name: { type: String, required: true, trim: true, unique: true },
  agentType: { type: String, required: true }, // "imessage", "calendar", "contacts", "email"
  status: {
    type: String,
    default: "pending",
    enum: ["pending", "approved", "online", "offline", "error"],
  },
  platform: { type: String, enum: ["darwin", "linux", "windows"] },
  arch: { type: String }, // "arm64", "x64"
  version: { type: String }, // agent binary version
  hostname: { type: String }, // machine hostname
  lastHeartbeatAt: { type: Date },
  config: { type: mongoose.Schema.Types.Mixed, default: {} },
  secrets: { type: mongoose.Schema.Types.Mixed, default: {} },
  capabilities: [{ type: String }],
  authTokenHash: { type: String, required: true }, // SHA-256 hash of agent's bearer token
  channelId: { type: mongoose.Schema.Types.ObjectId, ref: "Channel" }, // linked Channel once created
  approvedAt: { type: Date },
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  pendingCommands: [{
    commandId: { type: String, required: true },
    type: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, default: {} },
    queuedAt: { type: Date, default: Date.now },
  }],
  lastCommandResults: [{
    commandId: { type: String, required: true },
    success: { type: Boolean, required: true },
    error: { type: String },
    completedAt: { type: Date },
  }],
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });

edgeAgentSchema.index({ status: 1 });
edgeAgentSchema.index({ agentType: 1 });
edgeAgentSchema.index({ lastHeartbeatAt: 1 });
```

### 2. EdgeAgentEvent

Structured event log for agent activity.

```typescript
const edgeAgentEventSchema = new mongoose.Schema<EdgeAgentEventDocument, EdgeAgentEventModel>({
  agentId: { type: mongoose.Schema.Types.ObjectId, ref: "EdgeAgent", required: true, index: true },
  eventType: {
    type: String,
    required: true,
    // "registered", "approved", "heartbeat", "config_pulled", "data_pushed",
    // "command_queued", "command_completed", "command_failed", "error", "status_changed"
  },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });

edgeAgentEventSchema.index({ agentId: 1, created: 1 });
```

## APIs

### Standard CRUD (via modelRouter)

| Route | Model | Permissions | Query Fields | Sort |
|-------|-------|-------------|--------------|------|
| `/edgeAgents` | EdgeAgent | list/read: IsAuthenticated, CUD: IsAdmin | status, agentType, platform | name |
| `/edgeAgentEvents` | EdgeAgentEvent | list/read: IsAuthenticated, D: IsAdmin | agentId, eventType | -created |

### Custom Edge Agent Endpoints

Registered as an Express plugin at `/api/edge`.

**Agent-facing (called by edge agents):**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/edge/register` | Bootstrap secret (`X-Bootstrap-Secret` header) | Self-register. Returns `{ agentId, token }`. Agent status = `pending`. |
| `POST` | `/api/edge/heartbeat` | Agent token (`Authorization: Bearer <token>`) | Heartbeat with status/metrics. Returns `{ status, commands }`. |
| `GET` | `/api/edge/config` | Agent token | Pull config + secrets. Returns 403 if not approved. |
| `POST` | `/api/edge/data` | Agent token | Push data (messages, events). Returns 403 if not approved. |

**Admin-facing (called by Shade UI/API):**

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| `POST` | `/api/edge/agents/:id/approve` | IsAdmin | Approve a pending agent. Sets status to `approved`. |
| `POST` | `/api/edge/agents/:id/revoke` | IsAdmin | Revoke an agent. Sets status to `pending`, clears secrets. |
| `POST` | `/api/edge/agents/:id/command` | IsAdmin | Queue a command for the agent. |

### Agent Auth

- **Registration**: Requires `SHADE_BOOTSTRAP_SECRET` in `X-Bootstrap-Secret` header. This is a shared secret known at deploy time.
- **Subsequent calls**: Agent uses bearer token returned from registration. Backend validates via SHA-256 hash comparison with stored `authTokenHash` (fast, unlike bcrypt).
- **Config/data endpoints**: Return 403 if agent status is `pending` (not yet approved).

### Data Push Format

Agents push data via `POST /api/edge/data`:

```typescript
interface EdgeDataPush {
  type: "messages" | "events" | "channel_request";
  payload: unknown;
}

// For iMessage agent:
interface MessageDataPush {
  type: "messages";
  payload: {
    messages: Array<{
      externalId: string;
      sender: string;
      senderExternalId: string;
      content: string;
      groupExternalId: string; // chat identifier
      timestamp: string; // ISO 8601
      metadata?: Record<string, unknown>;
    }>;
  };
}

// Agent requests Shade to create/link a Channel:
interface ChannelRequestPush {
  type: "channel_request";
  payload: {
    channelType: string; // "imessage"
    name: string;
    config?: Record<string, unknown>;
  };
}
```

### Command Types

Commands queued by Shade and delivered via heartbeat response:

| Command Type | Payload | Description |
|-------------|---------|-------------|
| `send_message` | `{ to: string, text: string }` | Send a message via the agent's platform |
| `update_config` | `{ config: EdgeAgentConfig }` | Hot-update agent config |
| `restart` | `{}` | Agent should restart itself |
| `report_status` | `{}` | Agent should send detailed status in next heartbeat |

### Config Structure

```typescript
interface EdgeAgentConfig {
  pollIntervalMs: number;       // how often to poll data source (default: 5000)
  heartbeatIntervalMs: number;  // how often to heartbeat (default: 30000)
  configPollIntervalMs: number; // how often to re-fetch config (default: 60000)
  features: Record<string, boolean>;
  mcpServerUrl?: string;
  // Agent-type-specific:
  imessage?: {
    dbPath?: string;
    chatFilters?: string[];     // only watch specific chat identifiers
  };
}
```

## Notifications

No push notifications or emails. Visibility through:

- **EdgeAgentEvent log** — all agent activity is logged
- **Admin UI** — pending agents surface for approval, status visible in list
- **Heartbeat monitoring** — agents that miss heartbeats transition to `offline`

## UI

### New Screens

| Screen | Route | Description |
|--------|-------|-------------|
| Edge Agents | `/edge-agents` | Agent list with status, type, platform, last heartbeat |
| Edge Agent Detail | `/edge-agents/:id` | Full agent view: status, config editor, events timeline, command sender, approve/revoke buttons |

### Navigation

Add "Edge Agents" to the existing admin section or as a new tab.

### Key Interactions

- **Approve Agent**: Button on pending agents, transitions to approved
- **Revoke Agent**: Button on approved/online agents, returns to pending
- **Edit Config**: JSON editor for agent config, saves and queues `update_config` command
- **Send Command**: Dropdown with command type, payload editor, queues command
- **View Events**: Scrollable event timeline with filters

## Phases

### Phase 1: Shared Types & Core Framework

- Create `packages/edge-agent-types/` with shared Zod schemas for registration, heartbeat, config, data push, commands
- Create `packages/edge-agent-core/` with bootstrap, heartbeat loop, config polling, command executor, local state persistence

### Phase 2: Backend Endpoints

- EdgeAgent and EdgeAgentEvent models + CRUD routes
- Registration endpoint with bootstrap secret validation
- Heartbeat endpoint with command delivery
- Config endpoint with approval check
- Data push endpoint (creates Messages, triggers Channel creation)
- Approve/revoke/command admin endpoints
- Agent health monitor (mark offline after missed heartbeats)

### Phase 3: iMessage Agent

- Extract iMessage read logic from existing `IMessageChannelConnector`
- Extract iMessage send logic (AppleScript)
- Wire into edge-agent-core (bootstrap → config → poll → push)
- Command handler for `send_message`
- Channel creation request on first boot

### Phase 4: Build & Deploy

- `bun build --compile` script for iMessage agent
- Cross-compilation targets (darwin-arm64, darwin-x64)
- launchd plist template
- systemd unit template
- Install script (copies binary, installs service, prompts for SHADE_URL)

### Phase 5: Frontend

- Regenerate SDK
- Edge Agents list screen
- Edge Agent detail screen (approve, config, commands, events)
- Pending agent notification/indicator

## Feature Flags & Migrations

**Feature flags:** None needed. Edge agent endpoints are inert until agents register.

**Data migrations:** Remove `RemoteAgent` model and routes. Existing `RemoteAgent` documents (if any) are not migrated — they were unused placeholders.

**Rollout:** Backend edge endpoints deploy with the main backend. Agent binaries deploy independently per machine. No impact on existing orchestrator.

## Activity Log & User Updates

EdgeAgentEvent serves as the activity log:

- `agent.registered` — new agent registered
- `agent.approved` — admin approved agent
- `agent.status_changed` — status transitions (with from/to)
- `agent.heartbeat` — periodic heartbeat (logged at reduced frequency to avoid spam)
- `agent.config_pulled` — agent fetched its config
- `agent.data_pushed` — agent pushed data (with summary, not full content)
- `agent.command_queued` — command sent to agent
- `agent.command_completed` / `agent.command_failed` — command results

## Not Included / Future Work

- **Agent binary auto-update** — Shade pushes new versions via GitHub releases
- **Agent-to-agent communication** — agents only talk to central Shade
- **Container isolation** — agents run as native binaries
- **WebSocket upgrade** — for real-time command delivery (heartbeat polling is sufficient for v1)
- **Additional agent types** — calendar, contacts, email (framework supports them, build after iMessage works)
- **Agent groups/fleets** — managing sets of agents as a unit
- **Metrics/monitoring dashboard** — detailed agent health metrics beyond heartbeat

---

## Task List

### Phase 1: Shared Types & Core Framework

- [ ] **Task 1.1**: Create edge-agent-types package
  - Description: New package at `packages/edge-agent-types/` with Zod schemas for all edge agent API contracts: registration request/response, heartbeat request/response, config response, data push request, command types. Export TypeScript types inferred from Zod schemas.
  - Files: `packages/edge-agent-types/package.json`, `packages/edge-agent-types/tsconfig.json`, `packages/edge-agent-types/src/index.ts`, `packages/edge-agent-types/src/registration.ts`, `packages/edge-agent-types/src/heartbeat.ts`, `packages/edge-agent-types/src/config.ts`, `packages/edge-agent-types/src/data.ts`, `packages/edge-agent-types/src/commands.ts`
  - Depends on: none
  - Acceptance: All Zod schemas validate correctly, types importable from backend and agent packages

- [ ] **Task 1.2**: Create edge-agent-core package — bootstrap module
  - Description: New package at `packages/edge-agent-core/`. Bootstrap module that handles first-boot registration (POST to `/api/edge/register` with bootstrap secret) and subsequent boots (read state from `~/.shade-agent/state.json`). Writes `{ agentId, token, shadeUrl }` to disk on successful registration.
  - Files: `packages/edge-agent-core/package.json`, `packages/edge-agent-core/tsconfig.json`, `packages/edge-agent-core/src/index.ts`, `packages/edge-agent-core/src/bootstrap.ts`, `packages/edge-agent-core/src/state.ts`
  - Depends on: 1.1
  - Acceptance: First boot registers with Shade and persists state. Second boot reads state and skips registration.

- [ ] **Task 1.3**: Create edge-agent-core — heartbeat module
  - Description: Periodic heartbeat loop that POSTs to `/api/edge/heartbeat` with agent status, platform info, and command results. Parses response for pending commands and dispatches them to a command handler. Exponential backoff on failure. Configurable interval.
  - Files: `packages/edge-agent-core/src/heartbeat.ts`
  - Depends on: 1.2
  - Acceptance: Heartbeat posts on interval, handles connection failures gracefully, delivers commands to handler

- [ ] **Task 1.4**: Create edge-agent-core — config module
  - Description: Config polling module that GETs `/api/edge/config` on an interval. Handles 403 (not approved yet) by logging and retrying. Applies config changes. Stores last-known-good config to disk for offline resilience. Emits config change events.
  - Files: `packages/edge-agent-core/src/config.ts`
  - Depends on: 1.2
  - Acceptance: Polls config, handles 403 gracefully, persists config to disk, detects changes

- [ ] **Task 1.5**: Create edge-agent-core — agent base class
  - Description: Abstract `EdgeAgent` base class that wires together bootstrap, heartbeat, and config modules. Subclasses implement `onConfig(config)`, `onCommand(command)`, and `start()`/`stop()`. Handles graceful shutdown (SIGTERM/SIGINT). Provides `pushData(data)` method for pushing data to Shade.
  - Files: `packages/edge-agent-core/src/agent.ts`, `packages/edge-agent-core/src/types.ts`
  - Depends on: 1.2, 1.3, 1.4
  - Acceptance: Base class orchestrates full lifecycle: bootstrap → wait for approval → config → start → heartbeat loop

- [ ] **Task 1.6**: Unit tests for edge-agent-core
  - Description: Tests for bootstrap (first boot vs subsequent), heartbeat (success, failure, backoff, command dispatch), config (polling, 403 handling, persistence, change detection), state persistence (read/write).
  - Files: `packages/edge-agent-core/src/bootstrap.test.ts`, `packages/edge-agent-core/src/heartbeat.test.ts`, `packages/edge-agent-core/src/config.test.ts`
  - Depends on: 1.2, 1.3, 1.4, 1.5
  - Acceptance: All tests pass with `bun test`

### Phase 2: Backend Endpoints

- [ ] **Task 2.1**: Create EdgeAgent model and types
  - Description: Mongoose schema with status lifecycle (pending/approved/online/offline/error), pendingCommands array, lastCommandResults array, authTokenHash. TypeScript interfaces. Replace RemoteAgent model.
  - Files: `backend/src/models/edgeAgent.ts`, `backend/src/types/models/edgeAgentTypes.ts`
  - Depends on: none
  - Acceptance: Model compiles, can create/query documents, indexes created

- [ ] **Task 2.2**: Create EdgeAgentEvent model and types
  - Description: Mongoose schema for agent event log with agentId, eventType, payload.
  - Files: `backend/src/models/edgeAgentEvent.ts`, `backend/src/types/models/edgeAgentEventTypes.ts`
  - Depends on: 2.1
  - Acceptance: Model compiles, indexed on agentId + created

- [ ] **Task 2.3**: Create modelRouter CRUD routes for EdgeAgent and EdgeAgentEvent
  - Description: Standard CRUD using modelRouter. Remove RemoteAgent routes. Update model and type index exports.
  - Files: `backend/src/api/edgeAgents.ts`, `backend/src/api/edgeAgentEvents.ts`, update `backend/src/models/index.ts`, `backend/src/types/models/index.ts`, `backend/src/server.ts`
  - Depends on: 2.1, 2.2
  - Acceptance: CRUD endpoints respond correctly, registered in server.ts, RemoteAgent routes removed

- [ ] **Task 2.4**: Registration endpoint
  - Description: `POST /api/edge/register` — validates bootstrap secret from `X-Bootstrap-Secret` header against `SHADE_BOOTSTRAP_SECRET` env var. Creates EdgeAgent with status `pending`, generates random token, stores SHA-256 hash, returns `{ agentId, token }`. Logs `agent.registered` event.
  - Files: `backend/src/api/edgePlugin.ts` (Express plugin)
  - Depends on: 2.1, 2.2
  - Acceptance: Valid secret creates agent, invalid secret returns 401, duplicate name returns 409

- [ ] **Task 2.5**: Heartbeat endpoint
  - Description: `POST /api/edge/heartbeat` — validates agent token via SHA-256 hash comparison. Updates lastHeartbeatAt, status (to `online` if approved), platform/version info. Uses `findOneAndUpdate` with `$set: { pendingCommands: [] }` returning the old document to atomically deliver and clear commands. Accepts command results and logs events.
  - Files: update `backend/src/api/edgePlugin.ts`
  - Depends on: 2.4
  - Acceptance: Heartbeat updates agent, delivers commands atomically, accepts results

- [ ] **Task 2.6**: Config endpoint with secrets encryption
  - Description: `GET /api/edge/config` — validates agent token. Returns 403 if status is `pending`. Returns `{ config, secrets }` for approved/online/offline agents. Secrets are decrypted from AES-256-GCM using `SHADE_SECRETS_KEY` env var before serving. Logs `agent.config_pulled` event.
  - Files: update `backend/src/api/edgePlugin.ts`, `backend/src/edge/crypto.ts` (encrypt/decrypt helpers)
  - Depends on: 2.4
  - Acceptance: Approved agents get config with decrypted secrets, pending agents get 403, secrets stored encrypted in DB

- [ ] **Task 2.7**: Data push endpoint (via ChannelManager)
  - Description: `POST /api/edge/data` — validates agent token, returns 403 if pending. Validates payload against Zod schemas from edge-agent-types. For `type: "messages"`, calls `ChannelManager.handleInboundMessage()` to reuse existing Group lookup and Message creation logic (no duplication). For `type: "channel_request"`, creates a Channel record, a default Group linked to it, and links the Channel to the EdgeAgent. Logs `agent.data_pushed` event.
  - Files: update `backend/src/api/edgePlugin.ts`
  - Depends on: 2.4, 2.6, 2.9
  - Acceptance: Messages created via ChannelManager, channel + group created on request, events logged, invalid payloads rejected with 400

- [ ] **Task 2.8**: Admin endpoints (approve, revoke, command)
  - Description: `POST /api/edge/agents/:id/approve` — sets status to `approved`, records approvedAt/approvedBy. `POST /api/edge/agents/:id/revoke` — sets status to `pending`, clears secrets. `POST /api/edge/agents/:id/command` — validates command type and payload against Zod schemas, adds to pendingCommands array. All require IsAdmin. All log events.
  - Files: update `backend/src/api/edgePlugin.ts`
  - Depends on: 2.4
  - Acceptance: Approve transitions pending→approved, revoke transitions back, commands queue correctly, invalid command payloads rejected

- [ ] **Task 2.9**: EdgeAgentChannelConnector
  - Description: Implements `ChannelConnector` interface for edge-agent-backed Channels. `sendMessage()` queues a `send_message` command on the EdgeAgent's `pendingCommands` array. `connect()` is a no-op (the edge agent manages its own connection). `onMessage()` is a no-op (inbound messages come via data push). Registered in ChannelManager when an edge agent Channel is initialized.
  - Files: `backend/src/orchestrator/channels/edgeAgent.ts`, update `backend/src/orchestrator/channels/manager.ts`
  - Depends on: 2.1
  - Acceptance: Orchestrator can send messages through edge agent channels, commands queued correctly

- [ ] **Task 2.10**: Agent health monitor
  - Description: Periodic check (every 60s) that marks agents as `offline` if no heartbeat in 90s, `error` if no heartbeat in 300s. Only checks agents with status `online`. Logs `agent.status_changed` events. Uses `findOneAndUpdate` with status filter to avoid duplicate transitions across server instances.
  - Files: `backend/src/edge/healthMonitor.ts`, register in `backend/src/server.ts`
  - Depends on: 2.5
  - Acceptance: Stale agents transition to offline/error, no duplicate events

- [ ] **Task 2.11**: Remove old IMessageChannelConnector from ChannelManager
  - Description: Remove `createIMessageConnector` from `defaultConnectorFactories` in ChannelManager. Replace with `createEdgeAgentConnector` for "imessage" type. Keep the old connector file for reference but remove it from the active code path. Update any imports.
  - Files: update `backend/src/orchestrator/channels/manager.ts`
  - Depends on: 2.9
  - Acceptance: ChannelManager no longer uses old in-process iMessage connector, uses EdgeAgentChannelConnector instead

- [ ] **Task 2.12**: Register edge plugin in server
  - Description: Register the edge plugin in server.ts. Add `SHADE_BOOTSTRAP_SECRET` and `SHADE_SECRETS_KEY` to config. Clean up RemoteAgent imports.
  - Files: update `backend/src/server.ts`, `backend/src/config.ts` (if exists)
  - Depends on: 2.3, 2.4, 2.5, 2.6, 2.7, 2.8, 2.9, 2.10, 2.11
  - Acceptance: All edge endpoints accessible, server starts cleanly

- [ ] **Task 2.13**: Unit tests for backend edge endpoints
  - Description: Tests for registration (valid/invalid secret, duplicate name), heartbeat (token validation, atomic command delivery, result processing), config (approved vs pending, secrets decryption), data push (message creation via ChannelManager, channel + group request, Zod validation), approve/revoke, EdgeAgentChannelConnector (sendMessage queues command), health monitor.
  - Files: `backend/src/api/edgePlugin.test.ts`, `backend/src/edge/healthMonitor.test.ts`, `backend/src/orchestrator/channels/edgeAgent.test.ts`
  - Depends on: 2.12
  - Acceptance: All tests pass with `bun test`

### Phase 3: iMessage Agent

- [ ] **Task 3.1**: Create iMessage agent package
  - Description: New package at `packages/edge-agent-imessage/`. Entry point extends `EdgeAgent` base class from edge-agent-core. Implements `onConfig()`, `onCommand()`, `start()`, `stop()`.
  - Files: `packages/edge-agent-imessage/package.json`, `packages/edge-agent-imessage/tsconfig.json`, `packages/edge-agent-imessage/src/index.ts`
  - Depends on: 1.5
  - Acceptance: Agent skeleton starts, bootstraps with Shade, enters heartbeat loop

- [ ] **Task 3.2**: iMessage reader module
  - Description: Extract chat.db polling logic from existing `IMessageChannelConnector`. Opens SQLite read-only, polls for new messages since last ROWID, converts Apple timestamps, returns structured messages. Configurable poll interval and chat filters.
  - Files: `packages/edge-agent-imessage/src/reader.ts`
  - Depends on: 3.1
  - Acceptance: Reads new iMessages from chat.db, converts to data push format

- [ ] **Task 3.3**: iMessage sender module
  - Description: Extract AppleScript send logic from existing `IMessageChannelConnector`. Handles both group chats and individual messages. Proper AppleScript escaping.
  - Files: `packages/edge-agent-imessage/src/sender.ts`
  - Depends on: 3.1
  - Acceptance: Can send iMessages to individuals and group chats via AppleScript

- [ ] **Task 3.4**: Wire iMessage agent together
  - Description: Connect reader and sender to the agent lifecycle. `onConfig()` starts/restarts the reader with updated config. `onCommand("send_message")` calls sender. `start()` requests channel creation from Shade, then begins polling. Pushes new messages to Shade via `pushData()`.
  - Files: update `packages/edge-agent-imessage/src/index.ts`
  - Depends on: 3.2, 3.3
  - Acceptance: Full lifecycle works: boot → register → wait for approval → get config → poll messages → push to Shade → receive send commands

- [ ] **Task 3.5**: Unit tests for iMessage agent
  - Description: Tests for reader (mock SQLite, message parsing, ROWID tracking), sender (mock execSync, AppleScript generation, escaping), command handling.
  - Files: `packages/edge-agent-imessage/src/reader.test.ts`, `packages/edge-agent-imessage/src/sender.test.ts`
  - Depends on: 3.2, 3.3, 3.4
  - Acceptance: All tests pass with `bun test`

### Phase 4: Build & Deploy

- [ ] **Task 4.1**: Bun compile build script
  - Description: Build script that compiles the iMessage agent to a single executable using `bun build --compile --minify --bytecode`. Supports cross-compilation targets. Output naming: `shade-imessage-{platform}-{arch}`.
  - Files: `packages/edge-agent-imessage/build.ts`
  - Depends on: 3.4
  - Acceptance: Produces working single-file executable for darwin-arm64

- [ ] **Task 4.2**: launchd plist
  - Description: macOS launchd plist template for running the iMessage agent as a user agent. KeepAlive, ThrottleInterval, logging to `~/Library/Logs/shade-imessage.log`. Environment variable for `SHADE_URL`.
  - Files: `packages/edge-agent-imessage/com.shade.imessage.plist`
  - Depends on: 4.1
  - Acceptance: `launchctl load` starts agent, auto-restarts on crash

- [ ] **Task 4.3**: systemd unit file
  - Description: Linux systemd service file for the iMessage agent (for future Linux agents using same pattern). Restart on failure, journal logging, environment file.
  - Files: `packages/edge-agent-imessage/shade-imessage.service`
  - Depends on: 4.1
  - Acceptance: Valid systemd unit (passes `systemd-analyze verify`)

- [ ] **Task 4.4**: Install script
  - Description: Shell script that: copies binary to `/usr/local/bin/` (or `~/.local/bin/`), prompts for SHADE_URL and SHADE_BOOTSTRAP_SECRET, writes env file, installs launchd plist (macOS) or systemd unit (Linux), starts the service.
  - Files: `packages/edge-agent-imessage/install.sh`
  - Depends on: 4.1, 4.2, 4.3
  - Acceptance: Running `./install.sh` on a Mac sets up and starts the agent

### Phase 5: Frontend

- [ ] **Task 5.1**: Regenerate SDK and add custom edge hooks
  - Description: Run `bun run sdk` to generate RTK Query hooks for EdgeAgent/EdgeAgentEvent CRUD. Manually define hooks for custom edge endpoints (`/api/edge/agents/:id/approve`, `/revoke`, `/command`).
  - Files: `frontend/store/openApiSdk.ts` (regenerated), `frontend/store/edgeSdk.ts` (manual custom hooks)
  - Depends on: Phase 2 complete
  - Acceptance: All edge CRUD hooks auto-generated, custom endpoint hooks manually defined

- [ ] **Task 5.2**: Edge Agents list screen
  - Description: List of all edge agents with status badge, agent type, platform, hostname, last heartbeat. Pending agents highlighted. Filter by status and type.
  - Files: `frontend/app/(tabs)/admin/edgeAgents.tsx`
  - Depends on: 5.1
  - Acceptance: Lists agents with filters, tappable rows navigate to detail

- [ ] **Task 5.3**: Edge Agent detail screen
  - Description: Full agent view: status badge, platform/arch/version info, config JSON editor, secrets editor, approve/revoke buttons (for pending/approved agents), command sender (type dropdown + payload), events timeline.
  - Files: `frontend/app/(tabs)/admin/edgeAgents/[id].tsx`
  - Depends on: 5.1
  - Acceptance: Can view agent, approve, send commands, edit config, view events

### Phase 6: Integration Testing

- [ ] **Task 6.1**: End-to-end integration test
  - Description: Integration test that verifies the full message round-trip: agent registers → admin approves → agent gets config → agent pushes channel_request → Channel + Group created → agent pushes messages → Messages created via ChannelManager with correct groupId → orchestrator sends outbound message → EdgeAgentChannelConnector queues send_message command → agent heartbeat receives command. Uses mock HTTP server for agent side, real MongoDB for backend.
  - Files: `backend/src/api/edgePlugin.integration.test.ts`
  - Depends on: 2.13, 1.6
  - Acceptance: Full lifecycle passes end-to-end with `bun test`

---

## Acceptance Criteria

### AC-1: Agent Registration (Zero-Config Bootstrap)

**Priority:** P0

1. Deploy a compiled iMessage agent binary to a Mac with only `SHADE_URL` and `SHADE_BOOTSTRAP_SECRET` env vars set
2. Agent starts and calls `POST /api/edge/register`
3. Shade creates an `EdgeAgent` record with status `pending`
4. Agent receives `{ agentId, token }` and writes to `~/.shade-agent/state.json`
5. Agent begins polling `GET /api/edge/config` and receives 403 (not approved)
6. Agent logs "waiting for approval" and continues polling
7. On subsequent restart, agent reads state file and skips registration
8. **Expected**: Agent is visible in Shade UI as "pending", no data flows yet

**Error cases:**
- Invalid bootstrap secret → 401, agent logs error and exits
- Shade unreachable → agent retries with exponential backoff, logs each failure
- Duplicate agent name → 409, agent logs error and exits

### AC-2: Admin Approval Flow

**Priority:** P0

1. Admin navigates to Edge Agents list in Shade UI
2. Pending agent is visible with "pending" status badge
3. Admin clicks agent row → detail screen
4. Admin clicks "Approve" button
5. Agent's next config poll succeeds (200 with config + secrets)
6. Agent transitions to working state and begins polling data source
7. Agent's next heartbeat transitions status to `online`
8. **Expected**: Agent appears as "online" in UI, events timeline shows registered → approved → online

**testIDs:** `edge-agents-list`, `edge-agent-status-badge`, `edge-agent-approve-button`, `edge-agent-detail-screen`

### AC-3: iMessage Reading

**Priority:** P0

1. Approved iMessage agent is running on a Mac with Full Disk Access
2. Agent opens `~/Library/Messages/chat.db` read-only
3. A new iMessage arrives in any conversation
4. Agent detects new message within poll interval (default 5s)
5. Agent calls `POST /api/edge/data` with message payload
6. Shade creates a `Message` document linked to the iMessage Channel
7. Message appears in Shade's message history for the associated Group
8. **Expected**: Messages flow from iMessage to Shade within ~5 seconds

**Error cases:**
- chat.db not accessible (no Full Disk Access) → agent logs error, status → error
- Shade unreachable during data push → agent buffers and retries on next cycle

### AC-4: iMessage Sending

**Priority:** P0

1. Admin sends a command via Shade UI: type `send_message`, payload `{ to: "+1234567890", text: "Hello" }`
2. Command is queued in EdgeAgent's `pendingCommands` array
3. Agent's next heartbeat receives the command
4. Agent executes AppleScript to send the iMessage
5. Agent reports command result (success/failure) in next heartbeat
6. Shade logs `command_completed` or `command_failed` event
7. **Expected**: iMessage sent, result visible in agent events timeline

**Error cases:**
- Invalid recipient → AppleScript fails, agent reports error
- Messages app not running → AppleScript launches it (macOS behavior)
- Agent offline when command queued → command waits, delivered on next heartbeat

### AC-5: Channel Auto-Creation

**Priority:** P1

1. Approved agent starts for the first time
2. Agent calls `POST /api/edge/data` with `type: "channel_request"`, payload `{ channelType: "imessage", name: "Mac Mini iMessage" }`
3. Shade creates a `Channel` record (type: "imessage", status: "connected")
4. Shade links the Channel to the EdgeAgent via `channelId`
5. Subsequent message pushes are linked to this Channel
6. **Expected**: Channel visible in Channels list, linked to agent

**Error cases:**
- Channel already exists for this agent → Shade returns existing channel, no duplicate
- Agent pushes messages before channel exists → Shade creates channel on first message push

### AC-6: Heartbeat & Health Monitoring

**Priority:** P1

1. Online agent sends heartbeat every 30s (default)
2. Shade updates `lastHeartbeatAt` on each heartbeat
3. Agent stops sending heartbeats (process killed, network down)
4. After 90s with no heartbeat, health monitor marks agent `offline`
5. After 300s with no heartbeat, health monitor marks agent `error`
6. Agent restarts and sends heartbeat → status transitions back to `online`
7. **Expected**: Status transitions are logged as events, visible in UI

### AC-7: Config Hot-Update

**Priority:** P1

1. Admin edits agent config in Shade UI (e.g. changes `pollIntervalMs` from 5000 to 3000)
2. Shade queues `update_config` command
3. Agent receives command via heartbeat, applies new config
4. Agent restarts its data source poller with new interval
5. **Expected**: Agent behavior changes without restart

### AC-8: Compiled Binary Deployment

**Priority:** P1

1. Run `bun run build` in the iMessage agent package
2. Produces single executable `shade-imessage-darwin-arm64`
3. Copy binary to target Mac
4. Run `./install.sh` — prompts for SHADE_URL and bootstrap secret
5. Script installs binary, creates launchd plist, starts service
6. Agent begins registration flow
7. **Expected**: `launchctl list | grep shade` shows running agent

### AC-9: Agent Revocation

**Priority:** P2

1. Admin clicks "Revoke" on an online agent
2. Agent status transitions to `pending`
3. Agent's next config poll receives 403
4. Agent stops its data source polling, enters waiting-for-approval state
5. Agent continues heartbeating (so admin can see it's still alive)
6. **Expected**: Agent stops processing data but remains visible

### AC-10: Graceful Shutdown

**Priority:** P2

1. `launchctl unload` or `SIGTERM` sent to agent process
2. Agent stops data source polling
3. Agent sends final heartbeat with status info
4. Agent exits cleanly
5. **Expected**: No data loss, no orphaned resources
