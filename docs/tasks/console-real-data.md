# Tasks: Console Real Data (IP-013)

Source plan: `docs/implementationPlans/Console-Real-Data.md`

## Phase 1 — Backend surfaces
- [ ] Add `orchestrator.paused: boolean` (default false) to `backend/src/models/appConfig.ts` + `appConfigTypes.ts`
- [ ] MessageLoop: skip trigger/enqueue when paused (messages still stored)
- [ ] TaskWorkerService: skip claiming when paused
- [ ] SchedulerService: skip dispatch when paused
- [ ] New `backend/src/api/console.ts`: `GET /console/status`, `POST /console/kill`, `POST /console/restore`
- [ ] New `backend/src/api/memory.ts`: GET/PUT global, user, groups/:groupId; GET skills; GET/PUT skills/:name (caps enforced via applyMemoryUpdate/saveSkill)
- [ ] `POST /scheduledTasks/:id/pause` and `/resume`
- [ ] `POST /agentTasks/:id/cancel` (atomic pending→cancelled, claimed/running→cancelRequested)
- [ ] Register plugins in `server.ts`
- [ ] Unit tests: paused gating, memory round-trip + caps, task cancel transitions

## Phase 2 — Chat
- [ ] SDK endpoints: `getConsoleStatus`, `consoleKill`, `consoleRestore`, `sendCommand`, `listGroupMessages` (poll), `listGroups({isMain})`
- [ ] Chat renders real messages for the main group (pollingInterval 4s)
- [ ] Composer sends via POST /command; optimistic user row + pending indicator
- [ ] Remove branch bar, plan-first toggle, model selector

## Phase 3 — Panes
- [ ] Activity: merge recent Messages + EdgeAgentEvents, newest first
- [ ] Approvals → Tasks: AgentTasks by status + cancel; sidebar badge = pending+running
- [ ] Traces: AIRequests list + AgentSessions tab
- [ ] Cron: ScheduledTasks with pause/resume buttons
- [ ] System: channels → orchestrator → edge agents topology from /console/status
- [ ] Config: read-only AppConfig summary (secrets redacted) + Admin link

## Phase 4 — Memory
- [ ] Memory pane: Global/User/Groups/Skills tabs, editor, char-count vs cap, Save + toast

## Phase 5 — Status bar & alerts
- [ ] Kill/Restore buttons → /console/kill|restore (client-side arm-confirm retained)
- [ ] Online badge from /console/status; real badges (channel + edge agent counts)
- [ ] Alerts popover: merge command_failed edge events, unhealthy channels, failed AgentTasks (24h)
- [ ] Delete simulated agents/messages/timers from useShadeConsole

## Phase 6 — Tests & docs
- [ ] Playwright: pane renders, kill/restore round-trip, memory save, chat send (test-mode backend)
- [ ] QA test cases + `_index.md` update
- [ ] README console section
