# Implementation Plan: Trivia Group

**Status:** Open
**Priority:** Medium
**Effort:** Small batch (1-2 days)
**IP:** IP-005

Consolidate all trivia-related runtime state and configuration behind a dedicated `Group` document ("the trivia group"). The trivia group is the single command surface for trivia: only the configured owner's messages are accepted, and its outputs fan out to a configurable list of broadcast targets (other groups / channels) instead of the current single `groupId` + two webhooks.

## Background & Current State

The codebase already merged the former `TriviaAutoSearch` into `TriviaMonitor` (`backend/src/orchestrator/services/triviaMonitor.ts` lines 1-28). So "merge the services" is already done — this IP is really about **scope + addressing**, not consolidation.

Currently:
- **Config:** `AppConfig.triviaMonitor { enabled, groupId, allowedUserIds[], questionsWebhook, answersWebhook }` plus top-level `triviaResearchSystemPrompt` plus `AppConfig.triviaStats` (scraping-only, used by `scripts/scrapeScores.ts`).
- **Command surface:** `!trivia on|off|status|<question>` via `TriviaMonitor.handleChatMessage` — accepts the command from **any** group so long as the sender's external id is in `triviaMonitor.allowedUserIds` (`triviaMonitor.ts` line 240).
- **Outputs:** Single group via `ChannelManager.sendMessageToGroup(triviaMonitor.groupId, …)` + up to two fire-and-forget JSON webhooks.
- **No ownership concept:** There is no user-scoped "owner" across the app. `allowedUserIds` is only consulted by `!trivia` command gating, not by the research output path.

## Goals

1. There is **one** trivia `Group` document. All trivia runtime/config lookups key off that group.
2. Chat commands only work when issued **in** the trivia group's own channel, **and** the sender is the configured owner.
3. Outputs (questions, answers, research) fan out to a **list** of broadcast targets. Each target is an existing `Group` so we inherit Slack/webhook/iMessage transport, plus per-target filters (questions / answers / research).
4. Backwards-compatible rollout: old `AppConfig.triviaMonitor.{groupId,questionsWebhook,answersWebhook}` still works for one release via automatic translation into the new shape.

## Models

### New: `Group.triviaConfig` subdocument (optional)

Stored on the `Group` document itself — because "move all trivia stuff into the trivia group" is the ask. A group with `triviaConfig` set is the trivia group.

```ts
interface GroupTriviaConfig {
  enabled: boolean;                   // master on/off (replaces triviaMonitor.enabled)
  ownerUserId: string;                // required — Mongo User._id of the only person who can issue commands
  ownerExternalIds: string[];         // external ids of that user across channels (slack uid, iMessage handle, etc.)
  broadcastTargets: Array<{
    groupId: mongoose.Types.ObjectId; // destination group (any channel/transport)
    includeQuestions: boolean;        // default true
    includeAnswers: boolean;          // default true
    includeResearch: boolean;         // default true
    label?: string;                   // human-readable, admin UI only
  }>;
  // Optional: keep legacy webhook support but inside the trivia group doc.
  legacyWebhooks?: {
    questions?: string;
    answers?: string;
  };
}
```

Invariants:
- **At most one Group** may have `triviaConfig` set. Enforced with a partial unique index: `{ "triviaConfig.enabled": 1 }` sparse + validated in a pre-save hook that counts other trivia-enabled groups.
- `ownerUserId` must reference a real User (validated on save).
- `broadcastTargets[*].groupId` must resolve to an existing Group; can include the trivia group itself (to echo into the command channel).

### New: `AppConfig.triviaGroupId` pointer (optional string)

Convenience pointer so services don't have to scan all groups at boot. Falls back to `Group.findOneOrNone({ "triviaConfig.enabled": { $exists: true } })` if unset.

### Deprecated (kept for one release)

- `AppConfig.triviaMonitor.groupId`
- `AppConfig.triviaMonitor.questionsWebhook`
- `AppConfig.triviaMonitor.answersWebhook`
- `AppConfig.triviaMonitor.allowedUserIds`
- `AppConfig.triviaMonitor.enabled`

A boot-time adapter (`resolveTriviaGroup()`) reads the trivia group doc if present; otherwise it synthesizes an equivalent in-memory config from the legacy AppConfig fields and logs a `logger.warn` deprecation notice. The user-provided AppConfig admin screen is updated to show that these fields are deprecated.

### Unchanged

- `TriviaQuestion`, `TriviaScore` (separate trivia Mongo connection)
- `AppConfig.triviaResearchSystemPrompt` (still on AppConfig — it's a prompt, not a group-level setting)
- `AppConfig.triviaStats` (scraping scripts, unrelated)

## APIs

Rename the plugin to reflect it's now group-scoped and drop the legacy shape on next major:

### Updated routes on `TriviaMonitorPlugin` (`backend/src/api/triviaMonitor.ts`)

| Verb | Path | Behavior |
|---|---|---|
| `POST` | `/trivia/toggle` | Body `{enabled}`. Updates `group.triviaConfig.enabled` on the resolved trivia group instead of `AppConfig.triviaMonitor.enabled`. 404 if no trivia group configured. Permissions: `authenticateMiddleware` + owner check. |
| `POST` | `/trivia/ask` | Unchanged signature; `senderExternalId` is derived from `req.user._id.toString()` and must equal `triviaConfig.ownerUserId`. 403 if not owner. Still calls `handleChatMessage("!trivia …")`. |
| `GET` | `/trivia/status` | Returns `{enabled, groupId, ownerUserId, broadcastTargets[…], running}` from resolved trivia group. No longer returns webhook URLs as top-level fields. |
| `GET` (new) | `/trivia/group` | Returns full resolved `triviaConfig` for the admin screen. |
| `PATCH` (new) | `/trivia/group` | Edit `triviaConfig` fields. Admin-only. Validates `ownerUserId` and broadcast target ids. |

Existing `modelRouter` CRUD on `Group` already covers create/read/update — trivia-specific endpoints are only for the owner-operated admin screen.

### Existing endpoints not changed

- `scripts/scrapeScores.ts`, `AppConfig.triviaStats` path — untouched.

## Notifications

No new push/email notifications. The "broadcast targets" concept already routes through `ChannelManager.sendMessageToGroup`, which uses the existing Slack / webhook / iMessage connectors. Adding a new Slack target is a matter of creating a Group pointing at that channel and adding it to `triviaConfig.broadcastTargets`.

## UI

Admin-only. Adds a new panel under `frontend/app/(tabs)/admin/` — the user is already editing the admin routes in this working tree, so the pattern is in place.

1. **AppConfig admin screen** (`(tabs)/admin/[model].tsx` for `AppConfig`): deprecation banner on the `triviaMonitor.*` fields pointing to the new Trivia Group screen.
2. **Trivia Group screen** (new): `/admin/trivia`:
   - Select which group is the trivia group (dropdown of existing groups).
   - Set `ownerUserId` (user picker) and `ownerExternalIds[]` (chip input).
   - `broadcastTargets` editor: table with columns `Group`, `Questions`, `Answers`, `Research`, `Label`, `Remove`; add row via group picker.
   - Toggle `enabled`.
   - Read-only "Status" card showing polling running/stopped, pending question count (from `GET /trivia/status`).
3. **Group detail screen**: if a group has `triviaConfig`, show a "Trivia Group" badge and link to the Trivia Group screen.

States: loading (skeleton in each card), empty (no trivia group configured → CTA to pick one), error (inline banner with retry).

## Phases

### Phase 1 — Model & config plumbing (no behavior change yet)

Ships the new shape alongside the old. `TriviaMonitor` still reads the legacy fields.

### Phase 2 — Service migration

`TriviaMonitor` reads from `triviaConfig` via `resolveTriviaGroup()`. Legacy fields still work via the adapter. Owner-gating enforced.

### Phase 3 — Fan-out broadcasting

Replace single `postToGroup` + two webhooks with `broadcastTo(filter: 'questions'|'answers'|'research', message)` that iterates `triviaConfig.broadcastTargets`, honoring per-target `include*` flags. Legacy webhooks still fire when `legacyWebhooks` is set.

### Phase 4 — Admin UI

Trivia Group admin screen + deprecation banner on AppConfig screen.

### Phase 5 — Cleanup (next release only)

Remove deprecated AppConfig fields, drop webhook support, simplify `resolveTriviaGroup()`.

## Feature Flags & Migrations

- **No feature flag** needed — both shapes coexist via adapter.
- **One-shot migration script** (`backend/src/admin/scripts/migrateTriviaGroup.ts`): if a group exists whose `_id` matches `AppConfig.triviaMonitor.groupId`, populate its `triviaConfig` with the legacy values (owner pulled from `triviaMonitor.allowedUserIds[0]` if exactly one; otherwise leaves `ownerUserId` unset and logs a warning for manual review). Sets `AppConfig.triviaGroupId`. `wetRun`-gated per the existing admin ScriptRunner contract (`backend/src/admin/scripts/types.ts`).
- **Rollback:** drop `triviaConfig` from the group doc and clear `AppConfig.triviaGroupId`; legacy fields are still live.

## Activity Log & User Updates

- `logger.info` lines on: `TriviaGroup resolved`, `Trivia command accepted from <ownerUserId>`, `Trivia command rejected (non-owner <senderExternalId>)`, per-target broadcast result.
- No user-facing activity log surfaced beyond the status endpoint.

## Not Included / Future Work

- Multiple independent trivia groups (per-year, per-league). Enforced single via unique index.
- Per-target formatting (e.g. Markdown vs. plain) — broadcast uses the same string for all targets.
- Frontend "trivia player" view for scores — separate IP if desired.
- Migrating `AppConfig.triviaResearchSystemPrompt` onto the group doc — keeping it on AppConfig because it's shared and doesn't depend on group identity.

## Open Questions (decided as defaults; push back if wrong)

1. **Group doc vs AppConfig for trivia config:** chose group doc with AppConfig pointer. Rationale: matches user's phrasing ("move all the trivia related stuff into a trivia group") literally.
2. **Broadcast target granularity:** `{groupId, include{Q,A,R}}` per target. Rejected "list of raw channelId+externalId pairs" because we'd duplicate the transport/privileged-channel logic that `ChannelManager.sendMessageToGroup` already owns.
3. **Owner identity:** per-trivia-group `ownerUserId` + `ownerExternalIds[]`, not a global `AppConfig.owner`. Keeps the scope tight; a global owner concept can come later.
4. **Command scope:** commands only accepted when `inboundGroupId === triviaGroupId`. Rejected "route any-group commands to trivia logic" to avoid cross-group reply routing complexity.
5. **Legacy webhook retention:** kept on the group doc as `legacyWebhooks` for one release. Can be deleted post-migration.

---

## Task List

### Phase 1 — Models & config plumbing

- [ ] **Task 1.1**: Add `triviaConfig` to Group schema & types
  - Description: Extend `GroupFields` / `GroupSchema` with the optional `triviaConfig` subdocument defined above. Pre-save hook enforces "at most one group with `triviaConfig.enabled=true`". Validate `ownerUserId` exists and every `broadcastTargets[*].groupId` resolves.
  - Files: `backend/src/models/group.ts`, `backend/src/types/models/groupTypes.ts`
  - Depends on: none
  - Acceptance: `bun run test` passes; new unit test covers (a) saving a second trivia-enabled group fails, (b) invalid `ownerUserId` rejected, (c) invalid `broadcastTargets[*].groupId` rejected.

- [ ] **Task 1.2**: Add `AppConfig.triviaGroupId` pointer
  - Description: Optional string field on `AppConfig`. Defaulted to empty. Not hydrated into env.
  - Files: `backend/src/models/appConfig.ts`, `backend/src/types/models/appConfigTypes.ts`
  - Depends on: none
  - Acceptance: AppConfig loads with field defaulting to empty string; admin CRUD exposes the field.

- [ ] **Task 1.3**: `resolveTriviaGroup()` utility
  - Description: Reads `AppConfig.triviaGroupId` → fetches Group; falls back to `Group.findOneOrNone({ "triviaConfig.enabled": { $exists: true } })`; final fallback synthesizes a `triviaConfig` from legacy `AppConfig.triviaMonitor.*` (with `logger.warn` once per process). Returns `{groupDoc, triviaConfig, isLegacy}`.
  - Files: `backend/src/orchestrator/services/trivia/resolveTriviaGroup.ts` (new)
  - Depends on: 1.1, 1.2
  - Acceptance: Unit tests cover three resolution paths + legacy-synthesis branch; returns typed object.

### Phase 2 — Service migration

- [ ] **Task 2.1**: Route `TriviaMonitor.start/stop/poll` through `resolveTriviaGroup`
  - Description: Replace direct `config.triviaMonitor.enabled` / `.groupId` lookups with `resolveTriviaGroup()`. `start()` becomes a no-op if no trivia group + no legacy config.
  - Files: `backend/src/orchestrator/services/triviaMonitor.ts`
  - Depends on: 1.3
  - Acceptance: Existing startup logs still fire when legacy config is set; new integration test boots with a seeded trivia group and verifies polling starts.

- [ ] **Task 2.2**: Owner-gated command handling
  - Description: In `handleChatMessage`, accept command only if (a) `inboundGroupId === triviaGroup._id.toString()` AND (b) `senderExternalId ∈ triviaConfig.ownerExternalIds` OR `senderExternalId === triviaConfig.ownerUserId`. Reject with a debug log otherwise. Update the `messageLoop` call-site to pass the inbound group id (currently passes `""` in one path and the group id in another — make both pass the id).
  - Files: `backend/src/orchestrator/services/triviaMonitor.ts`, `backend/src/orchestrator/messageLoop.ts`
  - Depends on: 2.1
  - Acceptance: Unit tests for `handleChatMessage`: (1) allowed owner in trivia group passes, (2) allowed owner in other group rejected, (3) non-owner in trivia group rejected.

- [ ] **Task 2.3**: Rewire `/trivia/*` API endpoints
  - Description: `/trivia/toggle` writes to `group.triviaConfig.enabled`, `/trivia/ask` uses `req.user._id` string owner check, `/trivia/status` returns resolved-group data. Add `GET /trivia/group` and `PATCH /trivia/group`. `PATCH` validates shape with narrow type guards and uses `Model.findExactlyOne`.
  - Files: `backend/src/api/triviaMonitor.ts`
  - Depends on: 2.1, 2.2
  - Acceptance: API integration tests cover toggle, ask (owner + non-owner), status, group read/edit; OpenAPI SDK regen (`bun run sdk` in frontend) produces new types cleanly.

### Phase 3 — Fan-out broadcasting

- [ ] **Task 3.1**: `broadcastTo` helper on `TriviaMonitor`
  - Description: Replace `postToGroup` + `postToWebhook` with one private `broadcast(kind: "question"|"answer"|"research", message: string)`. Iterates `triviaConfig.broadcastTargets`, checks `include*` for `kind`, calls `channelManager.sendMessageToGroup(target.groupId, message)` and logs success/failure per target. If `triviaConfig.legacyWebhooks[kind]` is set, also POST there. Remove direct webhook URL lookup from AppConfig.
  - Files: `backend/src/orchestrator/services/triviaMonitor.ts`
  - Depends on: 2.1
  - Acceptance: Unit test with a mock `channelManager`: asserts the right targets receive the right kinds (e.g. `include={q:true, a:false, r:true}` target only gets Q and R).

- [ ] **Task 3.2**: Update call sites
  - Description: Replace every `postToGroup(...)` + pair of `postToWebhook("questions", …)` / `postToWebhook("answers", …)` call in `finalizePendingQuestions`, `handleAnswer`, `researchQuestion`, `processManualQuestion`, and the `!trivia on/off/status` handler so each one specifies its `kind`.
  - Files: `backend/src/orchestrator/services/triviaMonitor.ts`
  - Depends on: 3.1
  - Acceptance: Integration test drives a fake transcript through `poll()` with two broadcast targets (one questions-only, one research-only) and verifies each sees only its filtered output.

### Phase 4 — Migration & admin UI

- [ ] **Task 4.1**: One-shot migration script
  - Description: Admin script that populates `triviaConfig` on the group referenced by `AppConfig.triviaMonitor.groupId`. Owner is inferred if `triviaMonitor.allowedUserIds.length === 1`; otherwise the script logs a warning and leaves `ownerUserId` unset. Sets `AppConfig.triviaGroupId`. Honors the `wetRun` contract.
  - Files: `backend/src/admin/scripts/migrateTriviaGroup.ts` (new), register in `backend/src/admin/index.ts`
  - Depends on: 1.1, 1.2
  - Acceptance: Dry-run prints planned changes; wet-run creates the subdoc; running it twice is idempotent.

- [ ] **Task 4.2**: Trivia Group admin screen
  - Description: New route `/admin/trivia`. Uses generated SDK hooks for `GET/PATCH /trivia/group` and `GET /trivia/status`. Group picker, user picker, broadcast targets editor, legacy webhook inputs. `React.FC` + const arrow callbacks + inline styles per repo conventions.
  - Files: `frontend/app/(tabs)/admin/trivia.tsx` (new), `frontend/app/(tabs)/admin/index.tsx` (add link)
  - Depends on: 2.3
  - Acceptance: Screen loads, renders status, can add/remove targets, submit persists and reloads.

- [ ] **Task 4.3**: AppConfig deprecation banner + Group badge
  - Description: On the AppConfig admin screen, render a yellow banner on any field under `triviaMonitor.*` explaining the field is deprecated and linking to `/admin/trivia`. On Group detail, show a "Trivia Group" badge when `triviaConfig.enabled` is true.
  - Files: `frontend/app/(tabs)/admin/[model].tsx`, `frontend/app/(tabs)/admin/[model]/[id].tsx`
  - Depends on: 4.2
  - Acceptance: Banner shows on AppConfig; badge shows on group detail page.

### Phase 5 — Cleanup (deferred to follow-up IP)

- [ ] **Task 5.1**: Remove deprecated `AppConfig.triviaMonitor.*` fields
  - Description: After one release with no consumers of the legacy path, delete the fields from types/schema, drop the legacy branch from `resolveTriviaGroup`, drop `legacyWebhooks` support, remove the deprecation banner.
  - Files: `backend/src/models/appConfig.ts`, `backend/src/types/models/appConfigTypes.ts`, `backend/src/orchestrator/services/trivia/resolveTriviaGroup.ts`, `backend/src/orchestrator/services/triviaMonitor.ts`, `frontend/app/(tabs)/admin/[model].tsx`
  - Depends on: all prior phases shipped + at least one release window
  - Acceptance: Grep for `triviaMonitor.groupId|questionsWebhook|answersWebhook|allowedUserIds` returns zero backend hits.
