# Implementation Plan: Zerg Sessions Dashboard

**Status:** Pending Verification
**Priority:** High
**Effort:** Small batch (1-2 days)
**IP:** IP-017

Shade acts as the orchestrator over zerg: it reads every session zerg knows about, what each one is doing, what stage a drone is at, and what is pending on a human, and surfaces that in chat (MCP tool), over the API, and on a "Sessions" console screen. Read-only — answering, approving, killing stay in zerg's own interface.

Builds on IP-017's sibling work already on master: `ZergAgentRunner` and `AppConfig.zerg` (`sshHost`, `command`, …) give Shade a working `ssh zerg zerg …` hop.

## Models

No persisted model. Sessions are read through from zerg on demand and held in a process-local cache (5 s TTL, single-flight) because `zerg dash` docker-execs into every container and costs ~2 s.

Normalized shapes (`backend/src/types/zergSessions.ts`):

```ts
interface ZergSessionRow {
  session: string;           // docker container, `<repo>-<feature>`
  tmux: string;              // `<repo>|<feature>`
  repo: string;
  feature: string;
  agent?: string;
  containerState: string;    // hive's row state: running | orphan-tmux | … | unknown
  activity: "working" | "blocked" | "idle" | "error" | "exited" | "dead" | "unknown";
  activitySince?: string;    // ISO, when the activity last changed
  activityAgeSeconds?: number;
  claudeSessionId?: string;
  stage?: string;            // drone stage from .terreno/pipeline (grow/pick/…), "-" when not a drone
  pr?: string;
  blockedOn?: string;
  verdict?: string;
  status?: string;           // swarm session status (running/killed/…)
  needsYou: boolean;
  needsYouWhy?: string;
  lastLine?: string;
  attachCommand: string;     // `<command> <attachVerb> <repo> <feature>`
}

interface ZergInboxItem {
  id?: string;
  session?: string;
  kind?: string;
  question?: string;
  recommendation?: string;
  options?: string[];
  filedAt?: string;
}

interface ZergDashboard {
  rows: ZergSessionRow[];    // needs-you first, then working, idle, rest
  inbox: ZergInboxItem[];
  summary: {running: number; cap?: number; needsYou: number; inboxPending: number};
  fetchedAt: string;
  source: "zerg" | "cache";
  error?: string;            // set when zerg was unreachable; rows may be stale or empty
}
```

The parser is tolerant: `zerg dash --json` may be a bare array of rows or an object with `rows`/`sessions`, `inboxPending`, `drones {running, cap}`; `hive ls --json` rows (no portfolio columns) are accepted and shown with `-` stage. Unknown fields are ignored, never fatal.

## APIs

- `GET /zerg/sessions` — authenticated. Returns `ZergDashboard`. `?refresh=1` bypasses the cache. `?repo=<name>` filters rows. Never 5xx on zerg being unreachable: returns `error` set with whatever the cache has (200), so the screen can show a banner instead of dying.
- No POST routes. No writes to zerg.

MCP tool `list_zerg_sessions({repo?, needsYouOnly?})` — text table: `SESSION  ACTIVITY  STAGE  PR  BLOCKED-ON  LAST`, needs-you rows first, followed by pending inbox items and the drone count/cap. Registered in `buildTools` via `buildZergTools(ctx)`. Gated on `AppConfig.zerg.enabled`.

System prompt: a short block (when `zerg.enabled`) telling the agent it orchestrates zerg sessions and to use `list_zerg_sessions` for "what's running / what's waiting on me" questions, and that container-mode groups are themselves zerg sessions.

## Notifications

None in this IP. (Watchers/pings are zerg's; a Shade-side "needs you" alert is future work.)

## UI

New sidebar item **Sessions** (`frontend/app/(tabs)/sessions.tsx`, route `sessions`, icon `cubes`), between Activity and Approvals.

States and testIDs:
- root `sessions-screen`; header with count summary `sessions-summary` ("3 running · 1 needs you · cap 12") and `sessions-refresh-button`.
- loading `sessions-loading`; unreachable banner `sessions-error-banner` (keeps stale rows visible); empty `sessions-empty-state` ("No zerg sessions").
- list `sessions-list`, rows `sessions-item-{session}` showing tmux name, activity badge (blocked/idle = needs you), stage, PR, blocked-on, last line, age, and the attach command `sessions-item-{session}-attach`.
- inbox section `sessions-inbox` with `sessions-inbox-item-{i}` (question, recommendation, options).

Data via `useListZergSessionsQuery` injected in `frontend/store/sdk.ts` (same pattern as Apple calendars), polling every 15 s while the screen is mounted.

## Phases

1. Backend: `AppConfig.zerg.dashVerb`/`inboxVerb`, `ZergSessionsService` (exec over ssh, parse, normalize, cache), unit tests with fake exec.
2. Surfaces: MCP tool + prompt block, `GET /zerg/sessions` plugin, route test.
3. Frontend: SDK hooks, Sessions screen, sidebar entry, QA cases + Playwright spec.

One PR.

## Feature Flags & Migrations

`AppConfig.zerg.enabled` gates the tool and the route (route returns an empty dashboard with `error: "zerg disabled"`). No migration: new AppConfig fields have defaults.

## Activity Log & User Updates

Fetches log at debug; a zerg failure logs at warn once per distinct error (not per poll).

## Not Included / Future Work

- Writes: attach/send/kill/answer/approve from Shade.
- Reading `hive serve`'s HTTP API (`https://zerg.nang.io/api/*`) instead of the CLI — same data, would remove the ssh dependency.
- Shade-side notifications on transitions into blocked/idle.
- Persisting session history.

## Assumptions

- `zerg dash --json` exists on the zerg host (approved zerg IP Task 6, 2026-09-24) and prints either an array of rows or `{rows|sessions, inboxPending, drones}`; the verbs are AppConfig-configurable so a different spelling is a config edit, not a deploy.
- `zerg inbox --json` may not exist yet; the service treats a non-zero exit or unparseable output as "no inbox data" and surfaces `inboxPending` from the dash document instead.
- Reads go through the same ssh hop as the runner (`AppConfig.zerg.sshHost`, default `zerg`).
- Console screen data is live (unlike the seeded console panes), so it follows the calendars screen pattern, not the console VM.

---

## Task List

See `docs/tasks/zerg-sessions-dashboard.md`.
