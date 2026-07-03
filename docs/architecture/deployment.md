# Deployment & Operations

## Frontend — Netlify

- `netlify.toml`: base `frontend/`, `bun run build:web`, publish `dist/`, SPA rewrite to `/index.html`, Node 22.
- Live at `https://s.nang.io`.

## Backend — systemd on a Tailscale host

- Host: `shade` (Tailscale, `100.71.181.113`); API at `https://shade-api.nang.io` behind Cloudflare.
- Provisioning: `deploy/setup-server.sh` (also `setup-mini.sh` for the Mac mini) — installs Bun, MongoDB 7, Node 22; runs as system user `shade` from `/opt/shade/src/backend/`. A binary deployment variant exists (`shade-backend.service.binary`).
- Bootstrap secrets in `/opt/shade/.env`: `ANTHROPIC_API_KEY`, `TOKEN_SECRET`, `REFRESH_TOKEN_SECRET`, `MONGO_URI` — everything else comes from `AppConfig` in Mongo.
- Env templates in `config/` (`shade-backend.env.example`, `shade-worker.env.example`).

## Watchdog

`deploy/shade-watchdog.sh` (as `shade-watchdog.service`) polls `GET /health` and `GET /health/slack`; on failure it restarts `shade-backend.service`, with a restart cooldown and an hourly restart cap. This is the only supervision layer — there is no in-process watchdog.

## Dev workflow

```bash
cd backend && bun run dev    # backend on :4020
cd frontend && bun run web   # web frontend
cd frontend && bun run sdk   # regenerate SDK after backend API changes
```
