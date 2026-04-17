# Research: Shade Edge Agents

## Summary

Extract platform-specific integrations (iMessage, calendar, etc.) from the monolithic backend into small, independently deployable agents. Each agent is a compiled Bun binary that phones home to Shade for configuration and forwards data back.

## Decisions

1. **Zero-config registration**: Agents self-register on first boot. No pre-registration needed.
2. **Config scope**: Both secrets (API keys, credentials) and behavioral config (poll intervals, feature flags).
3. **Data flow**: Bidirectional via REST. Agents POST data to Shade, Shade sends commands to agents via REST.
4. **Agent updates**: Shade pushes new versions. GitHub builds produce binaries, Shade distributes them to agents.
5. **First agent**: iMessage (read + send). Design the framework around this first agent.

## Context

The Shade backend already has channel connectors running in-process:
- **iMessage** (`backend/src/orchestrator/channels/imessage.ts`) — JXA-based, requires macOS
- **Email** (`backend/src/orchestrator/channels/email.ts`) — IMAP/SMTP
- **Apple Calendar** (`backend/src/api/appleCalendar.ts`) — JXA, macOS-only
- **Apple Contacts** (`backend/src/api/appleContacts.ts`) — JXA, macOS-only

There's a `RemoteAgent` model already defined but not fully implemented — has `capabilities`, `status`, `connectionInfo`, and `authToken` fields.

## Findings

### What already exists
- `RemoteAgent` model (`backend/src/models/remoteAgent.ts`) — needs evolution
- Channel connectors have the logic we'd extract into agents
- `fleet-types` package demonstrates the shared-types-in-monorepo pattern
- Backend plugin system (`TerrenoApp.registerPlugin()`) for adding new API routes

### Bun compile specifics
- `bun build --compile --minify --bytecode` produces a single binary with 2x faster startup
- Assets embedded with `import x from "./file" with { type: "file" }`
- Cross-compilation: `--target=bun-linux-x64-modern`, `bun-darwin-arm64`, etc.
- Gotcha: dynamic imports and `__dirname` don't work — all files must be explicitly imported
- `.env` files ARE auto-loaded at runtime

### Bootstrap pattern
- Agent starts with only `SHADE_URL`
- On first boot: registers itself with Shade, gets back agent ID + auth token, writes to disk
- On subsequent boots: phones home with token, gets config
- Embedded fallback config for offline resilience
- Config polling on 30-60s interval with exponential backoff

### Service management
- macOS: launchd plist in `~/Library/LaunchAgents/` (user agents) or `/Library/LaunchDaemons/`
- Linux: systemd unit in `/etc/systemd/system/`
- Both support auto-restart, logging, environment variables

## Architecture Decision: REST over MCP

MCP is designed for tool discovery/invocation between LLMs and tool servers. These agents aren't LLMs — they're small daemons doing specific I/O tasks. REST is simpler, more debuggable, and sufficient. Commands from Shade to agents (like "send this message") use simple REST POST calls.

## References

- Existing iMessage connector: `backend/src/orchestrator/channels/imessage.ts`
- RemoteAgent model: `backend/src/models/remoteAgent.ts`
- Bun compile docs: https://bun.sh/docs/bundler/executables
- fleet-types package pattern: `packages/fleet-types/`
