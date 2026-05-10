---
description: "Shade backend deployment and production infrastructure"
globs: ["backend/**/*", "deploy/**/*"]
---
# Deployment

## Production Infrastructure

- **API URL**: `https://shade-api.nang.io` (behind Cloudflare)
- **Frontend URL**: `https://s.nang.io`
- **Server**: `shade` host on Tailscale (`100.71.181.113`)
- **Process**: bun running from `/opt/shade/src/backend/` as user `josh`
- **MongoDB**: `mongodb://localhost:27017/shade` on the `shade` host (local to that server)
- **Port**: 3000 in production (proxied via Cloudflare)
- **Env file**: `/opt/shade/backend.env`

## Accessing Production

```bash
ssh shade                          # SSH into production server
ssh shade 'cd /opt/shade/src/backend && <command>'  # Run a command
```

## Deploy Files

- `deploy/setup-server.sh` — Initial server provisioning script
- `deploy/shade-backend.service` — Systemd service definition (not currently used; process runs directly via bun)

## Production MongoDB

The production MongoDB runs on the `shade` Tailscale host at `localhost:27017/shade`. There is also a separate MongoDB instance on the `mongo` Tailscale host (`100.110.63.100`) which is **not** the one used by the production API.

## Scripts

- `backend/src/scripts/resetPassword.ts` — Reset a user's password: `MONGO_URI=<uri> bun run src/scripts/resetPassword.ts <email> <password>`
