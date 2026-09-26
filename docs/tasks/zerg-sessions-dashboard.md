# Zerg Sessions Dashboard (IP-017) — Task List

Source: [Zerg-Sessions-Dashboard.md](../implementationPlans/Zerg-Sessions-Dashboard.md)

Decisions: read-only; data from `zerg dash --json` (+ `zerg inbox --json` when present) over the `AppConfig.zerg` ssh hop; 5 s single-flight cache; three surfaces (MCP tool, `GET /zerg/sessions`, Sessions console screen).

## Phase 1: Backend read-through

- [x] **1.1** `AppConfig.zerg.dashVerb` (`dash --json`), `inboxVerb` (`inbox --json`), `cacheMs` (5000) + types + defaults test
- [x] **1.2** `backend/src/types/zergSessions.ts` shapes; `backend/src/orchestrator/services/zergSessions.ts`: `parseDashDocument`, `normalizeRow`, `sortRows`, `ZergSessionsService.getDashboard({refresh, repo})` with injected exec, cache, single-flight, error-carrying result; unit tests with fake exec (array form, object form, hive-ls form, garbage, non-zero exit, cache hit, refresh bypass)

## Phase 2: Surfaces

- [x] **2.1** `backend/src/agentRunner/zergTools.ts`: `list_zerg_sessions` tool (repo, needsYouOnly) + text table; registered in `buildTools`; test the formatter
- [x] **2.2** `zergPromptBlock` appended to the system prompt when `zerg.enabled`
- [x] **2.3** `backend/src/api/zergSessions.ts` `ZergSessionsPlugin` → `GET /zerg/sessions` (auth, `refresh`, `repo`); registered in `server.ts`; route test with the service stubbed

## Phase 3: Frontend

- [x] **3.1** `frontend/store/sdk.ts`: `ZergDashboard` types + `listZergSessions` query + `useListZergSessionsQuery`
- [x] **3.2** `frontend/app/(tabs)/sessions.tsx` + sidebar entry; loading/error/empty/list/inbox states with the IP's testIDs
- [x] **3.3** `qa/test-cases/sessions.md` + `_index.md` row; `e2e/sessions.spec.ts`
- [x] **3.4** `docs/architecture/agents-and-tools.md` section
