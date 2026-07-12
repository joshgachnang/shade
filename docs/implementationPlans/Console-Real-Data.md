# IP-013: Console Real Data

**Status:** Open
**Created:** 2026-07-11
**Author:** Josh + Shade

## Summary

Replace the Shade Console's demo view-model with real backend data. The console chat becomes a real conversation with Shade (via `POST /command` + message polling), each pane reads live resources, the Approvals pane becomes the Agent Task Board, the Memory pane gains full read/write editing backed by new REST endpoints, and the status-bar kill switch actually pauses the orchestrator.

Decisions (2026-07-11): chat = real via /command, strip branch/plan-mode/model-picker UI (1A); Approvals → Agent Task Board (2A); Memory read **and write** (3B); Config read-only + Admin link (4A); polling, no push infra (5A); kill switch wired for real (6).

## Models

- **AppConfig** — add `orchestrator.paused: boolean` (default `false`). When true, the message loop stops enqueueing new agent runs, the task worker stops claiming board tasks, and the scheduler stops dispatching due tasks. Inbound messages still store (catalogue-only, like the SMS allowlist behavior). Cache invalidation on save makes it take effect on the next poll without a restart.
- No other model changes. Everything else reads existing collections: `Message`, `AIRequest`, `AgentSession`, `AgentTask`, `TaskRunLog`, `ScheduledTask`, `EdgeAgent`, `EdgeAgentEvent`, `Group`, `Channel`, `AppConfig`.

## APIs

All authenticated (`IsAuthenticated`) unless noted. New plugin `backend/src/api/console.ts`:

- `GET /console/status` — `{paused, channels: HealthSnapshot[], edgeAgents: [{name, status, version}], counts: {unprocessedMessages, pendingTasks, activeSessions}}`. Powers the status bar and System pane header.
- `POST /console/kill` — sets `orchestrator.paused = true`. Returns new status.
- `POST /console/restore` — sets `orchestrator.paused = false`.

New plugin `backend/src/api/memory.ts` (wraps `orchestrator/memory.ts` + `orchestrator/skills.ts`):

- `GET /memory/global` / `PUT /memory/global` — global CLAUDE.md content `{content, size, maxChars}`.
- `GET /memory/user` / `PUT /memory/user` — USER.md profile.
- `GET /memory/groups` — groups with folder + whether a memory file exists.
- `GET /memory/groups/:groupId` / `PUT /memory/groups/:groupId` — per-group memory.
- `GET /memory/skills` — skills index (name + description).
- `GET /memory/skills/:name` / `PUT /memory/skills/:name` — full skill content (kebab-case name validation via `isValidSkillName`).
- PUT bodies `{content}`; enforce `AppConfig.memory.maxFileChars`/`maxSkillChars` via `applyMemoryUpdate`/`saveSkill` (mode `replace`).

Scheduled task actions (`backend/src/api/console.ts` or extend crud):

- `POST /scheduledTasks/:id/pause` / `POST /scheduledTasks/:id/resume` — direct status flips (`active` ⇄ `paused`); the scheduler reads status from the DB each tick, so no IPC needed.

Chat uses existing `POST /command` (accepts `groupName`/`groupId`) and `GET /messages?groupId=&limit=`. Agent task cancel uses a new `POST /agentTasks/:id/cancel` mirroring the `cancel_agent_task` MCP tool's atomic transitions.

## Notifications

None. The alerts popover becomes a client-side merge of real error signals (failed `EdgeAgentEvent`s of type `command_failed`, unhealthy channels from `/console/status`, failed `AgentTask`s in the last 24h); read/unread state stays client-local.

## UI

All panes keep their current visual design; only data sources change. Polling via RTK Query `pollingInterval` (chat 4s; panes 10s; status 10s).

- **Chat (Home)** — messages from the main group (`/groups?isMain=true`, fallback first group). Composer → `POST /command`. Render user vs bot rows with existing row styles; show pending state until the bot reply lands. Remove branch bar, plan-first toggle, and model selector. testIDs: `console-chat-composer`, `console-chat-send`, `console-chat-message-{id}`.
- **Activity** — merged stream: recent `Messages` (all groups, newest first) + `EdgeAgentEvent`s, labeled by group/agent. testID `console-activity-list`.
- **Approvals → Agent Task Board** — real `AgentTasks` grouped by status (pending/claimed/running/completed/failed), cancel button on cancellable rows. Sidebar badge = pending+running count. Rename label to "Tasks". testIDs `console-tasks-list`, `console-task-{id}-cancel`.
- **System** — real topology: channels (from `/console/status` health snapshot) → orchestrator → edge agents, with live status dots; counts row (unprocessed messages, active sessions). Drop the fake animated event pulses.
- **Memory** — tabs: Global / User / Groups / Skills. Markdown textarea editor per file with char-count vs cap, Save (PUT) + saved toast. testIDs `memory-tab-{name}`, `memory-editor`, `memory-save-button`.
- **Traces** — `AIRequest`s newest-first (model, duration, token counts, status, prompt preview) with a detail expand; secondary tab for `AgentSession`s. testID `console-traces-list`.
- **Cron** — real `ScheduledTask`s with next/last run, status, pause/resume buttons. testID `console-cron-list`, `console-cron-{id}-toggle`.
- **Config** — read-only cards of key AppConfig sections (assistant name, models, poll intervals, feature toggles; secrets redacted) + "Edit in Admin" link. testID `console-config-summary`.
- **Status bar** — real data: paused state drives Kill/Restore buttons (`POST /console/kill|restore`, keeping the two-click arm-confirm client-side); "Online" badge reflects `/console/status` reachability + channel health; replace "Sandboxed · Docker"/"Egress" demo badges with real facts (connected channel count, edge agent count). Alerts popover per Notifications section.
- `useShadeConsole` demo VM shrinks to UI-state only (drawer/popover/toast state); simulated agents/messages/timers deleted.

## Phases

1. **Backend surfaces** — `orchestrator.paused` flag + gating in messageLoop/taskWorker/scheduler; `/console/*`; `/memory/*`; scheduledTask pause/resume; agentTask cancel. Unit tests for each (memory endpoints round-trip; paused gating).
2. **Chat wiring** — SDK endpoints, main-group resolution, send + poll loop, demo chat extras removed.
3. **Pane wiring** — Activity, Tasks (Approvals), Traces, Cron, System, Config.
4. **Memory editing** — endpoints consumed, editor UX, caps surfaced.
5. **Status bar + alerts** — kill/restore, real badges, alert merge; delete dead demo VM code.
6. **Tests & docs** — Playwright specs per pane (list renders, kill/restore round-trip, memory save), QA test cases, `_index.md`, README console section.

## Feature flags & migrations

None. `orchestrator.paused` defaults false (no behavior change until used). Memory endpoints operate on existing files.

## Activity log & user updates

Kill/restore actions append an EdgeAgentEvent-style log line via `logger.info` and surface as toasts; no new audit collection.

## Not included / future work

- Real approval gates for agent actions (deferred — Task Board covers the need for now).
- Push transport (SSE/WebSocket); polling only.
- Branching / plan-mode / model-picker chat features (removed until backend equivalents exist).
- Inline AppConfig editing in the console (Admin UI remains the editor).
- Egress allowlist / sandbox enforcement (badges now show real-but-different facts).

## Task list

### Phase 1 — Backend
- [ ] Add `orchestrator.paused` to AppConfig schema + types
- [ ] Gate messageLoop enqueue, taskWorker claim, scheduler dispatch on `paused`
- [ ] `backend/src/api/console.ts`: GET /console/status, POST /console/kill, POST /console/restore
- [ ] `backend/src/api/memory.ts`: global/user/group/skills GET+PUT
- [ ] POST /scheduledTasks/:id/pause + /resume
- [ ] POST /agentTasks/:id/cancel (atomic, mirrors MCP tool)
- [ ] Register plugins in server.ts; unit tests

### Phase 2 — Chat
- [ ] SDK: console status, command send, message polling, groups(isMain)
- [ ] Chat reads real messages; composer sends via /command; pending indicator
- [ ] Remove branch bar / plan toggle / model select from Chat

### Phase 3 — Panes
- [ ] Activity: merged messages + edge events stream
- [ ] Approvals → Tasks board (AgentTasks + cancel), sidebar badge from real count
- [ ] Traces: AIRequests list + AgentSessions tab
- [ ] Cron: ScheduledTasks + pause/resume
- [ ] System: real topology + counts
- [ ] Config: read-only summary + Admin link

### Phase 4 — Memory
- [ ] Memory pane tabs + editor + save with caps

### Phase 5 — Status bar
- [ ] Kill/restore wired; online badge from status; real fact badges
- [ ] Alerts popover merges real failure signals
- [ ] Delete simulated agents/messages/timers from useShadeConsole

### Phase 6 — Tests & docs
- [ ] Playwright: chat send round-trip (test-mode backend), pane renders, kill/restore, memory save
- [ ] QA test cases + _index.md update
