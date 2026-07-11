# Deployment & Operations

## The single-artifact model

Everything ships as **one self-contained bundle**: `dist/shade.js`, built by
`./shade build` from `backend/src/index.ts` (~20 MB, no `node_modules` needed at
runtime). The `SHADE_SERVICE` env var selects what a process runs:

| SHADE_SERVICE | Service | Notes |
|---------------|---------|-------|
| `backend` (default) | HTTP gateway: API, channels, orchestrator | `PORT` (4020) |
| `worker` | AgentTask board worker | `WORKER_PORT` (4021) health endpoint |
| `imessage` | iMessage edge agent | needs `SHADE_URL`, `SHADE_BOOTSTRAP_SECRET`, macOS Full Disk Access |

Agent runs from the bundle use the host `claude` binary (the Agent SDK's own
`cli.js` isn't inside the bundle); override with `SHADE_CLAUDE_CODE_PATH`.

The `shade` CLI provisions a machine (`./shade deploy [service...]` → build +
env files in `~/.config/shade/` + launchd plists or systemd units + start) and
updates it (`./shade update <shade.js> [service...]` → swap the bundle at
`$SHADE_HOME/dist/shade.js` and restart installed services). `SHADE_HOME`
defaults to `~/Library/Application Support/Shade` on macOS and
`~/.local/share/shade` on Linux.

## CI deploys

- `.github/workflows/build-release.yml` — on push to master, builds
  `dist/shade.js` and publishes it to the `latest` GitHub release.
- `.github/workflows/deploy-studio.yml` — chained to Build & Release; runs on
  the studio Mac's self-hosted runner (`nangstudio`, labels
  `[self-hosted, macOS, studio]`), downloads the artifact, runs
  `./shade update`, and health-checks :4020/:4021.
- `.github/workflows/deploy-server.yml` — legacy source-based deploy to the
  Linux `shade` host (pinned to `[self-hosted, Linux]`); pulls master and
  restarts systemd units.

## Frontend — Netlify

- `netlify.toml`: base `frontend/`, `bun run build:web`, publish `dist/`, SPA rewrite to `/index.html`, Node 22.
- Live at `https://s.nang.io`.

## Studio Mac — launchd (primary)

- Host: `NangStudio`; services `com.shade.backend`, `com.shade.worker`, and
  `com.shade.imessage` (installed, opt-in) as user LaunchAgents.
- Bundle at `~/Library/Application Support/Shade/dist/shade.js`; data at
  `~/Library/Application Support/Shade/data`; env files in `~/.config/shade/`;
  logs in `~/Library/Logs/Shade/`.
- MongoDB: local Homebrew `mongodb-community` (`mongodb://localhost:27017/shade`).
- GitHub Actions runner installed at `~/actions-runner` (launchd service
  `actions.runner.joshgachnang-shade.nangstudio`).

## Backend — systemd on a Tailscale host (legacy)

- Host: `shade` (Tailscale, `100.71.181.113`); API at `https://shade-api.nang.io` behind Cloudflare.
- Provisioning: `deploy/setup-server.sh` — installs Bun, MongoDB 7, Node 22; runs as system user `shade` from `/opt/shade/src/backend/`; installs and enables both `shade-backend.service` (gateway) and `shade-worker.service` (worker).
- Bootstrap secrets in `/opt/shade/.env`: `ANTHROPIC_API_KEY`, `TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `MONGO_URI` — everything else comes from `AppConfig` in Mongo.
- Env templates in `config/` (`shade-backend.env.example`, `shade-worker.env.example`, `shade-imessage.env.example`).

## Worker — shade-worker.service

Since IP-010, `AgentTask` board work runs in a separate worker process (see [Orchestrator](./orchestrator.md) for the gateway/worker split).

- `deploy/shade-worker.service` mirrors `shade-backend.service`: same user, same `EnvironmentFile=/opt/shade/backend.env`, same `SHADE_DATA_DIR`; `ExecStart` runs `bun run worker` (`backend/src/workerMain.ts`).
- Health: `GET /health` on `WORKER_PORT` (unit sets `Environment=WORKER_PORT=4021`) → `{status, workerId, runningTasks, uptimeSeconds}`.
- `TimeoutStopSec=960`: on stop the worker drains in-flight tasks for up to `taskWorker.taskTimeoutMs` (default 900 s), so systemd gets that bound plus 60 s headroom before SIGKILL. If `taskTimeoutMs` is raised, raise `TimeoutStopSec` to match.
- Logs: `journalctl -u shade-worker`.
- Observability: the `systemStatus` admin script's Workers section shows distinct `workerId`s active in the last 5 min (heartbeat ages) and board counts (pending / claimed / running / completed-24h / failed-24h).

### Rollout flags

Each step is independently reversible:

1. Ship code; nothing changes (`taskWorker.runInGateway=true`, `scheduler.useTaskBoard=false`).
2. Deploy `shade-worker.service`; both gateway and worker claim board tasks (safe — claims are atomic).
3. Set `taskWorker.runInGateway=false` → board work is worker-only.
4. Set `scheduler.useTaskBoard=true` → scheduled runs go through the board, i.e. run on workers.

## Watchdog

`deploy/shade-watchdog.sh` (as `shade-watchdog.service`) polls `GET /health` and `GET /health/slack`; on failure it restarts `shade-backend.service`, with a restart cooldown and an hourly restart cap. It restarts **only** the gateway — `shade-worker.service` is intentionally not watchdog-managed (workers drain gracefully on systemd stop, and stale-heartbeat reclaim covers crashes), so gateway restarts never kill in-flight board tasks. There is no in-process watchdog.

## Dev workflow

```bash
cd backend && bun run dev    # backend on :4020
cd frontend && bun run web   # web frontend
cd frontend && bun run sdk   # regenerate SDK after backend API changes
```
