# Shade

> Mr. Gachnang, I am here to be your butler and serve all of your always *excellent* ideas
> and will certainly not mention how many trees and how much water I'm destroying in the process.

Shade is a personal assistant platform: an Express/Mongoose backend with an
Expo/React Native (web) frontend, plus a fleet of edge agents and workers.
It bundles an LLM agent runner and orchestrator with integrations for
iMessage, Slack, email, Apple Calendar, Apple Contacts, GitHub, transcripts,
movies, scheduled tasks, trivia, and more.

## Tech Stack

- **Runtime / package manager**: [Bun](https://bun.sh)
- **Backend**: Express + Mongoose + [`@terreno/api`](https://www.npmjs.com/package/@terreno/api)
- **Frontend**: Expo / React Native Web + [`@terreno/ui`](https://www.npmjs.com/package/@terreno/ui) + [`@terreno/rtk`](https://www.npmjs.com/package/@terreno/rtk) (RTK Query)
- **Database**: MongoDB
- **AI**: Anthropic Claude (`@anthropic-ai/sdk`, `@anthropic-ai/claude-agent-sdk`), MCP servers
- **Testing**: `bun test` (unit), Playwright (E2E), Markdown QA cases
- **Lint / format**: Biome

## Repository Layout

```
backend/              Express API, agent runner, orchestrator, MCP media server
frontend/             Expo Router app (web target)
packages/
  edge-agent-core/    Shared edge-agent runtime
  edge-agent-imessage/  iMessage edge agent
  edge-agent-types/   Zod schemas / types shared with edges
  fleet-types/        Worker/fleet shared types
  shade-worker/       Worker process (Express + pino)
config/               Example env files (shade-backend, shade-worker)
deploy/               Server provisioning + systemd units
docs/
  implementationPlans/  Tracked IPs (see PLAN_INDEX.md)
  tasks/                Task files emitted by /ip:generate
e2e/                  Playwright specs + helpers
qa/test-cases/        Markdown QA test cases
setup.sh              Interactive local/server setup (writes .env, systemd units)
install.sh            One-shot installer
```

## Prerequisites

- Bun >= 1.2
- MongoDB (local or remote)
- An Anthropic API key (optional, but most agent features require it)
- For the iMessage edge agent: macOS with Full Disk Access

## Quick Start

```bash
# 1. Install workspaces + generate the frontend SDK from the backend OpenAPI
bun run bootstrap

# 2. Run setup.sh for interactive .env generation (backend + frontend)
./setup.sh

# 3. Start the backend on port 4020
cd backend && bun run dev

# 4. In another shell, start the web frontend on port 8082
cd frontend && bun run web
```

After backend route or model changes, regenerate the typed SDK:

```bash
cd frontend && bun run sdk
```

## Environment Variables

Most runtime configuration lives in the `AppConfig` Mongo model (API keys,
webhooks, feature flags, service credentials). Environment variables are
only for bootstrap-level config:

| Variable | Where | Purpose |
|---|---|---|
| `MONGO_URI` | backend | Mongo connection string (default `mongodb://localhost:27017/shade`) |
| `PORT` | backend | HTTP port (default `4020` dev, `3000` prod) |
| `TOKEN_SECRET` | backend | JWT signing secret |
| `REFRESH_TOKEN_SECRET` | backend | JWT refresh signing secret |
| `ANTHROPIC_API_KEY` | backend | Claude API key |
| `EXPO_PUBLIC_API_URL` | frontend | Backend base URL (e.g. `http://localhost:4020`) |

See `config/shade-backend.env.example` and `config/shade-worker.env.example`
for the full set used in production.

## Scripts

### Root

| Command | Purpose |
|---|---|
| `bun run bootstrap` | Install workspaces + regenerate the frontend SDK |
| `bun run lint` | Biome check across backend and frontend |
| `bun run lint:fix` | Biome safe autofix |
| `bun run lint:unsafefix` | Biome autofix including unsafe transforms |
| `bun run rules` | Regenerate per-tool rule files via `rulesync` |

### Backend (`cd backend`)

| Command | Purpose |
|---|---|
| `bun run dev` | Watch-mode dev server on port 4020 |
| `bun run start` | Production server |
| `bun run build` | Bun build to `./dist` (node target) |
| `bun run compile` | TypeScript `tsc` typecheck |
| `bun run test` | Unit tests |
| `bun run trivia:answer` | Trivia answerer script |
| `bun run scrape:scores` / `:loop` | Scrape scores once or in a loop |
| `bun run scrape:vault` | Scrape vault scores |
| `bun run mcp:media` | Run the MCP media server |

Other useful scripts in `backend/src/scripts/`:

- `resetPassword.ts` — `MONGO_URI=<uri> bun run src/scripts/resetPassword.ts <email> <password>`

### Frontend (`cd frontend`)

| Command | Purpose |
|---|---|
| `bun run web` | Expo web on port 8082 |
| `bun run sdk` | Regenerate `openApiSdk.ts` from the backend OpenAPI spec |
| `bun run lint` | Biome check |

## Testing

- **Unit**: `bun test` from `backend/` (or any workspace with tests).
- **E2E**: Playwright specs under `e2e/`. Run with `bunx playwright test`.
  The web frontend must be running on `http://localhost:8082`. Auth state
  is set up by `e2e/auth.setup.ts` before each project.
- **QA cases**: Human-readable Markdown specs under `qa/test-cases/`.
  Format and priority definitions are in `.claude/qa-test-case-format.md`.
- **Auto-generated tests**: See `.claude/auto-test-generation.md` — the
  rules apply to every code change, not just on demand.
- **Playwright conventions**: See `.claude/playwright-rules.md` for
  selectors, RNW DOM mappings, and async patterns.

## Code Style

Detailed conventions live in `CLAUDE.local.md`. Highlights:

- ES module syntax, TypeScript everywhere.
- Prefer `interface` over `type`; avoid enums (use maps).
- Const arrow functions over `function`; descriptive names with auxiliary
  verbs (`isLoading`).
- camelCase directories (`components/authWizard`), named exports.
- RORO pattern (Receive an Object, Return an Object).
- **Dates**: Luxon only — never `Date` or `dayjs`.
- **Errors**: Guard early, return early, avoid nested `if`s. Backend throws
  `APIError({status, title})`.
- **Mongoose**: Use `Model.findExactlyOne` or `Model.findOneOrNone`, not
  `Model.findOne`.
- **Logging**: Backend `logger.info/warn/error/debug`; frontend
  `console.info/debug/warn/error`. `console.log` is debug-only and must
  be removed before merge.
- **Config**: Goes in the `AppConfig` model via `loadAppConfig()` — not
  env vars — for anything beyond bootstrap.

## Backend Conventions

- Use `modelRouter` for CRUD endpoints.
- Permissions via `IsAuthenticated`, `IsOwner`, `IsAdmin`,
  `IsAuthenticatedOrReadOnly`.
- All model types live in `src/types/models/`.
- In routes, `req.user` is `UserDocument | undefined`.

### Adding a new model

1. Create `src/models/yourModel.ts`.
2. Create types in `src/types/models/yourModelTypes.ts`.
3. Export from both `src/models/index.ts` and `src/types/models/index.ts`.
4. Create the route in `src/api/yourModel.ts`.
5. Register the route in `src/server.ts`.

## Frontend Conventions

- Use generated SDK hooks from `@/store/openApiSdk` — never edit
  `openApiSdk.ts` by hand; regenerate with `bun run sdk`.
- Use `@terreno/ui` primitives (`Box`, `Page`, `Button`, `TextField`, …).
- Expo Router files under `app/**` need `export default` (annotate with
  a comment when used).
- Redux Toolkit for state; Luxon for dates.

### Adding a new screen

1. If the backend changed, run `bun run sdk`.
2. Create the screen under `frontend/app/`.
3. Use `@terreno/ui` for layout and SDK hooks for data.

## Implementation Plans

Feature work is tracked as Implementation Plans (IPs) in
`docs/implementationPlans/`, indexed by `PLAN_INDEX.md`. Each IP moves
through these stages:

| Stage | Description |
|---|---|
| Planned | Identified but not yet designed |
| Design | Actively designing (PRD ingested, shaping) |
| Open | Shaped and ready for implementation |
| In Progress | Currently being implemented |
| Pending Verification | Code complete, awaiting verification |
| Complete | Verified working, ready to archive |
| Deferred | Postponed (low priority or blocked) |
| Closed | Won't implement (superseded or not needed) |

Slash commands drive the workflow:

| Command | Purpose |
|---|---|
| `/ip` | Full workflow (ingest → research → shape → plan → generate) |
| `/ip:init` | Set up IP tracking in the project |
| `/ip:ingest` | Ingest a PRD |
| `/ip:shape` | Narrow scope, surface risks |
| `/ip:plan` | Walk through plan sections interactively |
| `/ip:generate` | Generate the final plan + task list |
| `/ip:explore` | Project overview, IP history, recent activity |
| `/ip:deep` | Parallel 4-agent deep analysis |
| `/ip:status` | Active IPs with status and grooming |
| `/ip:verify` | Commit, proofread, verify after implementation |
| `/ip:attack` | Adversarial red-team review |
| `/ip:close` | Complete/close an IP, archive, update index |

Conventions:

- IP files: `docs/implementationPlans/{Title-Case-Name}.md`
- Template: `docs/implementationPlans/IP_TEMPLATE.md`
- Task files: `docs/tasks/{feature-name}.md`
- Commits: `IP-XXX: Brief description`
- Source of truth: the IP file (not the index) when they disagree.
- Completed IPs move to `docs/implementationPlans/archive/`.

## Deployment

Production runs on the `shade` Tailscale host:

- **API**: `https://shade-api.nang.io` (Cloudflare → port 3000)
- **Frontend**: `https://s.nang.io`
- **Host**: `shade` (`100.71.181.113`)
- **Process**: `bun` from `/opt/shade/src/backend/` as user `josh`
- **MongoDB**: `mongodb://localhost:27017/shade` on the same host
- **Env**: `/opt/shade/backend.env`

Access:

```bash
ssh shade                                            # Shell in
ssh shade 'cd /opt/shade/src/backend && <command>'   # Run a command
```

Provisioning lives in `deploy/`:

- `deploy/setup-server.sh` — initial server provisioning
- `deploy/setup-mini.sh` — minimal/edge variant
- `deploy/shade-backend.service` — systemd unit (the process currently
  runs directly via `bun`, not the unit)

## License

Unlicensed / private. All rights reserved.
