# Implementation Plan: Shade Claude Fleet

**Status:** Open
**Priority:** High
**Effort:** Epic (2+ weeks)
**IP:** IP-002

Multi-node orchestration system for real interactive Claude Code sessions running across VMs/LXCs, managed through Shade as the control plane.

## Design Notes

### FleetNode vs RemoteAgent

These models serve different domains and coexist intentionally:

- **FleetNode** — VM/LXC running the shade-worker daemon for interactive Claude Code sessions (fleet system). Has system metrics, workerUrl, HTTP API.
- **RemoteAgent** — External agent host connected via WebSocket for task dispatch (orchestrator system). Has capabilities, connectionInfo, WebSocket protocol.

Both have heartbeats and status, but they are separate systems. Add a comment in each model referencing the other to prevent confusion.

### State Machine Design

The original PRD had 17 states. After adversarial review, collapsed to 9 backend states with a separate `subStatus` field for runtime detail. Backend tracks lifecycle; sub-status is informational and inferred by the worker.

---

## Models

5 new Mongoose models. All use `addDefaultPlugins(schema)` for created/updated/deleted fields, `strict: 'throw'`, and `toJSON/toObject: { virtuals: true }`.

### 1. FleetNode

Represents a registered worker node (VM or LXC) running the shade-worker daemon.
See also: `RemoteAgent` model (different system — orchestrator tool hosts).

```typescript
const fleetNodeSchema = new mongoose.Schema<FleetNodeDocument, FleetNodeModel>({
  name: { type: String, required: true, trim: true, unique: true },
  hostname: { type: String, required: true },
  tailscaleName: { type: String },
  kind: { type: String, required: true, enum: ['vm', 'lxc'] },
  status: { type: String, default: 'offline', enum: ['online', 'offline', 'degraded'] },
  labels: { type: mongoose.Schema.Types.Mixed, default: {} },
  capabilities: { type: mongoose.Schema.Types.Mixed, default: {} },
  lastHeartbeatAt: { type: Date },
  cpuCount: { type: Number },
  memoryMb: { type: Number },
  diskFreeMb: { type: Number },
  workerUrl: { type: String, required: true }, // e.g. http://worker-node:4021
  workerTokenHash: { type: String, required: true }, // bcrypt hash of bearer token
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });
```

**Auth note:** `workerTokenHash` stores a bcrypt hash. When the control plane needs to call a worker, it looks up the plaintext token from `SHADE_WORKER_TOKENS` env var (a JSON map of `nodeId -> token`). The hash is used only to validate inbound heartbeat requests from workers.

### 2. FleetSession

A Claude Code session running inside tmux on a worker node, one per git worktree.

**Status states (9):**

| State | Description |
|-------|-------------|
| `created` | DB record exists, nothing launched yet |
| `preparing` | Worker is setting up worktree and running hooks |
| `running` | Claude is active inside tmux |
| `interrupted` | Ctrl-C sent, waiting for Claude to respond |
| `stopped` | Claude/tmux stopped, worktree still exists |
| `merged` | PR merged, cleanup pending |
| `cleaning` | Cleanup in progress |
| `cleaned` | Worktree removed, session archived |
| `failed` | Unrecoverable error at any stage |

**Sub-status (informational, inferred by worker):**

| Sub-status | Meaning |
|------------|---------|
| `idle` | Claude is at the prompt, waiting for input |
| `thinking` | Claude is generating a response |
| `awaiting_permission` | Claude is waiting for tool approval |
| `running_tool` | Claude is executing a tool/bash command |
| `unknown` | Cannot determine (default) |

**State transition table:**

| From | To | Trigger |
|------|----|---------|
| `created` | `preparing` | Worker begins setup |
| `created` | `failed` | Validation error |
| `preparing` | `running` | tmux + claude launched and verified |
| `preparing` | `failed` | Setup hook failure, worktree error |
| `running` | `interrupted` | Ctrl-C sent |
| `running` | `stopped` | Graceful stop |
| `running` | `merged` | PR merged (webhook) |
| `running` | `failed` | tmux died unexpectedly |
| `interrupted` | `running` | Claude resumed after interrupt |
| `interrupted` | `stopped` | Follow-up stop after interrupt |
| `stopped` | `running` | Session resumed |
| `stopped` | `merged` | PR merged while stopped |
| `stopped` | `cleaning` | Manual cleanup triggered |
| `merged` | `cleaning` | Cleanup job starts |
| `cleaning` | `cleaned` | Cleanup succeeded |
| `cleaning` | `failed` | Cleanup error (retryable via new job) |
| `failed` | `cleaning` | Manual cleanup of failed session |
| `*` | `failed` | Unrecoverable error (timeout, node offline) |

**Human lock:** When `humanLock` is true, transitions to `cleaning` are blocked. Cleanup jobs move to `blocked` status instead.

```typescript
const fleetSessionSchema = new mongoose.Schema<FleetSessionDocument, FleetSessionModel>({
  nodeId: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetNode', required: true },
  repoName: { type: String, required: true },
  originUrl: { type: String, required: true },
  status: {
    type: String,
    default: 'created',
    enum: ['created', 'preparing', 'running', 'interrupted', 'stopped', 'merged', 'cleaning', 'cleaned', 'failed'],
  },
  subStatus: {
    type: String,
    default: 'unknown',
    enum: ['idle', 'thinking', 'awaiting_permission', 'running_tool', 'unknown'],
  },
  branchName: { type: String, required: true },
  baseBranch: { type: String, required: true, default: 'master' },
  worktreePath: { type: String },
  tmuxSessionName: { type: String },
  claudeSessionId: { type: String },
  taskPrompt: { type: String },
  humanLock: { type: Boolean, default: false },
  mergeState: {
    type: String,
    default: 'none',
    enum: ['none', 'tracked', 'merged', 'closed_unmerged'],
  },
  githubPrNumber: { type: Number },
  githubPrUrl: { type: String },
  statusVersion: { type: Number, default: 0 }, // optimistic concurrency for state transitions
  startedAt: { type: Date },
  lastActivityAt: { type: Date },
  stoppedAt: { type: Date },
  mergedAt: { type: Date },
  cleanedAt: { type: Date },
  metadata: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });

fleetSessionSchema.index({ nodeId: 1, status: 1 });
fleetSessionSchema.index({ repoName: 1, branchName: 1 });
fleetSessionSchema.index({ mergeState: 1 });
```

**Optimistic concurrency:** State transitions use `statusVersion` — update only where `statusVersion` equals the expected value, then increment. If the update matches 0 documents, the transition was preempted by another actor. This prevents race conditions between admin actions, webhook handlers, and cleanup runners without needing distributed locks.

### 3. SessionEvent

Structured event log for fleet sessions (state changes, output captures, errors).

```typescript
const sessionEventSchema = new mongoose.Schema<SessionEventDocument, SessionEventModel>({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetSession', required: true, index: true },
  source: { type: String, required: true, enum: ['worker', 'shade', 'github', 'hook', 'system'] },
  eventType: { type: String, required: true },
  payload: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });

sessionEventSchema.index({ sessionId: 1, created: 1 });
```

### 4. HookRun

Execution record for a lifecycle hook (setup, cleanup, etc.).

```typescript
const hookRunSchema = new mongoose.Schema<HookRunDocument, HookRunModel>({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetSession', required: true, index: true },
  hookPhase: {
    type: String,
    required: true,
    enum: ['setup', 'pre_start', 'post_start', 'pre_cleanup', 'cleanup', 'post_cleanup', 'merge_cleanup'],
  },
  command: { type: String, required: true },
  exitCode: { type: Number },
  stdout: { type: String },
  stderr: { type: String },
  startedAt: { type: Date, required: true },
  endedAt: { type: Date },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });
```

### 5. CleanupJob

Tracks cleanup work after merge or manual teardown.

```typescript
const cleanupJobSchema = new mongoose.Schema<CleanupJobDocument, CleanupJobModel>({
  sessionId: { type: mongoose.Schema.Types.ObjectId, ref: 'FleetSession', required: true, index: true },
  status: {
    type: String,
    default: 'queued',
    enum: ['queued', 'running', 'blocked', 'failed', 'completed'],
  },
  reason: { type: String, required: true }, // 'merged', 'manual', 'stale'
  attemptCount: { type: Number, default: 0 },
  lastError: { type: String },
}, { strict: 'throw', toJSON: { virtuals: true }, toObject: { virtuals: true } });
```

## APIs

### Standard CRUD (via modelRouter)

| Route | Model | Permissions | Query Fields | Sort |
|-------|-------|-------------|--------------|------|
| `/fleetNodes` | FleetNode | list/read: IsAuthenticated, CUD: IsAdmin | status, kind | name |
| `/fleetSessions` | FleetSession | list/read: IsAuthenticated, CUD: IsAdmin | nodeId, repoName, status, mergeState, humanLock | -created |
| `/sessionEvents` | SessionEvent | list/read: IsAuthenticated, D: IsAdmin | sessionId, source, eventType | -created |
| `/hookRuns` | HookRun | list/read: IsAuthenticated, D: IsAdmin | sessionId, hookPhase | -startedAt |
| `/cleanupJobs` | CleanupJob | list/read: IsAuthenticated, D: IsAdmin | sessionId, status | -created |

### Custom Control Plane Endpoints

Registered as an Express plugin at `/api/fleet`.

| Method | Path | Description | Permission |
|--------|------|-------------|------------|
| `POST` | `/api/fleet/heartbeat` | Worker heartbeat (updates node status, metrics) | Worker token |
| `POST` | `/api/fleet/sessions` | Create a new fleet session (validates node, calls worker) | IsAdmin |
| `POST` | `/api/fleet/sessions/:id/start` | Start a created session (triggers worker launch) | IsAdmin |
| `POST` | `/api/fleet/sessions/:id/stop` | Stop a running session | IsAdmin |
| `POST` | `/api/fleet/sessions/:id/interrupt` | Send Ctrl-C to session | IsAdmin |
| `POST` | `/api/fleet/sessions/:id/send-input` | Send validated text to tmux (audit logged) | IsAdmin |
| `POST` | `/api/fleet/sessions/:id/send-slash-command` | Send validated slash command (audit logged) | IsAdmin |
| `GET`  | `/api/fleet/sessions/:id/output` | Get recent pane output | IsAuthenticated |
| `GET`  | `/api/fleet/sessions/:id/attach` | Get attach info (ssh command, tmux name) | IsAuthenticated |
| `POST` | `/api/fleet/sessions/:id/cleanup` | Manually trigger cleanup | IsAdmin |
| `POST` | `/api/fleet/sessions/:id/lock` | Toggle human lock | IsAdmin |
| `POST` | `/api/fleet/cleanup/run-stale` | Run cleanup on all stale sessions | IsAdmin |
| `POST` | `/webhooks/github-fleet` | GitHub webhook receiver for merge events | HMAC signature |
| `GET`  | `/api/fleet/dashboard` | Aggregated dashboard data (nodes, sessions, stats) | IsAuthenticated |

### Input Validation and Audit Logging

All `send-input` and `send-slash-command` endpoints validate payloads with Zod before forwarding to tmux:

```typescript
// In fleet-types package
const sendInputSchema = z.object({
  text: z.string()
    .min(1)
    .max(10_000)
    .refine((s) => !s.includes('\x00'), 'Null bytes not allowed'),
  force: z.boolean().optional().default(false),
});

const sendSlashCommandSchema = z.object({
  command: z.string()
    .min(1)
    .max(500)
    .regex(/^\/[a-zA-Z][a-zA-Z0-9:_-]*$/, 'Must be a valid slash command (e.g. /my-skill)')
    .refine((s) => !s.includes(' '), 'Slash command must not contain spaces — use send-input for prompts'),
  force: z.boolean().optional().default(false),
});
```

**Guardrails:**
- Input blocked if session status is not `running` or `interrupted` (unless `force: true`)
- All send-input and send-slash-command actions are logged as SessionEvents with `source: 'shade'`, including the full text sent and the requesting user
- Maximum text length enforced (10KB for input, 500 chars for slash commands)
- Null bytes stripped

### Worker API (shade-worker, port 4021)

Private API exposed by each worker daemon, authenticated via bearer token.

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/sessions` | Create worktree + tmux + claude for a session |
| `POST` | `/sessions/:id/start` | Start an already-created session |
| `POST` | `/sessions/:id/stop` | Gracefully stop claude + tmux |
| `POST` | `/sessions/:id/interrupt` | Send Ctrl-C |
| `POST` | `/sessions/:id/cleanup` | Run cleanup hooks, remove worktree |
| `GET`  | `/sessions/:id` | Get local session status |
| `GET`  | `/sessions/:id/output` | Capture recent pane output |
| `GET`  | `/sessions/:id/attach` | Return attach command info |
| `POST` | `/sessions/:id/send-input` | Send validated text + Enter to tmux |
| `POST` | `/sessions/:id/send-slash-command` | Send validated `/command` + Enter |
| `POST` | `/sessions/:id/send-enter` | Send Enter key |
| `POST` | `/sessions/:id/send-ctrl-c` | Send Ctrl-C |
| `POST` | `/sessions/:id/run-hook/:phase` | Run a specific hook phase |
| `GET`  | `/health` | Worker health check |

Worker endpoints also validate input with the same Zod schemas from fleet-types.

## Notifications

No push notifications or emails for v1. Visibility through:

- **Dashboard** — live session list, node status, recent events
- **Session events** — structured log in MongoDB (includes all input sent to sessions)
- **Pino logs** — control plane and worker both log with Pino

## UI

### New Screens

| Screen | Route | Description |
|--------|-------|-------------|
| Fleet Dashboard | `/fleet` | Node status grid, active session count, recent events feed |
| Fleet Sessions | `/fleet/sessions` | Filterable session list (by node, repo, status, merge state) |
| Session Detail | `/fleet/sessions/:id` | Full session view: status, output, attach info, events, hooks, lock toggle |
| Fleet Nodes | `/fleet/nodes` | Node list with health, disk, CPU, session counts |
| Node Detail | `/fleet/nodes/:id` | Node info, active sessions on this node |

### Navigation

Add a "Fleet" tab to the existing tab bar.

### Key Interactions

- **Create Session**: form with node selector, repo, branch, prompt fields
- **Send Input**: text input on session detail, sends to worker (validated + audit logged)
- **Attach**: displays copyable SSH + tmux command
- **Lock Toggle**: button on session detail, prevents auto-cleanup
- **View Output**: scrollable pane output display, refreshable

## Phases

### Phase 0: Monorepo Bootstrap

- Set up Bun workspaces in root `package.json`
- Create `packages/` directory structure
- Configure TypeScript project references for cross-package imports
- Verify `fleet-types` is importable from both `backend/` and `packages/shade-worker/`

### Phase 1: Models, Types, and Shared Infrastructure

- All 5 Mongoose models + TypeScript type definitions
- `fleet-types` package with shared API contracts (Zod schemas for request/response)
- Input validation schemas (sendInputSchema, sendSlashCommandSchema)
- Repo config schema (`.shade/claude-fleet.yml` parser with Zod)
- modelRouter CRUD for all fleet models
- Session state machine utility (transition table, guards, optimistic concurrency helper)
- Unit tests for state machine and Zod schemas

### Phase 2: Worker Daemon Core

- Express server on port 4021 with bearer token auth
- tmux control module: create, send-keys, capture-pane, kill, attach-info
- Git worktree module: create, remove, prune, status, validate paths
- Hook runner: execute shell commands in worktree, capture stdout/stderr/exit
- Health endpoint
- Heartbeat loop (POST to control plane every 30s)
- Session reconciliation on startup (discover existing tmux sessions, report to control plane)
- systemd unit file
- Unit tests for tmux, git, hook modules

### Phase 3: Session Lifecycle (Control Plane + Worker)

- Control plane: create session endpoint (validate node, create DB record, call worker)
- Worker: full session creation flow (fetch, worktree, setup hooks, tmux + claude launch, verify alive)
- Control plane: start/stop/interrupt endpoints (proxy to worker)
- Session state transitions with optimistic concurrency (statusVersion check)
- Session event logging (state changes, errors, hook results)
- Integration tests for session create/stop lifecycle

### Phase 4: Interactive Control

- Worker: send-input, send-slash-command, send-enter, send-ctrl-c (with Zod validation)
- Control plane: proxy endpoints with input validation and audit logging
- Worker: pane capture with configurable line count
- Worker: attach info generation (hostname, tmux name, ssh command)
- Input guardrails: block if session not running, warn if thinking
- Basic state inference from pane output (idle/thinking/awaiting heuristics)
- Unit tests for input validation, integration tests for send-input flow

### Phase 5: Merge Detection and Cleanup

- GitHub webhook receiver (`POST /webhooks/github-fleet`)
- Webhook signature verification (HMAC-SHA256)
- PR/branch to session mapping
- Cleanup job creation on merge
- Worker: cleanup flow (check lock, stop tmux, archive output, inspect git status, remove worktree)
- Dirty repo safety: capture git status/diff, block if dirty unless config allows
- Idempotent cleanup (safe to retry)
- Human lock: toggle endpoint, cleanup respects lock
- Stale session cleanup runner
- Tests for webhook handler, cleanup flow, human lock behavior

### Phase 6: Frontend Dashboard

- Regenerate SDK with new fleet endpoints + manual RTK Query definitions for custom fleet endpoints
- Fleet tab in navigation
- Fleet Dashboard screen (nodes grid, session count, events)
- Fleet Sessions list screen (filterable by node/repo/status)
- Session Detail screen (status, output viewer, attach info, send input, events timeline, hook runs, lock toggle)
- Fleet Nodes list screen
- Node Detail screen

## Feature Flags & Migrations

**Feature flags:** None. Fleet features are inert until nodes are registered and sessions created.

**Data migrations:** None. All models are new. Existing models unchanged.

**Rollout:** Worker daemon deployed independently per node. Control plane fleet routes added to existing backend. No impact on existing orchestrator functionality.

## Activity Log & User Updates

Session events serve as the activity log:

- `session.created`, `session.started`, `session.stopped`
- `session.input_sent` (includes full text sent + requesting user)
- `session.slash_command_sent` (includes command + requesting user)
- `session.state_changed` (with from/to in payload)
- `session.merge_detected`, `session.cleanup_started`, `session.cleaned`
- `hook.started`, `hook.completed`, `hook.failed`
- `node.heartbeat`, `node.status_changed`

Dashboard shows recent events across all sessions.

## Not Included / Future Work

- **Distributed scheduling optimization** — manual node selection for v1
- **Multi-user RBAC** — admin-only for v1
- **Terminal streaming in browser** — SSH/tmux attach for now
- **Claude Desktop SSH integration** — data model is ready, implementation later
- **Claude Remote Control** — data model is ready, implementation later
- **Advanced state inference** — heuristic-based for v1, can improve later
- **Docker isolation** — direct execution for v1
- **Cross-provider orchestration** — Claude only
- **Full scrollback archival** — recent pane capture only
- **Redis/queue system** — MongoDB-based job tracking for v1

---

## Task List

### Phase 0: Monorepo Bootstrap

- [ ] **Task 0.1**: Set up Bun workspaces
  - Description: Add `workspaces` field to root `package.json` pointing to `packages/*`, `backend`, `frontend`. Create `packages/` directory. Verify `bun install` resolves cross-package dependencies.
  - Files: `package.json` (root), `packages/` directory
  - Depends on: none
  - Acceptance: `bun install` succeeds at root, workspace packages are linked

- [ ] **Task 0.2**: Configure TypeScript project references
  - Description: Set up `tsconfig.json` with project references so `fleet-types` is importable from both `backend/` and `packages/shade-worker/`. Verify cross-package imports compile.
  - Files: `tsconfig.json` (root), `packages/fleet-types/tsconfig.json`, `packages/shade-worker/tsconfig.json`
  - Depends on: 0.1
  - Acceptance: `import { ... } from 'fleet-types'` compiles in both backend and shade-worker

### Phase 1: Models, Types, and Shared Infrastructure

- [ ] **Task 1.1**: Create FleetNode model and types
  - Description: Mongoose schema, TypeScript interface, addDefaultPlugins. Include comment referencing RemoteAgent to explain coexistence.
  - Files: `backend/src/models/fleetNode.ts`, `backend/src/types/models/fleetNodeTypes.ts`
  - Depends on: none
  - Acceptance: Model compiles, can create/query documents

- [ ] **Task 1.2**: Create FleetSession model and types
  - Description: Mongoose schema with 9-state status enum, subStatus field, statusVersion for optimistic concurrency, indexes
  - Files: `backend/src/models/fleetSession.ts`, `backend/src/types/models/fleetSessionTypes.ts`
  - Depends on: 1.1
  - Acceptance: Model compiles, indexes created, status enum matches 9-state design

- [ ] **Task 1.3**: Create SessionEvent, HookRun, CleanupJob models and types
  - Description: Remaining 3 Mongoose schemas + TypeScript interfaces
  - Files: `backend/src/models/sessionEvent.ts`, `backend/src/models/hookRun.ts`, `backend/src/models/cleanupJob.ts`, corresponding type files
  - Depends on: 1.2
  - Acceptance: All models compile and are exported from models/index.ts

- [ ] **Task 1.4**: Create modelRouter CRUD endpoints for all fleet models
  - Description: Standard CRUD routes using @terreno/api modelRouter
  - Files: `backend/src/api/fleetNodes.ts`, `backend/src/api/fleetSessions.ts`, `backend/src/api/sessionEvents.ts`, `backend/src/api/hookRuns.ts`, `backend/src/api/cleanupJobs.ts`
  - Depends on: 1.3
  - Acceptance: All CRUD endpoints respond correctly, registered in server.ts

- [ ] **Task 1.5**: Create fleet-types package with shared Zod schemas
  - Description: Shared request/response contracts, session status/subStatus constants, input validation schemas (sendInputSchema, sendSlashCommandSchema), repo config schema, worker API contracts
  - Files: `packages/fleet-types/src/index.ts`, `packages/fleet-types/src/sessionStates.ts`, `packages/fleet-types/src/inputValidation.ts`, `packages/fleet-types/src/repoConfig.ts`, `packages/fleet-types/src/workerApi.ts`, `packages/fleet-types/package.json`
  - Depends on: 0.2
  - Acceptance: Zod schemas validate correctly, importable from both backend and worker

- [ ] **Task 1.6**: Session state machine utility
  - Description: Define transition table as a map, transition guard function that checks validity and returns new state, optimistic concurrency helper that does `findOneAndUpdate` with `statusVersion` check
  - Files: `packages/fleet-types/src/sessionStates.ts`
  - Depends on: 1.5
  - Acceptance: Invalid transitions throw, valid transitions return new state, concurrent transitions detected via version mismatch

- [ ] **Task 1.7**: Unit tests for Phase 1
  - Description: Tests for state machine transitions (valid, invalid, concurrent), Zod schema validation (valid input, invalid input, edge cases), input validation schemas (length limits, null bytes, slash command format)
  - Files: `packages/fleet-types/src/sessionStates.test.ts`, `packages/fleet-types/src/inputValidation.test.ts`
  - Depends on: 1.5, 1.6
  - Acceptance: All tests pass with `bun test`

### Phase 2: Worker Daemon Core

- [ ] **Task 2.1**: Initialize shade-worker package
  - Description: Package scaffold with Express server, bearer token auth middleware, Pino logger, config from env
  - Files: `packages/shade-worker/package.json`, `packages/shade-worker/tsconfig.json`, `packages/shade-worker/src/index.ts`, `packages/shade-worker/src/server.ts`, `packages/shade-worker/src/config.ts`, `packages/shade-worker/src/auth.ts`
  - Depends on: 1.5
  - Acceptance: Worker starts on port 4021, rejects unauthenticated requests, health endpoint responds

- [ ] **Task 2.2**: tmux control module
  - Description: Functions: createTmuxSession, sendInput, sendSlashCommand, capturePane, interruptSession, killTmuxSession, getAttachInfo, sessionExists, discoverSessions (list all `shade-*` tmux sessions). All shell out to tmux CLI.
  - Files: `packages/shade-worker/src/tmux.ts`
  - Depends on: 2.1
  - Acceptance: Can create tmux session, send keys, capture output, kill session, discover existing sessions. Session naming: `shade-<repo>-<shortId>`

- [ ] **Task 2.3**: Git worktree module
  - Description: Functions: createWorktree, removeWorktree, pruneWorktrees, getWorktreeStatus, listWorktrees, validateWorktreePath (must be inside allowed roots). Uses shell git commands.
  - Files: `packages/shade-worker/src/git.ts`
  - Depends on: 2.1
  - Acceptance: Can create worktree from base branch, check dirty status, remove safely, list existing worktrees, validates paths

- [ ] **Task 2.4**: Hook runner module
  - Description: Execute shell commands in worktree directory, capture stdout/stderr/exit code, set environment variables (SHADE_SESSION_ID, SHADE_REPO_NAME, etc.), timeout support
  - Files: `packages/shade-worker/src/hooks.ts`
  - Depends on: 2.1
  - Acceptance: Runs commands in specified cwd, captures all output, returns structured result

- [ ] **Task 2.5**: Heartbeat loop
  - Description: Periodic POST to control plane with node metrics (cpu, memory, disk, active session count). Updates node status. Interval configurable (default 30s). Handles connection failures gracefully (log and retry next interval).
  - Files: `packages/shade-worker/src/heartbeat.ts`
  - Depends on: 2.1
  - Acceptance: Posts heartbeat to control plane URL, handles connection failures gracefully

- [ ] **Task 2.6**: Repo config parser
  - Description: Read and parse `.shade/claude-fleet.yml` from a repo/worktree root. Zod validation. Fallback defaults if file missing.
  - Files: `packages/shade-worker/src/repoConfig.ts`
  - Depends on: 1.5 (uses Zod schema from fleet-types)
  - Acceptance: Parses valid config, returns defaults for missing file, throws on invalid config

- [ ] **Task 2.7**: Worker startup reconciliation
  - Description: On worker startup, discover existing `shade-*` tmux sessions and worktrees. Report them to the control plane so it can reconcile session state (mark sessions as running if tmux is alive, mark as failed if tmux died while worker was down).
  - Files: `packages/shade-worker/src/reconciliation.ts`
  - Depends on: 2.2, 2.3, 2.5
  - Acceptance: After worker restart, existing tmux sessions are reported. Control plane updates session status to match reality.

- [ ] **Task 2.8**: systemd unit file
  - Description: Production systemd service file for shade-worker
  - Files: `packages/shade-worker/shade-worker.service`
  - Depends on: 2.1
  - Acceptance: Service starts worker under dedicated user, restarts on failure

- [ ] **Task 2.9**: Unit tests for worker modules
  - Description: Tests for tmux module (mock shell commands), git module (mock shell commands), hook runner (mock shell commands), repo config parser (valid/invalid/missing configs)
  - Files: `packages/shade-worker/src/tmux.test.ts`, `packages/shade-worker/src/git.test.ts`, `packages/shade-worker/src/hooks.test.ts`, `packages/shade-worker/src/repoConfig.test.ts`
  - Depends on: 2.2, 2.3, 2.4, 2.6
  - Acceptance: All tests pass with `bun test`

### Phase 3: Session Lifecycle

- [ ] **Task 3.1**: Control plane fleet plugin (custom routes)
  - Description: Express plugin registering all `/api/fleet/*` custom endpoints. Worker client utility for making authenticated HTTP calls to workers.
  - Files: `backend/src/api/fleet.ts`, `backend/src/fleet/workerClient.ts`
  - Depends on: 1.4, 2.1
  - Acceptance: Plugin registered in server.ts, worker client can make authenticated requests

- [ ] **Task 3.2**: Heartbeat receiver
  - Description: `POST /api/fleet/heartbeat` endpoint. Validates worker token against stored hash, updates FleetNode status and metrics, marks node online. Also processes reconciliation data from worker restarts.
  - Files: `backend/src/fleet/heartbeat.ts` (handler used in fleet.ts)
  - Depends on: 3.1
  - Acceptance: Heartbeat updates node lastHeartbeatAt, cpuCount, memoryMb, diskFreeMb. Reconciliation data updates stale session statuses.

- [ ] **Task 3.3**: Node health monitor
  - Description: Periodic check (every 60s) that marks nodes as `degraded` if no heartbeat in 90s, `offline` if no heartbeat in 180s
  - Files: `backend/src/fleet/nodeMonitor.ts`
  - Depends on: 3.2
  - Acceptance: Stale nodes transition to degraded then offline

- [ ] **Task 3.4**: Create session flow (control plane)
  - Description: `POST /api/fleet/sessions` — validate node exists and is online, create FleetSession with `created` status, call worker to create session, update status via state machine with optimistic concurrency, log session events
  - Files: `backend/src/fleet/sessionManager.ts`
  - Depends on: 3.1, 3.2
  - Acceptance: Creates session, calls worker, updates status, events logged

- [ ] **Task 3.5**: Create session flow (worker)
  - Description: `POST /sessions` — fetch latest refs, create worktree, read repo config, run setup hooks, create tmux session, launch `claude` in tmux, verify tmux alive, send initial prompt if provided, return status + attach info
  - Files: `packages/shade-worker/src/sessions.ts`
  - Depends on: 2.2, 2.3, 2.4, 2.6
  - Acceptance: Full flow works end-to-end: worktree created, claude running in tmux, attach info returned

- [ ] **Task 3.6**: Stop/interrupt session (both sides)
  - Description: Control plane proxies stop/interrupt to worker. Worker sends Ctrl-C or kills tmux. Control plane updates FleetSession status via state machine.
  - Files: Updates to `backend/src/fleet/sessionManager.ts`, `packages/shade-worker/src/sessions.ts`
  - Depends on: 3.4, 3.5
  - Acceptance: Stop transitions to `stopped`, interrupt transitions to `interrupted`, state machine enforced

- [ ] **Task 3.7**: Integration tests for session lifecycle
  - Description: Tests for create session flow (control plane creates DB record, calls worker), stop/interrupt flow, state machine transitions with optimistic concurrency
  - Files: `backend/src/fleet/sessionManager.test.ts`
  - Depends on: 3.4, 3.5, 3.6
  - Acceptance: All tests pass with `bun test`

### Phase 4: Interactive Control

- [ ] **Task 4.1**: Worker interactive control endpoints
  - Description: send-input, send-slash-command, send-enter, send-ctrl-c endpoints on worker API. Validates input with Zod schemas from fleet-types. Validates session exists and tmux is alive before sending.
  - Files: `packages/shade-worker/src/api.ts` (route handlers)
  - Depends on: 2.2, 3.5
  - Acceptance: Can send text, slash commands, and control keys to running Claude session. Invalid input rejected with 400.

- [ ] **Task 4.2**: Control plane interactive proxy endpoints
  - Description: `/api/fleet/sessions/:id/send-input`, `send-slash-command` etc. Validate with Zod, log as SessionEvent (including text and requesting user), check session status guardrails, proxy to worker.
  - Files: Updates to `backend/src/api/fleet.ts`, `backend/src/fleet/sessionManager.ts`
  - Depends on: 3.1, 4.1
  - Acceptance: Can send input from control plane API, blocked for non-running sessions, all input audit logged as SessionEvents

- [ ] **Task 4.3**: Pane output capture
  - Description: Worker `GET /sessions/:id/output?lines=200` captures tmux pane. Control plane proxies at `GET /api/fleet/sessions/:id/output`.
  - Files: Updates to worker and control plane
  - Depends on: 4.1
  - Acceptance: Returns recent pane text, configurable line count

- [ ] **Task 4.4**: Attach info endpoint
  - Description: Worker returns hostname, tmux session name, worktree path, ssh command. Control plane proxies.
  - Files: Updates to worker and control plane
  - Depends on: 3.5
  - Acceptance: Returns copyable `ssh user@host 'tmux attach -t shade-repo-id'` command

- [ ] **Task 4.5**: Basic state inference
  - Description: Worker inspects last N lines of pane output to heuristically detect: idle at prompt, thinking/generating, awaiting approval. Updates session subStatus field.
  - Files: `packages/shade-worker/src/stateInference.ts`
  - Depends on: 4.3
  - Acceptance: Can distinguish idle vs active Claude states from pane output patterns

- [ ] **Task 4.6**: Tests for interactive control
  - Description: Unit tests for Zod input validation (valid/invalid text, slash command format, length limits). Integration test for send-input audit logging (verify SessionEvent created with correct payload).
  - Files: `packages/shade-worker/src/api.test.ts`, `backend/src/fleet/sessionManager.test.ts` (additions)
  - Depends on: 4.1, 4.2
  - Acceptance: All tests pass with `bun test`

### Phase 5: Merge Detection and Cleanup

- [ ] **Task 5.1**: GitHub webhook receiver
  - Description: `POST /webhooks/github-fleet` — verify HMAC-SHA256 signature (secret from `SHADE_GITHUB_FLEET_WEBHOOK_SECRET` env var), parse pull_request events, extract repo/branch/PR info
  - Files: `backend/src/fleet/githubWebhook.ts`
  - Depends on: 3.1
  - Acceptance: Receives and validates GitHub webhook, extracts merge info

- [ ] **Task 5.2**: PR/branch to session mapping
  - Description: On merge event, look up FleetSessions by repoName + branchName or githubPrNumber. Mark matching sessions as `merged` using state machine with optimistic concurrency.
  - Files: Updates to `backend/src/fleet/githubWebhook.ts`
  - Depends on: 5.1
  - Acceptance: Merged PR correctly maps to active sessions, sessions marked merged

- [ ] **Task 5.3**: Cleanup job creation and runner
  - Description: Create CleanupJob on merge. Background runner polls for queued jobs, calls worker cleanup endpoint, handles blocked/failed states, retries with backoff.
  - Files: `backend/src/fleet/cleanupRunner.ts`
  - Depends on: 5.2
  - Acceptance: Cleanup jobs created on merge, runner processes them, respects human lock

- [ ] **Task 5.4**: Worker cleanup flow
  - Description: `POST /sessions/:id/cleanup` — check human lock, stop tmux if running, archive pane output, inspect git status, run cleanup hooks, remove worktree if clean (or block if dirty), prune stale worktrees, mark cleaned/blocked. Idempotent (safe to retry).
  - Files: `packages/shade-worker/src/cleanup.ts`
  - Depends on: 2.2, 2.3, 2.4
  - Acceptance: Clean worktree removed, dirty worktree blocked with git status captured, second run is no-op

- [ ] **Task 5.5**: Human lock endpoints
  - Description: `POST /api/fleet/sessions/:id/lock` toggles humanLock. Cleanup respects lock (CleanupJob moves to `blocked` status).
  - Files: Updates to `backend/src/api/fleet.ts`
  - Depends on: 5.3
  - Acceptance: Lock prevents cleanup, unlock allows cleanup to proceed

- [ ] **Task 5.6**: Stale session cleanup
  - Description: `POST /api/fleet/cleanup/run-stale` finds sessions with no activity for configurable period, creates cleanup jobs for them
  - Files: Updates to `backend/src/fleet/cleanupRunner.ts`
  - Depends on: 5.3
  - Acceptance: Old idle sessions get cleanup jobs created

- [ ] **Task 5.7**: Tests for merge detection and cleanup
  - Description: Tests for webhook signature validation, PR-to-session mapping, cleanup job creation, human lock blocking, idempotent cleanup
  - Files: `backend/src/fleet/githubWebhook.test.ts`, `backend/src/fleet/cleanupRunner.test.ts`
  - Depends on: 5.1, 5.3, 5.4, 5.5
  - Acceptance: All tests pass with `bun test`

### Phase 6: Frontend Dashboard

- [ ] **Task 6.1**: Regenerate SDK and add custom fleet hooks
  - Description: Run `bun run sdk` to generate RTK Query hooks for modelRouter endpoints. Manually define RTK Query hooks for custom fleet endpoints (`/api/fleet/sessions/:id/start`, `/stop`, `/send-input`, etc.) since these are not auto-generated by modelRouter.
  - Files: `frontend/store/openApiSdk.ts` (regenerated), `frontend/store/fleetSdk.ts` (manual custom hooks)
  - Depends on: Phase 1-5 backend complete
  - Acceptance: All fleet CRUD hooks auto-generated, custom fleet endpoint hooks manually defined and working

- [ ] **Task 6.2**: Fleet tab and navigation
  - Description: Add Fleet tab to tab bar. Sub-navigation for sessions, nodes, dashboard views.
  - Files: `frontend/app/(tabs)/fleet.tsx`, `frontend/app/(tabs)/_layout.tsx`
  - Depends on: 6.1
  - Acceptance: Fleet tab visible, navigates to fleet screens

- [ ] **Task 6.3**: Fleet Dashboard screen
  - Description: Node status cards (online/offline/degraded), active session count, recent SessionEvent feed
  - Files: `frontend/app/(tabs)/fleet/index.tsx`
  - Depends on: 6.1
  - Acceptance: Shows live node status, session counts, recent events

- [ ] **Task 6.4**: Fleet Sessions list screen
  - Description: Filterable list of FleetSessions. Filters: node, repo, status, merge state. Shows branch, status badge, last activity, node name.
  - Files: `frontend/app/(tabs)/fleet/sessions.tsx`
  - Depends on: 6.1
  - Acceptance: Lists sessions with filters, tappable rows navigate to detail

- [ ] **Task 6.5**: Session Detail screen
  - Description: Full session view: status badge + sub-status, repo/branch info, pane output viewer (refreshable), send-input text field, attach info (copyable), events timeline, hook runs list, human lock toggle button
  - Files: `frontend/app/(tabs)/fleet/sessions/[id].tsx`
  - Depends on: 6.1
  - Acceptance: Can view session, send input, see output, toggle lock, view events

- [ ] **Task 6.6**: Fleet Nodes list and detail screens
  - Description: Node list with health indicators. Detail shows node info + active sessions on that node.
  - Files: `frontend/app/(tabs)/fleet/nodes.tsx`, `frontend/app/(tabs)/fleet/nodes/[id].tsx`
  - Depends on: 6.1
  - Acceptance: Nodes displayed with status, detail shows sessions
