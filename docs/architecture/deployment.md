# Deployment & Operations

## Frontend — Netlify

- `netlify.toml`: base `frontend/`, `bun run build:web`, publish `dist/`, SPA rewrite to `/index.html`, Node 22.
- Live at `https://s.nang.io`.

## Backend — systemd on a Tailscale host

- Host: `shade` (Tailscale, `100.71.181.113`); API at `https://shade-api.nang.io` behind Cloudflare.
- Provisioning: `deploy/setup-server.sh` (also `setup-mini.sh` for the Mac mini) — installs Bun, MongoDB 7, Node 22; runs as system user `shade` from `/opt/shade/src/backend/`; installs and enables both `shade-backend.service` (gateway) and `shade-worker.service` (worker). A binary deployment variant exists (`shade-backend.service.binary`).
- Bootstrap secrets in `/opt/shade/.env`: `ANTHROPIC_API_KEY`, `TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `MONGO_URI` — everything else comes from `AppConfig` in Mongo.
- Env templates in `config/` (`shade-backend.env.example`, `shade-worker.env.example`).

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
