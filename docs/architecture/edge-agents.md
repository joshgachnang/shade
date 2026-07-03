# Edge Agents

Remote daemons that extend Shade onto other machines (e.g. an always-on Mac mini relaying iMessage). Server side lives in `backend/src/edge/` + `backend/src/api/edgePlugin.ts`; client side in `packages/`.

## Lifecycle

```
register (bootstrap secret) → pending → admin approve → approved
        → heartbeat → online → (90s silence) offline → (5 min) error
```

- **Registration**: `POST /api/edge/register` with a bootstrap secret; creates an `EdgeAgent` doc in `pending` status.
- **Approval**: admin approves via `POST /api/edge/agents/:id/approve` (or the admin UI's EdgeAgent detail screen).
- **Heartbeat**: `POST /api/edge/heartbeat` — also returns queued commands for the agent to execute.
- **Config pull**: `GET /api/edge/config` — agent fetches its config and secrets (AES-256-GCM encrypted at rest, `edge/crypto.ts`; bearer tokens stored hashed).
- **Data push**: `POST /api/edge/data` — agent pushes inbound messages, channel requests, and events.
- **Health**: `edge/healthMonitor.ts` polls every minute and transitions stale agents offline → error; state changes are audited in `EdgeAgentEvent`.

## Workspace packages (`packages/`)

| Package | Purpose |
|---|---|
| `@shade/edge-agent-types` | Shared Zod types for the edge protocol |
| `@shade/edge-agent-core` | Core edge daemon runtime (register/heartbeat/command loop) |
| `@shade/edge-agent-imessage` | iMessage-specific edge agent for a device-bound Mac |
| `@shade/fleet-types` | Fleet/device management types |
| `@shade/worker` | Standalone Express background-job worker (`packages/shade-worker`) |

## Frontend

The admin UI has a dedicated EdgeAgent screen (`frontend/app/(tabs)/admin/edgeAgents/[id].tsx`) for approval, config, and monitoring.
