# Backend Core

Express + Mongoose app built on `@terreno/api`, living in `backend/src/`. It provides the data layer, REST API, admin UI, and integrations; the agent brain lives in the [orchestrator](./orchestrator.md).

## Boot sequence (`backend/src/server.ts`)

1. Install global error handlers (uncaught exception / unhandled rejection → Sentry + log).
2. Connect to MongoDB (`MONGO_URI`).
3. Load the `AppConfig` singleton from the DB.
4. `hydrateEnvFromConfig()` — copy AppConfig values into `process.env` for third-party SDKs that read env synchronously (Anthropic, OpenRouter, …). Restart-required fields are tracked in `backend/src/utils/configEnv.ts`.
5. Initialize filesystem dirs under `SHADE_DATA_DIR` via lazy `paths.*` accessors (`data/`, `groups/`, `sessions/`, `ipc/`, `plugins/`, `movies/`).
6. Non-prod: `checkModelsStrict()` schema validation.
7. Register admin UI plugin, health plugin, `/command` E2E plugin, CRUD routes, custom action routes.
8. Start the HTTP server, then asynchronously start the orchestrator and the edge-agent health monitor.

## Models (~26)

All schemas get `addDefaultPlugins`: `created`/`updated` timestamps, soft delete (`isDeleted`), `findOneOrNone`, `findExactlyOne`, and `strict: "throw"`.

**Agent platform:** `User`, `Channel`, `Group`, `Message`, `ScheduledTask`, `TaskRunLog`, `AgentSession`, `AIRequest`, `AppConfig`, `Plugin`, `CommandClassification`, `WebhookSource`.

**Edge:** `EdgeAgent`, `EdgeAgentEvent`.

**Feature verticals:** `Feature` (feature-channel workflow), `Movie` / `Frame` / `FrameAnalysis` / `Character` (movie analysis), `RadioStream` / `Transcript` (radio), `TriviaQuestion` / `TriviaScore` (separate `trivia` Mongo DB, optional), `PrWatch` (GitHub PR monitoring), `CalendarConfig` (Apple Calendar).

## API surface

- **Auto-generated CRUD** (`backend/src/api/crudRoutes.ts`): one `modelRouter` per model (`/users`, `/groups`, `/messages`, `/scheduledTasks`, …). Typical permissions: admin writes, authenticated reads; owner-scoped for `CalendarConfig`.
- **Custom action routes** (`backend/src/api/`):
  - `health.ts` — `/health`, `/health/slack` (used by the deploy watchdog)
  - `command.ts` — `/command` message-injection endpoint for E2E tests
  - `movies.ts`, `search.ts` — movie processing actions, static frame serving, Atlas Search
  - `features.ts` — feature-step lifecycle
  - `appleCalendar.ts`, `appleContacts.ts` — Calendar.app / Contacts.app CRUD (macOS host)
  - `notifications.ts` — ntfy.sh → Slack bridge
  - `triviaMonitor.ts` — trivia service control
  - `edgePlugin.ts` — edge agent register/heartbeat/config/data/approve/revoke/command
  - `orchestratorPreview.ts` — rich-card validation/preview for admins

## Services (`backend/src/services/`)

Movie pipeline: `moviePipeline` (orchestration) → `frameExtractor` (ffmpeg) → `frameAnalyzer` (OpenRouter / Gemini vision via `openRouter.ts` + `visionPrompt.ts`) → `characterTracker` (appearance aggregation).

## Admin (`backend/src/admin/`)

`@terreno/admin-backend` panel plus operational scripts runnable from the UI (dry-run safe): `systemStatus`, `aiCostSummary`, `testApiKeys`, `reconnectChannels`, `reloadAppConfigCache`, `rotateJwtSecrets`, `cleanupOldData`, `retryFailedMovies`.

## MCP media server (`backend/src/mcpMediaServer/`)

Standalone HTTP MCP server (bearer-token auth) exposing Sonarr, Radarr, NZBGet, and Plex tools. Config resolves from env or `AppConfig.mcpMedia`; can run independently behind a Cloudflare tunnel.

## Cross-cutting

- **AppConfig**: singleton config in Mongo; fallback chain is env var → AppConfig field → default. All new config goes here, never bare `process.env` (see root `CLAUDE.md`).
- **Auth**: Passport local (email/password) + JWT via Terreno; `IsAuthenticated` / `IsAdmin` / `IsOwner` permissions on routes.
- **Logging**: `logger` from `@terreno/api` (Winston), `LOG_LEVEL` env; Sentry for crashes.
- **DB**: primary Mongo + optional separate trivia Mongo (`TRIVIA_MONGO_URI`); exponential-backoff reconnect.
