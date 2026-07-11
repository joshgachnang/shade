---
paths:
  - backend/**/*
  - deploy/**/*
---
# Deployment

## Single-artifact model

Everything deploys as **one self-contained bun executable** — `dist/shade`,
built by `./shade build` (`bun build --compile`) from `backend/src/index.ts`.
The `SHADE_SERVICE` env var selects what a process runs: `backend` (default),
`worker`, or `imessage` (edge agent). Adding a service = a case in
`backend/src/index.ts` + `ALL_SERVICES` in the `shade` CLI.

- Provision a machine: `./shade deploy [service...]` (env files in
  `~/.config/shade/`, launchd plists / systemd units, start)
- Update a machine: `./shade update <path-to-shade-executable>` (swap binary at
  `$SHADE_HOME/dist/shade`, restart installed services)
- CI publishes `shade-darwin-arm64` + `shade-linux-x64` to the `latest` release
- Agent runs from the executable use the host `claude` binary (override:
  `SHADE_CLAUDE_CODE_PATH`)

## Studio Mac (primary)

- **Host**: `NangStudio` (this Mac), launchd LaunchAgents `com.shade.backend`,
  `com.shade.worker`, `com.shade.imessage` (installed, opt-in)
- **Executable**: `~/Library/Application Support/Shade/dist/shade`
- **Data**: `~/Library/Application Support/Shade/data` (`SHADE_DATA_DIR`)
- **Env files**: `~/.config/shade/shade-{backend,worker,imessage}.env`
- **Logs**: `~/Library/Logs/Shade/` (`./shade logs backend`)
- **MongoDB**: local Homebrew instance, `mongodb://localhost:27017/shade`
- **Ports**: backend 4020, worker health 4021
- **CI**: push to master → `build-release.yml` publishes `shade.js` to the
  `latest` GitHub release → `deploy-studio.yml` runs on the self-hosted runner
  (`nangstudio`, labels `[self-hosted, macOS, studio]`, installed at
  `~/actions-runner`) and runs `./shade update`.

Caution: dev (`bun run dev`) against the same Mongo DB competes with the
running service for unprocessed messages. Use `bun run dev:test` (harness) or a
different `MONGO_URI` for local dev on this machine.

## Linux server (legacy)

- **API URL**: `https://shade-api.nang.io` (behind Cloudflare)
- **Server**: `shade` host on Tailscale (`100.71.181.113`), bun from
  `/opt/shade/src/backend/` as user `josh`, port 3000, env file
  `/opt/shade/backend.env`, local MongoDB
- Deployed source-based by `deploy-server.yml` (pinned to
  `[self-hosted, Linux]`)
- `ssh shade` to access; `deploy/setup-server.sh` provisions

## Frontend

- `https://s.nang.io`, deployed by Netlify (`netlify.toml`), not served by the
  backend.

## Scripts

- `backend/src/scripts/resetPassword.ts` — Reset a user's password: `MONGO_URI=<uri> bun run src/scripts/resetPassword.ts <email> <password>`
