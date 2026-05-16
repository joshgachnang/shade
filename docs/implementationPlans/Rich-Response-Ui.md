# Implementation Plan: Rich Response UI

**Status:** Open
**Priority:** High
**Effort:** Big batch (1-2 weeks)
**IP:** IP-005

## Summary

Shade currently responds with plain strings on every channel. This IP introduces a versioned, Zod-validated `RichResponse` schema that lets the LLM emit structured cards (text, yes/no, weather, code, map, list, error, image, table) rendered as Slack Block Kit today, with a renderer registry that can later target `@terreno/ui` for in-app cards, e-ink screens, and full-screen dashboards.

The schema is the single source of truth. Slack is the first concrete renderer. Email, Webhook, and iMessage degrade to a `fallbackText` field. Button clicks round-trip back through Slack Socket Mode as synthetic inbound messages tagged with a `correlationId` so the LLM can resume context.

## Architectural corrections (from adversarial review)

These corrections override anything below if they conflict:

1. **IPC dispatch lives in `IpcWatcher.processIpcFile` (`backend/src/orchestrator/ipc.ts:226-262`), NOT `groupQueue.ts`.** The new payload type extends `IpcFile`; a new `setSendRichMessage` callback is wired in `orchestrator/index.ts`, mirroring the existing `setSendMessage`. `checkAuthorization` (`ipc.ts:184-224`) gets a parallel `targetGroupId === groupId` rule for the new type.
2. **`PRIVILEGED_ALLOWED_BACKENDS` enforcement must be replicated.** `ChannelManager.sendMessageToGroup` (`manager.ts:256-267`) blocks Claude-backed groups from posting to privileged channels (iMessage). The new `sendRichMessageToGroup` reproduces this gate. Without it, the rich path is a privilege-escalation hole.
3. **Double-send avoidance.** If the Agent SDK invokes both `send_message` and `respond_with_card` in the same run, the rich response wins: the IPC consumer dedupes by `(groupId, agent_run_id)` and drops the plain `send_message`. The system prompt also instructs the model to choose one or the other.
4. **Zod 4 `.merge` on discriminated-union members is unverified.** Phase 1 begins with a 30-min spike (Task 1.0). If `.merge(WithActions)` breaks the discriminator, fall back to inlining `actions` on each card schema.
5. **Type files must be updated alongside Mongoose schemas** because every model uses `strict: "throw"`. `messageTypes.ts`, `appConfigTypes.ts`, and `taskRunLogTypes.ts` change in lockstep with their `.ts` schemas.
6. **`buildSystemPrompt(groupFolder, fallback)` (`memory.ts:69`) signature changes.** It now accepts an `appConfig` argument (or loads it internally) so the structured-response block is conditional on `appConfig.richResponses.enabled`.
7. **`redactSecrets` lives in `security.ts:49-58` and currently substitutes env-var values, not URL patterns.** Mapbox-token redaction requires extending it with a URL-regex pass.
8. **Admin endpoints follow the `*Routes` export pattern** (see `appConfigRoutes`, `aiRequestRoutes`). `server.ts` imports the constant; no hand-rolled `app.post` mounts.
9. **The Slack action handler is registered at boot.** Disabling the feature flag at runtime does NOT unregister it. The handler body must read `appConfig.richResponses.enabled` and `ack()` + log + skip when false.
10. **Slack App manifest must have Interactivity enabled** (Socket Mode delivers `block_actions` over the websocket, but only if the manifest opt-in is present). Documented in Phase 3 rollout.

## Models

### Modified

**`backend/src/models/message.ts`** — add four optional fields:

```ts
richPayload:         {type: Schema.Types.Mixed, default: undefined},  // RichResponse JSON
correlationId:       {type: String, index: true},                      // nanoid(12) on every outbound bot Message
parentCorrelationId: {type: String, index: true},                      // inbound action: echoes parent
actionMetadata:      {type: Schema.Types.Mixed, default: undefined},   // {actionId, value}
```

No migration needed — fields are optional and existing documents load unchanged.

**`backend/src/models/appConfig.ts`** — two new sections:

```ts
richResponses: {
  enabled:       {type: Boolean, default: true},
  autoTruncate:  {type: Boolean, default: true},
},
maps: {
  mapboxAccessToken: {type: String, default: ""},
},
```

**`backend/src/models/taskRunLog.ts`** — observability for adoption:

```ts
richPayloadEmitted: {type: Boolean, default: false},
cardCount:          {type: Number, default: 0},
truncated:          {type: Boolean, default: false},
```

### New (not Mongoose — Zod schemas)

**`backend/src/orchestrator/responses/schema.ts`** — canonical schema:

```ts
import {z} from "zod";

export const SCHEMA_VERSION = "1" as const;

const SemanticColor = z.enum(["primary", "neutral", "success", "warning", "error", "info"]);
const ButtonStyle = z.enum(["primary", "danger", "default"]);

const Action = z.object({
  actionId: z.string().min(1).max(64),
  label:    z.string().min(1).max(75),
  style:    ButtonStyle.default("default"),
  value:    z.string().max(2000).optional(),
  url:      z.string().url().optional(),
});

const WithActions = z.object({actions: z.array(Action).max(5).optional()});

const TextCard    = z.object({kind: z.literal("text"),    markdown: z.string().min(1).max(3000)});
const YesNoCard   = z.object({
  kind:      z.literal("yes_no"),
  question:  z.string().min(1).max(500),
  yesLabel:  z.string().default("Yes").max(75),
  noLabel:   z.string().default("No").max(75),
  actionId:  z.string().min(1).max(64),
});
const WeatherCard = z.object({
  kind:          z.literal("weather"),
  location:      z.string().max(120),
  summary:       z.string().max(200),
  tempF:         z.number(),
  feelsLikeF:    z.number().optional(),
  highF:         z.number().optional(),
  lowF:          z.number().optional(),
  precipChance:  z.number().min(0).max(1).optional(),
  windMph:       z.number().optional(),
  iconUrl:       z.string().url().optional(),
});
const CodeCard = z.object({
  kind:     z.literal("code"),
  language: z.string().max(32).default("text"),
  code:     z.string().min(1).max(4000),
  caption:  z.string().max(200).optional(),
});
const MapCard = z.object({
  kind:      z.literal("map"),
  latitude:  z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  zoom:      z.number().min(0).max(22).default(13),
  markers:   z.array(z.object({
    lat:   z.number(),
    lng:   z.number(),
    label: z.string().max(40).optional(),
    color: SemanticColor.optional(),
  })).max(20).default([]),
  caption:   z.string().max(200).optional(),
});
const ListCard = z.object({
  kind:  z.literal("list"),
  title: z.string().max(120).optional(),
  items: z.array(z.object({
    title:    z.string().min(1).max(120),
    subtitle: z.string().max(200).optional(),
    badge:    z.object({label: z.string().max(40), color: SemanticColor.default("neutral")}).optional(),
    onPress:  Action.optional(),
  })).min(1).max(10),
});
const ErrorCard = z.object({
  kind:    z.literal("error"),
  message: z.string().min(1).max(500),
  detail:  z.string().max(2000).optional(),
});
const ImageCard = z.object({
  kind:        z.literal("image"),
  url:         z.string().url(),
  altText:     z.string().min(1).max(200),
  caption:     z.string().max(200).optional(),
  aspectRatio: z.number().min(0.1).max(10).optional(),
});
const TableCard = z.object({
  kind:    z.literal("table"),
  title:   z.string().max(120).optional(),
  columns: z.array(z.string().max(60)).min(2).max(4),
  rows:    z.array(z.array(z.string().max(200))).min(1).max(20)
    .refine(rows => rows.every(r => r.length === rows[0].length),
      "All rows must have the same column count"),
});

export const Card = z.discriminatedUnion("kind", [
  TextCard.merge(WithActions),
  YesNoCard,
  WeatherCard.merge(WithActions),
  CodeCard.merge(WithActions),
  MapCard.merge(WithActions),
  ListCard.merge(WithActions),
  ErrorCard,
  ImageCard.merge(WithActions),
  TableCard.merge(WithActions),
]);

export const RichResponse = z.object({
  v:            z.literal(SCHEMA_VERSION),
  cards:        z.array(Card).min(1).max(10),
  fallbackText: z.string().min(1).max(4000),
});

export type RichResponse = z.infer<typeof RichResponse>;
export type Card = z.infer<typeof Card>;
```

## APIs

### New custom endpoints

| Method | Path | Purpose | Permission |
|---|---|---|---|
| `POST` | `/orchestrator/preview-card` | Body: `RichResponse` JSON. Returns `{slackBlocks, fallbackText, validation, terrenoStub}`. Powers the admin preview page; used by integration tests. | `IsAdmin` |
| `GET`  | `/orchestrator/messages/:id/rich` | Returns Message + decoded `richPayload` + freshly rendered Slack blocks. | `IsAdmin` |

### New MCP tool (LLM-facing)

`respond_with_card` registered in `backend/src/agentRunner/mcpServer.ts`. Input schema is `RichResponse.shape`. Body writes `{type: "rich_response", groupId, channelId, agentRunId, payload}` to the IPC directory.

The IPC consumer is `IpcWatcher` in `backend/src/orchestrator/ipc.ts` (NOT `groupQueue.ts`). Required edits:
- Add `IpcRichResponse` to the `IpcFile` union (`ipc.ts:53-59`).
- Add a `case "rich_response"` branch to `processIpcFile` (`ipc.ts:226-262`).
- Add a `setSendRichMessage(fn)` callback alongside `setSendMessage` (`ipc.ts:80-104`).
- Wire the callback in `backend/src/orchestrator/index.ts` to call `ChannelManager.sendRichMessageToGroup`.
- Extend `checkAuthorization` (`ipc.ts:184-224`) with a parallel `targetGroupId === groupId` rule for non-main groups emitting `rich_response`.

`agentRunId` lets `IpcWatcher` dedupe: if a `rich_response` and a `send_message` arrive with the same `agentRunId`, the rich one wins and the plain one is dropped with a debug log.

### Slack interactivity (no new HTTP route)

Handled via Socket Mode: `app.action(/^shade:.+$/)` attached inside `SlackConnector` constructor. No public HTTPS endpoint is required because `@slack/bolt` already opens a websocket. `await ack()` is the first line of the handler (Slack's 3-second window). The handler synthesizes an inbound `Message` and hands it to the orchestrator's normal inbound flow.

### `action_id` namespacing

Format: `shade:<groupId>:<correlationId>:<actionId>`. The handler validates that `body.channel.id` maps to the same `groupId` before processing — prevents cross-group action collisions.

## Notifications

No new push/email/in-app notification channels. The existing channels are the recipients of rich responses; Slack renders as Block Kit, the rest get `fallbackText`. `TaskRunLog.richPayloadEmitted` exposes adoption for the existing dashboard (shade-orchestrator).

## UI

### Admin preview screen (Phase 5)

`frontend/screens/admin/cardPreview.tsx` — JSON editor on the left, rendered preview on the right.
- TextField (monospace, multi-line) for pasting `RichResponse` JSON.
- Client-side Zod validation displaying errors inline (imports the same schema from `@terreno/ui` workspace if exposed, otherwise duplicates the schema file).
- "Render" button POSTs to `/orchestrator/preview-card`; response renders the Slack-block JSON as pretty-printed text and a list of validation errors.
- testIDs: `admin-card-preview-screen`, `admin-card-preview-input`, `admin-card-preview-render-button`, `admin-card-preview-output-slack`, `admin-card-preview-output-validation`.

### No end-user UI changes at v1

`@terreno/ui` renderer is explicitly scoped out (see Future Work). The schema is designed to map directly to `@terreno/ui` primitives later: `Card`/`Box`/`Heading`/`Text`/`Button`/`Image`/`Badge`.

## Phases

### Phase 0 — Schema spike *(30-min de-risk before Phase 1)*

0.1 Prove or disprove that `z.object(...).merge(WithActions)` works as a member of `z.discriminatedUnion("kind", […])` under Zod 4.3.6. If broken, switch to inlining the `actions` field directly on each `Card*` schema (more verbose; safe).

### Phase 1 — Schema + renderers + feature flag *(isolated, fully unit-testable)*

1.1 Zod schema (`responses/schema.ts`) + tests for all 9 card kinds (accept + reject malformed).
1.2 `truncate.ts` (10-card cap, trailing notice card).
1.3 `SlackBlockKitRenderer` for all 9 card kinds + golden-output tests.
1.4 `FallbackTextRenderer` + tests.
1.5 `pickRenderer` registry + `CardRenderer<TOutput>` interface.
1.6 `AppConfig.richResponses` + `AppConfig.maps` additions.
1.7 `Message` model field additions + load test for legacy documents.

### Phase 2 — LLM emits cards *(behind `appConfig.richResponses.enabled`)*

2.1 `respond_with_card` MCP tool.
2.2 IPC `rich_response` handler in `groupQueue.ts`.
2.3 `nanoid` correlationId on every outbound bot Message.
2.4 `promptBlock.ts` (JSON Schema + 3 examples) folded into `buildSystemPrompt`.
2.5 `SlackConnector.sendRichMessage` (uses `chat.postMessage` with `blocks` + `text` fallback).
2.6 ChannelConnector capability flag wired through Email/Webhook/iMessage (all `false`).
2.7 Integration test: stub MCP tool emits a `YesNoCard` → assert the expected `chat.postMessage` argument shape.

### Phase 3 — Interactivity round-trip

3.1 `app.action(/^shade:.+$/)` handler in `SlackConnector`.
3.2 Synthetic inbound Message with `parentCorrelationId` + `actionMetadata`.
3.3 `router.ts` XML formatter renders `<user_action actionId="..." value="..." parentCorrelationId="..."/>` for action messages.
3.4 End-to-end test: emit `YesNoCard` → simulate Slack action payload → assert orchestrator queues a follow-up agent run.

### Phase 4 — Mapbox Static

4.1 `mapStaticUrl(card)` builds a Mapbox Static API URL from `MapCard` + token from `AppConfig`.
4.2 If token missing: render `MapCard` as a `text` card with coordinates and a warning.
4.3 Test: token absent → text fallback; token present → URL well-formed and signed.

### Phase 5 — Admin preview + dashboard hooks

5.1 `POST /orchestrator/preview-card` endpoint.
5.2 `GET /orchestrator/messages/:id/rich` endpoint.
5.3 `frontend/screens/admin/cardPreview.tsx` with full testIDs.
5.4 `TaskRunLog.richPayloadEmitted/cardCount/truncated` fields + dashboard "Cards" column.
5.5 `bun run sdk` regenerates `openApiSdk.ts`; document this step in the task.

## Feature Flags & Migrations

### Feature flag

`AppConfig.richResponses.enabled` (default `true`) is the kill-switch. When `false`, `ChannelManager.sendRichMessageToGroup` calls `connector.sendMessage(response.fallbackText)` regardless of channel capability. The MCP tool stays registered so the LLM can keep emitting cards, but they degrade to `fallbackText` everywhere.

`AppConfig.richResponses.autoTruncate` (default `true`) controls overflow behavior:
- `true` → keep first 10 cards, log warning, append a final `text` card noting truncation.
- `false` → reject the payload with an `ErrorCard` so misuse surfaces immediately during development.

### Migrations

None required. All new Message fields are optional. The existing `Message.toJSON` returns existing fields when `richPayload` is undefined. Frontend SDK consumers see new optional fields after `bun run sdk` regenerates `openApiSdk.ts`.

### Rollout

1. Phase 1 lands first — schema + renderers are dead code, not wired into the response path. No user impact.
2. Phase 2 ships with `appConfig.richResponses.enabled = false` by default in production. Flip to `true` on a single dev Slack workspace, verify, then flip globally.
3. Phase 3 ships with action handler registered but inert until the LLM emits a card with buttons. Verify on dev workspace before broadcasting.
4. Phases 4 and 5 are additive — no behavior change to existing response path.

## Activity Log & User Updates

- `Message.richPayload` IS the activity record for what was rendered. The existing Message read endpoints (modelRouter) return it.
- `TaskRunLog.richPayloadEmitted/cardCount/truncated` exposes adoption metrics for the shade-orchestrator dashboard.
- Slack action clicks are logged twice: once as the synthesized inbound `Message` (with `parentCorrelationId`), and once as the resulting agent run in `TaskRunLog` (linked by `groupId` and `correlationId`).
- Logging via `logger` (from `@terreno/api`): `info` on successful render, `warn` on truncation/Mapbox-token-missing, `error` on Slack API failure with full block payload (after `redactSecrets`).

## Not Included / Future Work

- **`@terreno/ui` renderer.** Schema is designed for it; concrete implementation is a separate IP.
- **E-ink / static dashboard screens.** Requires the `@terreno/ui` renderer first.
- **App-card runtime** (running arbitrary cards in a sandboxed in-app surface).
- **HTML email renderer.** Email channel returns `fallbackText` only at v1.
- **Webhook structured payload.** Webhook channel returns `fallbackText` only at v1.
- **GFM markdown support.** `text` cards accept Slack mrkdwn subset only.
- **Slack modals / view submissions.** Only `block_actions` (button clicks) round-trip at v1.
- **Migrating `radioTranscriber.ts`** to the new renderer — it currently calls `chat.postMessage` directly with hand-built blocks. Audit-only follow-up.
- **Schema version migration tooling.** When `v` bumps past `"1"`, queued IPC files with old `v` are dropped with a warning.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| LLM emits malformed JSON for `respond_with_card` | Tool call fails | Zod validation at the MCP tool layer; on parse fail, tool returns `{isError: true}` and the LLM falls back to plain text in the same turn. |
| Slack 3-second action ack window | Action handler timeouts | `await ack()` is the first line of every handler; orchestrator work happens after. |
| Slack 50-block ceiling | Lost content | Hard-cap at 10 cards (≤5 blocks each = 50); warning log + trailing text card on truncation. |
| Mapbox token leak via logs | Credential exposure | `redactSecrets` (existing helper in `direct.ts`) extended to recognize Mapbox host/token pattern. |
| `action_id` collision across groups | Wrong group receives synthetic inbound | Namespaced `shade:<groupId>:<correlationId>:<actionId>`; handler validates `body.channel.id` resolves to the same group. |
| Schema version mismatch on deploy | Queued IPC files drop | IPC consumer warns + skips when `payload.v !== SCHEMA_VERSION`; deploy script purges stale IPC files. |
| LLM never uses `respond_with_card` | Feature ships dead | Admin preview tool + explicit examples in system prompt; observability via `TaskRunLog.richPayloadEmitted`. |
| LLM uses `respond_with_card` for everything | Worse latency/tokens | System-prompt rule: "If response is just prose, do NOT call respond_with_card." Monitor `cardCount` distribution. |
| Two paths to Slack (`radioTranscriber` already posts blocks directly) | Drift between renderers | Leave `radioTranscriber` untouched in this IP; flag for future migration. Its `action_id="listen_recording"` is a URL-typed button so it never fires `block_actions` — confirmed isolated from the new regex handler. |
| Email/Webhook/iMessage users lose context vs Slack | UX inequality | `fallbackText` is required by the schema (Zod `.min(1)`) — the LLM must always supply a useful plain-text version. |
| Zod 4 `.merge(WithActions)` on discriminated union members may break | Phase 1 rewrite mid-stream | Phase 0 spike confirms behavior before any other Phase 1 work. Fallback is inlining `actions` on each card schema. |
| Agent SDK emits both `send_message` and `respond_with_card` in one run | Duplicate user-visible message | IPC consumer dedupes by `agentRunId`; system prompt also forbids pairing the two. |
| Slack App manifest lacks Interactivity (Socket Mode delivery) | Button clicks silently no-op | Phase 3 rollout requires verifying the manifest toggle; documented in deploy/. |
| `MapCard` / `ImageCard` URL is unreachable or rejected by Slack | Silent failure / `invalid_blocks` API error | On Slack API error, renderer logs and re-sends as a `text` card with the caption and an "(image unavailable)" note. |
| System-prompt token cost (~1500 tokens of JSON Schema + examples per run) | Compounding API spend | Phase 2.4 asserts and documents the token count; future work may scope the block to groups that actually use rich responses. |
| Prompt injection via `value` in synthesized action inbound | LLM context tampering | Task 3.3 escapes every attribute through `escapeXml` — AC-24 covers this. |
| Schema duplicated between backend Zod and admin preview screen | Drift over time | Phase 5 admin preview re-uses the same `RichResponse` schema by importing from the backend package; a future `shade-shared` workspace is a noted follow-up, not a v1 requirement. |

---

## Task List

### Phase 1: Schema + renderers + feature flag

- [ ] **Task 1.1**: Add Zod schema with all 9 card kinds
  - Description: Create `backend/src/orchestrator/responses/schema.ts` per the schema definition above. Export `RichResponse`, `Card`, `SCHEMA_VERSION`, and TypeScript types.
  - Files:
    - Create: `backend/src/orchestrator/responses/schema.ts`
    - Create: `backend/src/orchestrator/responses/schema.test.ts`
  - Depends on: none
  - Acceptance: `bun test backend/src/orchestrator/responses/schema.test.ts` passes. Tests cover: (a) one valid example per card kind, (b) one invalid example per card kind (missing required field, wrong type, exceeded length), (c) discriminated union rejects unknown `kind`, (d) `fallbackText` required, (e) `cards` max of 10 enforced.

- [ ] **Task 1.2**: Implement truncation helper
  - Description: Create `truncate.ts` exporting `truncateRichResponse(input: RichResponse, opts: {autoTruncate: boolean}): RichResponse`. When length > 10 and `autoTruncate=true`, keep first 10 and append a trailing `text` card noting the truncation. When `autoTruncate=false`, replace cards with a single `ErrorCard`.
  - Files:
    - Create: `backend/src/orchestrator/responses/truncate.ts`
    - Create: `backend/src/orchestrator/responses/truncate.test.ts`
  - Depends on: 1.1
  - Acceptance: Tests cover exactly 10, 11, and 25 cards; both `autoTruncate` values; trailing notice card is well-formed.

- [ ] **Task 1.3**: Implement Slack Block Kit renderer
  - Description: Create `SlackBlockKitRenderer` rendering all 9 card kinds to `KnownBlock[]`. Output type is `{blocks: KnownBlock[]; text: string}`. Empty actions arrays should be omitted entirely. Each action's `action_id` is templated `__shade__:__GROUP__:__CORR__:<actionId>` — placeholder substitution happens later in 2.5.
  - Files:
    - Create: `backend/src/orchestrator/responses/renderers/types.ts` (interface + `CardRenderer<TOutput>`)
    - Create: `backend/src/orchestrator/responses/renderers/slack.ts`
    - Create: `backend/src/orchestrator/responses/renderers/slack.test.ts`
  - Depends on: 1.1
  - Acceptance: Golden-output tests pass for one input per card kind. Block count stays ≤ 50 across the max payload (10 cards × ≤5 blocks).

- [ ] **Task 1.4**: Implement fallback text renderer
  - Description: Create `FallbackTextRenderer` that returns `{text: response.fallbackText}` ignoring cards. Used for Email/Webhook/iMessage.
  - Files:
    - Create: `backend/src/orchestrator/responses/renderers/fallback.ts`
    - Create: `backend/src/orchestrator/responses/renderers/fallback.test.ts`
  - Depends on: 1.3
  - Acceptance: Renderer returns `fallbackText` verbatim regardless of card content.

- [ ] **Task 1.5**: Renderer registry
  - Description: Create `renderers/index.ts` exporting `pickRenderer(channelType: ChannelType): CardRenderer<unknown>`. Slack → SlackBlockKitRenderer; email/webhook/imessage → FallbackTextRenderer; future → TerrenoRenderer stub that throws.
  - Files:
    - Create: `backend/src/orchestrator/responses/renderers/terreno.ts` (stub)
    - Create: `backend/src/orchestrator/responses/renderers/index.ts`
    - Create: `backend/src/orchestrator/responses/renderers/index.test.ts`
  - Depends on: 1.3, 1.4
  - Acceptance: Tests assert the right renderer instance is returned per channel type and that `TerrenoRenderer.render` throws with a "not implemented in v1" message.

- [ ] **Task 1.6**: AppConfig additions
  - Description: Add `richResponses` and `maps` sections to `AppConfig` schema. Cache invalidation is already handled by the existing `.post("save")` and `.post("findOneAndUpdate")` hooks. Because the schema uses `strict: "throw"`, the matching TypeScript interface must be updated in lockstep.
  - Files:
    - Modify: `backend/src/models/appConfig.ts`
    - Modify: `backend/src/types/models/appConfigTypes.ts` (add `richResponses` and `maps` to the `AppConfigFields` interface)
    - Modify: `backend/src/models/appConfig.test.ts` (or create if absent)
  - Depends on: none
  - Acceptance: `loadAppConfig()` returns documents with the new sections populated by defaults. Mutating either section invalidates the cache. TypeScript compiles without `as any` casts.

- [ ] **Task 1.7**: Message model field additions
  - Description: Add `richPayload`, `correlationId`, `parentCorrelationId`, `actionMetadata` to `Message`. Index `correlationId` and `parentCorrelationId`. Schema uses `strict: "throw"` so the interface must be updated in lockstep.
  - Files:
    - Modify: `backend/src/models/message.ts`
    - Modify: `backend/src/types/models/messageTypes.ts` (add the four new fields to `MessageFields`)
    - Create or modify: `backend/src/models/message.test.ts`
  - Depends on: none
  - Acceptance: New Message documents save with all four fields. Existing documents (loaded via fixture without these fields) hydrate without errors. `Message.create` typechecks with the new fields.

### Phase 2: LLM emits cards

- [ ] **Task 2.1**: Register `respond_with_card` MCP tool
  - Description: Add the tool to `buildTools` in `mcpServer.ts`. Input schema = `RichResponse.shape`. Body writes IPC file `{type: "rich_response", groupId, channelId, payload}`. Returns text confirmation.
  - Files:
    - Modify: `backend/src/agentRunner/mcpServer.ts`
    - Modify: `backend/src/agentRunner/mcpServer.test.ts` (or create)
  - Depends on: 1.1
  - Acceptance: Tool registered; Zod validates input; valid payload writes an IPC file with the expected envelope; invalid payload returns `{isError: true, content: [text describing the validation failure]}`.

- [ ] **Task 2.2**: IPC `rich_response` handler + authorization + privileged-channel gate
  - Description: Extend `IpcWatcher` (the real IPC dispatcher, not `groupQueue.ts`) with the new payload type, the dispatch branch, the authorization rule, and a new callback setter.
    - Add `IpcRichResponse` to the `IpcFile` union at `ipc.ts:53-59`.
    - Add `setSendRichMessage(fn)` setter to `IpcWatcher` (`ipc.ts:80-104`).
    - Add `case "rich_response"` to `processIpcFile` (`ipc.ts:226-262`); the handler validates `payload` with `RichResponse.parse`, applies `truncateRichResponse`, then calls the registered callback.
    - Extend `checkAuthorization` (`ipc.ts:184-224`): non-main groups may only target their own `groupId`, parallel to `send_message`.
    - Implement `ChannelManager.sendRichMessageToGroup(groupId, payload, opts: {threadTs?})` (`channels/manager.ts`). Reuse the `PRIVILEGED_ALLOWED_BACKENDS` gate from `sendMessageToGroup` (`manager.ts:256-267`) — Claude-backed groups must not post rich payloads to privileged channels.
    - Wire `setSendRichMessage` in `backend/src/orchestrator/index.ts` to `channelManager.sendRichMessageToGroup`.
    - Deduplication: if a `rich_response` and a `send_message` arrive sharing `agentRunId`, the rich one wins; drop the plain `send_message` with a debug log.
  - Files:
    - Modify: `backend/src/orchestrator/ipc.ts`
    - Modify: `backend/src/orchestrator/index.ts` (wire the setter)
    - Modify: `backend/src/orchestrator/channels/manager.ts` (add `sendRichMessageToGroup`)
    - Create: `backend/src/orchestrator/ipc.test.ts` (or extend if exists)
  - Depends on: 1.1, 1.2, 1.5, 2.1
  - Acceptance: IPC file with `type: "rich_response"` triggers `sendRichMessageToGroup`. Invalid payloads parsed by Zod produce a warning log and skip the file. Non-main group targeting another group is rejected by `checkAuthorization`. Claude-backed group targeting a privileged channel is rejected by the backend gate. Co-arriving plain `send_message` with same `agentRunId` is dropped.

- [ ] **Task 2.3**: nanoid correlationId on every outbound bot Message
  - Description: In `ChannelManager.sendMessageToGroup` and `sendRichMessageToGroup`, generate `correlationId = nanoid(12)` and persist on the Message. No other behavior change.
  - Files:
    - Modify: `backend/src/orchestrator/channels/manager.ts`
    - Modify: `package.json` (add `nanoid` dep if missing)
  - Depends on: 1.7
  - Acceptance: All Message documents created after this change carry a 12-char `correlationId`. Verify with a unit test that creates a Message via the manager.

- [ ] **Task 2.4**: System prompt structured-response block
  - Description: Create `promptBlock.ts` exporting `richResponseSystemPromptBlock()` returning a string with: (a) one-paragraph intro, (b) the JSON Schema for `RichResponse` (via `zod-to-json-schema`), (c) three worked examples (yes_no, weather, code), (d) explicit rules: "If response is just prose, do NOT call respond_with_card" AND "Never call both `send_message` and `respond_with_card` in the same response — choose one." Fold into `buildSystemPrompt`. Note that `buildSystemPrompt(groupFolder, fallback)` currently takes no flag and does not read AppConfig (`memory.ts:69`); extend it to accept the AppConfig (or load it internally) so the block is conditional on `appConfig.richResponses.enabled`. Update the caller in `groupQueue.ts:155-158` accordingly.
  - Files:
    - Create: `backend/src/orchestrator/responses/jsonSchema.ts`
    - Create: `backend/src/orchestrator/responses/promptBlock.ts`
    - Create: `backend/src/orchestrator/responses/promptBlock.test.ts`
    - Modify: `backend/src/orchestrator/memory.ts` (signature change)
    - Modify: `backend/src/orchestrator/groupQueue.ts` (pass appConfig through)
    - Modify: `backend/package.json` (add `zod-to-json-schema`)
  - Depends on: 1.1, 1.6
  - Acceptance: Snapshot test on `richResponseSystemPromptBlock()` is stable. `buildSystemPrompt` includes the block when `appConfig.richResponses.enabled === true` and omits it when `false`. Token count of the rendered block is asserted in the test and documented as a comment (target: < 1500 tokens).

- [ ] **Task 2.5**: `SlackConnector.sendRichMessage` + thread plumbing
  - Description: Add `sendRichMessage(externalId, rendered: RenderedRichMessage, opts: {groupId, correlationId, threadTs?})` to `SlackConnector`. Substitutes the `__shade__:__GROUP__:__CORR__:` placeholders in `action_id`s with the real `groupId` and `correlationId`. Asserts the final `action_id` is ≤ 255 chars (Slack limit). Calls `app.client.chat.postMessage({channel, text: rendered.text, blocks: rendered.blocks, thread_ts: opts.threadTs})`. Set `supportsRichMessages = true`.
  - Thread context: the existing `chat.postMessage` calls (`slack.ts:200-204`, `219-223`) do NOT pass `thread_ts` today. To make `threadTs` actually work, plumb the triggering message's `threadTs` from the agent run through to the IPC payload, then through `ChannelManager.sendRichMessageToGroup` → `connector.sendRichMessage`. Source of `threadTs` is the inbound `metadata.threadTs` captured at `slack.ts:82,116`.
  - Files:
    - Modify: `backend/src/orchestrator/channels/slack.ts`
    - Modify: `backend/src/orchestrator/channels/types.ts` (capability flag + optional method)
    - Modify: `backend/src/agentRunner/mcpServer.ts` (carry `threadTs` from `McpContext` into the IPC payload)
    - Modify: `backend/src/orchestrator/groupQueue.ts` (set `messageTs`/`threadTs` on `McpContext`)
    - Modify: `backend/src/orchestrator/channels/manager.ts` (accept and forward `threadTs`)
    - Modify: `backend/src/orchestrator/channels/slack.test.ts` (or create)
  - Depends on: 1.3, 1.5, 2.2
  - Acceptance: Unit test asserts the `chat.postMessage` call shape (blocks + text + thread_ts). `action_id`s are namespaced and total length ≤ 255. Existing `sendMessage` path is unchanged. Test confirms `threadTs` flows from the inbound message through to the outbound rich post.

- [ ] **Task 2.6**: Non-Slack channel capability flags
  - Description: Set `supportsRichMessages = false` on `EmailConnector`, `WebhookConnector`, `iMessageConnector`. `ChannelManager.sendRichMessageToGroup` falls back to `connector.sendMessage(fallbackText)` for these.
  - Files:
    - Modify: `backend/src/orchestrator/channels/email.ts`
    - Modify: `backend/src/orchestrator/channels/webhook.ts`
    - Modify: `backend/src/orchestrator/channels/imessage.ts`
    - Modify: `backend/src/orchestrator/channels/manager.test.ts` (or create)
  - Depends on: 2.2
  - Acceptance: Tests assert that a rich response sent to a non-Slack group results in a `sendMessage(fallbackText)` call and a Message with `richPayload` populated (for audit).

- [ ] **Task 2.7**: End-to-end happy path test (no interactivity yet)
  - Description: Integration test: stub `DirectAgentRunner` to invoke the `respond_with_card` MCP tool with a `YesNoCard` payload. Assert that the orchestrator writes the IPC file, processes it, persists a Message with `richPayload`, and calls `SlackConnector.sendRichMessage` with the expected blocks.
  - Files:
    - Create: `backend/src/orchestrator/responses/e2e-happy-path.test.ts`
  - Depends on: 2.1, 2.2, 2.3, 2.5
  - Acceptance: Test passes.

- [ ] **Task 2.8**: Feature-flag-off integration test
  - Description: With `appConfig.richResponses.enabled = false`, simulate the LLM calling `respond_with_card` with a valid payload. Assert that `connector.sendRichMessage` is NOT called; instead `connector.sendMessage` is called with `fallbackText` only. Message is still persisted with `richPayload` for audit (so when the flag flips back on, history is consistent).
  - Files:
    - Create: `backend/src/orchestrator/responses/e2e-flag-off.test.ts`
  - Depends on: 2.2, 2.5, 2.6
  - Acceptance: Test passes. No `chat.postMessage` call contains `blocks`.

### Phase 3: Interactivity round-trip

- [ ] **Task 3.1**: Slack action handler (with runtime flag check)
  - Description: In `SlackConnector` constructor, register `app.action(/^shade:.+$/, …)`. First line: `await ack()` (Slack 3s window). Then read `appConfig.richResponses.enabled` at handler-call time; if `false`, log and return. Otherwise parse `action_id` as `shade:<groupId>:<correlationId>:<actionId>`, validate `body.channel.id` resolves to the same group (reject mismatched), and synthesize an inbound Message via the connector's existing `onInboundMessage` callback. Sanity-check `value` length (≤ 2000 per schema) before forwarding.
  - Files:
    - Modify: `backend/src/orchestrator/channels/slack.ts`
    - Modify: `backend/src/orchestrator/channels/slack.test.ts`
  - Depends on: 2.5
  - Acceptance: Tests cover: (a) flag on → synthesized message has `parentCorrelationId`, `actionMetadata`, content `[user_action <id>=<value>]`; (b) flag off → handler ack()s and returns, no message persisted; (c) groupId mismatch → handler ack()s, logs warning, no message persisted.

- [ ] **Task 3.2**: Persist action-driven inbound Message correctly
  - Description: Confirm `ChannelManager.handleInboundMessage` persists `parentCorrelationId` and `actionMetadata` (extend the inbound path if not).
  - Files:
    - Modify: `backend/src/orchestrator/channels/manager.ts`
    - Modify: `backend/src/orchestrator/channels/manager.test.ts`
  - Depends on: 3.1, 1.7
  - Acceptance: Test asserts the persisted Message has `parentCorrelationId` and `actionMetadata` set, and `isFromBot = false`.

- [ ] **Task 3.3**: Router XML formatter for action messages
  - Description: Extend `formatMessagesAsXml` in `router.ts:25-38` to render action-typed messages as `<user_action actionId="..." value="..." parentCorrelationId="..."/>` instead of the generic `<message>` element. Every attribute value MUST pass through the existing `escapeXml` helper (`router.ts:11-18`) to prevent prompt injection via crafted `value` strings (e.g., `"></user_action><system>…`).
  - Files:
    - Modify: `backend/src/orchestrator/router.ts`
    - Modify: `backend/src/orchestrator/router.test.ts` (or create)
  - Depends on: 3.2
  - Acceptance: Snapshot test on a fixture conversation including an action message produces the expected XML. Test with `value = "\"></user_action><foo>"` confirms metacharacters are escaped.

- [ ] **Task 3.4**: End-to-end interactivity test
  - Description: Stub agent emits a `YesNoCard`; simulate a Slack action payload arriving via the action handler; assert that the orchestrator schedules a follow-up agent run with the action visible in the prompt context.
  - Files:
    - Create: `backend/src/orchestrator/responses/e2e-interactivity.test.ts`
  - Depends on: 3.1, 3.2, 3.3
  - Acceptance: Test passes.

### Phase 4: Mapbox Static

- [ ] **Task 4.1**: Mapbox URL helper
  - Description: Add `mapStaticUrl(card: MapCard, opts: {token: string}): string` building a Mapbox Static API URL. Markers serialize as `pin-s+<color-hex>(lng,lat)` overlay segments. Width/height default to 600x400.
  - Files:
    - Create: `backend/src/orchestrator/responses/mapbox.ts`
    - Create: `backend/src/orchestrator/responses/mapbox.test.ts`
  - Depends on: 1.1
  - Acceptance: Test asserts URL structure for 0, 1, and 20 markers; URL is well-formed.

- [ ] **Task 4.2**: Wire Mapbox into SlackBlockKitRenderer
  - Description: `MapCard` rendering reads `AppConfig.maps.mapboxAccessToken`. If absent, render as a `text` card with `"Map: (lat, lng), zoom N"` and log a warning. If present, render as a Slack `image` block with the Mapbox URL.
  - Files:
    - Modify: `backend/src/orchestrator/responses/renderers/slack.ts`
    - Modify: `backend/src/orchestrator/responses/renderers/slack.test.ts`
  - Depends on: 4.1, 1.6
  - Acceptance: Tests cover token absent (text fallback) and token present (image block URL well-formed).

- [ ] **Task 4.3**: Redact Mapbox token in logs
  - Description: Extend `redactSecrets` at `backend/src/orchestrator/security.ts:49-58` (NOT in `direct.ts`). The current implementation does value-substitution from `SENSITIVE_ENV_VARS` only — it has no regex pass. Add a URL-regex stage that matches `(api\.mapbox\.com[^?\s]*\?[^&\s]*&?)?access_token=([^&\s]+)` and rewrites the token to `<redacted>`. Keep the env-var pass intact.
  - Files:
    - Modify: `backend/src/orchestrator/security.ts`
    - Create or modify: `backend/src/orchestrator/security.test.ts`
  - Depends on: 4.1
  - Acceptance: Test asserts a Mapbox URL containing `access_token=pk.eyJ...` is rewritten to `access_token=<redacted>` while non-Mapbox URLs and the existing env-var substitution behavior are preserved.

### Phase 5: Admin preview + dashboard hooks

- [ ] **Task 5.1**: `POST /orchestrator/preview-card` endpoint
  - Description: Accepts `RichResponse` JSON body, validates with Zod, returns `{slackBlocks, fallbackText, validation: null | ZodError[]}`. Follow the existing `*Routes` export pattern — every other API route in `server.ts:5-30` (e.g., `appConfigRoutes`, `aiRequestRoutes`) is a `Router` exported from `backend/src/api/<name>.ts` and registered in `server.ts`. Permission via `Permissions.IsAdmin` from `@terreno/api` (same as `aiRequestRoutes`).
  - Files:
    - Create: `backend/src/api/orchestratorPreview.ts` (exports `orchestratorPreviewRoutes`)
    - Modify: `backend/src/server.ts` (import + register the route constant alongside the others)
    - Create: `backend/src/api/orchestratorPreview.test.ts`
  - Depends on: 1.3, 1.5
  - Acceptance: Valid payload returns blocks; invalid payload returns 400 with structured `validation` errors. Authenticated non-admin returns 403. Anonymous returns 401.

- [ ] **Task 5.2**: `GET /orchestrator/messages/:id/rich` endpoint
  - Description: Returns `{message, richPayload, slackBlocks}` for a message by id (admin only). Added to the same `orchestratorPreviewRoutes` router from 5.1.
  - Files:
    - Modify: `backend/src/api/orchestratorPreview.ts`
    - Modify: `backend/src/api/orchestratorPreview.test.ts`
  - Depends on: 5.1
  - Acceptance: Returns 200 for an existing message with `richPayload`; returns 404 for unknown id; returns 200 with `slackBlocks: null` for a message without `richPayload`.

- [ ] **Task 5.3**: Admin card preview screen
  - Description: New screen `frontend/screens/admin/cardPreview.tsx`. Components: JSON input (`TextField` multiline monospace), "Render" `Button`, output panel showing pretty-printed Slack blocks + validation errors. testIDs: `admin-card-preview-screen`, `admin-card-preview-input`, `admin-card-preview-render-button`, `admin-card-preview-output-slack`, `admin-card-preview-output-validation`. Route added to the admin sidebar.
  - Files:
    - Create: `frontend/screens/admin/cardPreview.tsx`
    - Modify: `frontend/navigation/*` (admin sidebar route)
  - Depends on: 5.1
  - Acceptance: Screen mounts on `/admin/card-preview`. All testIDs present. Submit POSTs to `/orchestrator/preview-card` and renders the response.

- [ ] **Task 5.4**: TaskRunLog observability fields (+ unrelated bug fix)
  - Description: Add `richPayloadEmitted`, `cardCount`, `truncated` to `TaskRunLog`. Set them in the IPC `rich_response` handler after a successful render. Update the matching TypeScript interface in `backend/src/types/models/taskRunLogTypes.ts`. Also: include `"gemini"` in the `modelBackend` enum at `taskRunLog.ts:19` — currently it accepts only `["claude", "ollama", "codex"]` but `group.ts:17` allows `gemini`. With `strict: "throw"`, a Gemini-backed group would crash on `TaskRunLog.create`. Add a "Cards" column to the TaskRunLog dashboard table.
  - Files:
    - Modify: `backend/src/models/taskRunLog.ts` (new fields + extend `modelBackend` enum)
    - Modify: `backend/src/types/models/taskRunLogTypes.ts`
    - Modify: `backend/src/orchestrator/ipc.ts` (set fields in the `rich_response` branch from 2.2)
    - Modify: existing TaskRunLog dashboard screen (file path discovered during implementation)
  - Depends on: 2.2
  - Acceptance: A TaskRunLog row created after a rich response shows `richPayloadEmitted: true`, the correct `cardCount`, and `truncated: false` (or `true` if the LLM exceeded 10). A run with `modelBackend: "gemini"` no longer throws on `TaskRunLog.create`.

- [ ] **Task 5.5**: Regenerate frontend SDK
  - Description: After Phase 5 backend changes land, run `bun run sdk` (with backend running on port 4020) to regenerate `frontend/store/openApiSdk.ts`. Frontend now exposes typed RTK Query hooks for `POST /orchestrator/preview-card` and `GET /orchestrator/messages/:id/rich`.
  - Files:
    - Modify: `frontend/store/openApiSdk.ts` (regenerated; do not hand-edit)
  - Depends on: 5.1, 5.2
  - Acceptance: `bun run sdk` exits 0 and the generated file contains the new hooks. If backend is not running, the task is paused per the Movie-Scene-Analyzer precedent — hooks added manually to `sdk.ts` and reconciled when backend is live.

---

## Acceptance Criteria

Each criterion has a stable ID, the test type that proves it, and (where applicable) the testIDs an E2E test must select. Steps are written so a human QA can execute them by hand and a Playwright generator can transform them into code.

### AC-1: Schema accepts a valid `RichResponse` for every card kind
- **Type**: unit (`bun:test`)
- **Preconditions**: Phase 1.1 landed.
- **Steps**:
  1. For each of `text`, `yes_no`, `weather`, `code`, `map`, `list`, `error`, `image`, `table`: construct a minimal-valid payload and run `RichResponse.parse({v: "1", fallbackText: "x", cards: [card]})`.
- **Expected**: All 9 parse without throwing. `parse` result matches input.

### AC-2: Schema rejects malformed payloads
- **Type**: unit
- **Preconditions**: Phase 1.1 landed.
- **Steps**:
  1. Submit a payload with `kind: "unknown"` → expect throw.
  2. Submit `v: "2"` → expect throw.
  3. Submit `cards: []` → expect throw.
  4. Submit 11 cards → expect throw.
  5. Submit a `TableCard` with mismatched row column counts → expect throw.
  6. Submit `fallbackText: ""` → expect throw.
- **Expected**: Each case throws a `ZodError` whose first issue describes the violation.

### AC-3: Truncation respects `autoTruncate`
- **Type**: unit
- **Preconditions**: Phase 1.2 landed.
- **Steps**:
  1. Truncate a 25-card payload with `autoTruncate: true` → expect 10 result cards, last is a `text` card mentioning truncation.
  2. Truncate a 25-card payload with `autoTruncate: false` → expect a single `error` card.
  3. Truncate a 10-card payload with `autoTruncate: true` → expect 10 cards unchanged.
- **Expected**: Output matches case-by-case.

### AC-4: Slack renderer emits valid Block Kit for all 9 card kinds
- **Type**: unit (golden output)
- **Preconditions**: Phase 1.3 landed.
- **Steps**:
  1. For each kind, render a fixture and compare against a stored golden JSON.
  2. Verify total block count for a 10-card max payload ≤ 50.
- **Expected**: Each golden matches; block ceiling holds.

### AC-5: Slack `chat.postMessage` is called with blocks + text + thread_ts
- **Type**: unit
- **Preconditions**: Phase 2.5 landed.
- **Steps**:
  1. Stub `app.client.chat.postMessage`.
  2. Call `SlackConnector.sendRichMessage(externalId, rendered, {groupId: "g1", correlationId: "c1", threadTs: "1.1"})`.
- **Expected**: `chat.postMessage` invoked once with `{channel: externalId, blocks: rendered.blocks, text: rendered.text, thread_ts: "1.1"}`. All `action_id`s start with `shade:g1:c1:`.

### AC-6: Non-Slack channels receive `fallbackText` only
- **Type**: integration
- **Preconditions**: Phase 2.6 landed.
- **Steps**:
  1. Configure a group attached to an `email`/`webhook`/`imessage` channel.
  2. Process an IPC `rich_response` payload addressed to that group.
- **Expected**: `connector.sendMessage` called with exactly `payload.fallbackText`. Persisted `Message.richPayload` is still populated (for audit). No `sendRichMessage` call attempted.

### AC-7: Every outbound bot Message carries a `correlationId`
- **Type**: unit + integration
- **Preconditions**: Phase 2.3 landed.
- **Steps**:
  1. Send a plain message via `ChannelManager.sendMessageToGroup`.
  2. Send a rich message via `ChannelManager.sendRichMessageToGroup`.
- **Expected**: Both persisted Message documents have a 12-character `correlationId`. IDs differ.

### AC-8: `respond_with_card` MCP tool validates input
- **Type**: unit
- **Preconditions**: Phase 2.1 landed.
- **Steps**:
  1. Invoke the tool with a valid `RichResponse` payload.
  2. Invoke the tool with `{v: "1", cards: [], fallbackText: ""}`.
- **Expected**: Case 1 writes an IPC file with the expected envelope and returns text confirmation. Case 2 returns `{isError: true, content: [...Zod error text...]}` and writes no IPC file.

### AC-9: System prompt includes structured-response block when flag is on
- **Type**: unit (snapshot)
- **Preconditions**: Phase 2.4 landed.
- **Steps**:
  1. With `appConfig.richResponses.enabled = true`, call `buildSystemPrompt(...)`.
  2. With `appConfig.richResponses.enabled = false`, call `buildSystemPrompt(...)`.
- **Expected**: Case 1 output contains the JSON Schema fragment and the three worked examples. Case 2 output omits them entirely.

### AC-10: Feature flag kills rich rendering globally
- **Type**: integration
- **Preconditions**: Phase 2 complete.
- **Steps**:
  1. Set `AppConfig.richResponses.enabled = false`.
  2. Trigger the LLM to call `respond_with_card` with a valid `YesNoCard`.
  3. After (2), simulate a Slack action payload arriving for a previously-sent rich message.
- **Expected**:
  - Slack receives only the `fallbackText` via `chat.postMessage` (no `blocks`).
  - Persisted Message still has `richPayload` (audit trail).
  - The action handler IS still registered (it was wired at boot), but its handler body reads the flag at click time, calls `ack()`, logs a "suppressed by flag" warning, and returns without persisting a synthesized inbound or scheduling an agent run.

### AC-11: Slack button click round-trips as a synthetic inbound
- **Type**: integration
- **Preconditions**: Phase 3 complete.
- **Steps**:
  1. Send a `YesNoCard` to Slack (use the Phase 2 test harness).
  2. Simulate Slack action payload: `action_id = "shade:<groupId>:<correlationId>:confirm"`, `value = "yes"`, valid `body.channel.id`.
- **Expected**:
  - Handler calls `ack()` within 3 seconds (assert ordering via mock).
  - A new Message is persisted with `isFromBot: false`, `parentCorrelationId` set to the original `correlationId`, `actionMetadata: {actionId: "confirm", value: "yes"}`.
  - The router's XML formatter renders this message as `<user_action actionId="confirm" value="yes" parentCorrelationId="...">`.
  - An agent run is scheduled with this Message included in context.

### AC-12: `action_id` group mismatch is rejected
- **Type**: unit
- **Preconditions**: Phase 3.1 landed.
- **Steps**:
  1. Send an action payload with `action_id = "shade:groupA:c1:confirm"` but `body.channel.id` resolving to `groupB`.
- **Expected**: Handler `ack()`s but writes no Message and logs a warning. No agent run scheduled.

### AC-13: Mapbox token presence drives renderer behavior
- **Type**: unit
- **Preconditions**: Phase 4 complete.
- **Steps**:
  1. With `AppConfig.maps.mapboxAccessToken = ""`, render a `MapCard`.
  2. With a valid token, render the same `MapCard`.
- **Expected**: Case 1 produces a Slack `section` block with mrkdwn text noting coordinates and a warning. Case 2 produces an `image` block whose `image_url` is a well-formed `https://api.mapbox.com/styles/v1/.../static/...` URL containing the markers.

### AC-14: Mapbox token is redacted in logs
- **Type**: unit
- **Preconditions**: Phase 4.3 landed.
- **Steps**:
  1. Invoke `redactSecrets("Failed to fetch https://api.mapbox.com/...?access_token=pk.eyJxxxxxx")`.
- **Expected**: Returned string contains `access_token=<redacted>` and no occurrence of the real token characters.

### AC-15: Admin preview endpoint validates and renders
- **Type**: integration (HTTP)
- **Preconditions**: Phase 5.1 landed.
- **Steps**:
  1. Authenticated as admin, POST `/orchestrator/preview-card` with a valid `WeatherCard` payload.
  2. POST with `{v: "1", cards: [], fallbackText: ""}`.
  3. POST as a non-admin user.
- **Expected**:
  - Case 1: 200 with `{slackBlocks: [...], fallbackText, validation: null}`.
  - Case 2: 400 with `{validation: [...ZodError...]}`.
  - Case 3: 403.

### AC-16: Admin message-detail endpoint returns rich payload
- **Type**: integration (HTTP)
- **Preconditions**: Phase 5.2 landed.
- **Steps**:
  1. Create a Message with `richPayload` populated. GET `/orchestrator/messages/:id/rich`.
  2. Create a Message without `richPayload`. GET `/orchestrator/messages/:id/rich`.
  3. GET `/orchestrator/messages/<unknown>/rich`.
- **Expected**: 200 with `slackBlocks` array, 200 with `slackBlocks: null`, 404 respectively.

### AC-17: Admin card preview screen renders and submits
- **Type**: E2E (Playwright)
- **Preconditions**: Phase 5.3 landed; logged in as an admin (`loginAs(page, ADMIN_USER)`).
- **testIDs required**:
  - `admin-card-preview-screen` (root view)
  - `admin-card-preview-input` (JSON `TextField`)
  - `admin-card-preview-render-button` (`Button`)
  - `admin-card-preview-output-slack` (block-list container)
  - `admin-card-preview-output-validation` (validation error container)
- **Steps**:
  1. Navigate to `/admin/card-preview`.
  2. `await page.getByTestId('admin-card-preview-screen').waitFor({state: 'visible'})`.
  3. Fill `admin-card-preview-input` with a valid `WeatherCard` payload JSON.
  4. Click `admin-card-preview-render-button`.
  5. Wait for `admin-card-preview-output-slack` to contain the rendered Slack JSON.
  6. Clear input, fill with `{"v": "1", "cards": [], "fallbackText": ""}`.
  7. Click render again.
  8. Wait for `admin-card-preview-output-validation` to be visible and non-empty.
- **Expected**:
  - Step 5: `admin-card-preview-output-slack` contains a string matching `"type":"section"` and at least one Mapbox-or-image accessory entry (depending on chosen fixture). Validation panel is hidden or empty.
  - Step 8: Validation panel is visible and contains text describing the empty `cards` array and empty `fallbackText`.

### AC-18: TaskRunLog records adoption metrics
- **Type**: integration
- **Preconditions**: Phase 5.4 landed.
- **Steps**:
  1. Trigger an agent run that emits a 3-card `RichResponse`.
  2. Trigger a run that emits a 15-card `RichResponse` (forces truncation).
  3. Trigger a plain-text-only run.
- **Expected**: Resulting `TaskRunLog` rows show `{richPayloadEmitted: true, cardCount: 3, truncated: false}`, `{richPayloadEmitted: true, cardCount: 10, truncated: true}`, and `{richPayloadEmitted: false, cardCount: 0, truncated: false}` respectively.

### AC-19: Schema version mismatch is dropped with a warning
- **Type**: unit
- **Preconditions**: Phase 2.2 landed.
- **Steps**:
  1. Write an IPC file with `payload.v = "0"`.
  2. Run the IPC processor over the directory.
- **Expected**: IPC file is skipped, `logger.warn` is called with a message mentioning the version mismatch, no Message is persisted.

### AC-20: LLM falls back to plain text on tool failure
- **Type**: integration
- **Preconditions**: Phase 2 complete.
- **Steps**:
  1. Configure the stub agent to first invoke `respond_with_card` with an invalid payload, then to respond with plain text.
- **Expected**: The MCP tool returns `{isError: true, ...}`. The agent's subsequent plain-text response is delivered via the existing `sendMessage` path. The user sees the plain-text response — no broken card and no silent drop.

### AC-21: Double-send is collapsed by IPC dedupe
- **Type**: integration
- **Preconditions**: Phase 2 complete (incl. the dedupe rule in Task 2.2).
- **Steps**:
  1. Stub the agent to call both `send_message("Here is the forecast")` and `respond_with_card(weatherCard)` in the same run, with both IPC payloads carrying the same `agentRunId`.
- **Expected**: Only the rich response is delivered to Slack. The plain `send_message` IPC file is consumed and dropped with a debug log. No duplicate user-visible message.

### AC-22: Privileged channel rejects Claude-backed rich payload
- **Type**: integration
- **Preconditions**: Phase 2.2 complete.
- **Steps**:
  1. Configure a group attached to a `privileged: true` channel with `modelConfig.defaultBackend = "claude"`.
  2. Process a `rich_response` IPC payload addressed to that group.
- **Expected**: `sendRichMessageToGroup` rejects the send with an error log mirroring `manager.ts:256-267`. No `chat.postMessage` (or iMessage send) is attempted. No Message persisted.

### AC-23: `action_id` total length stays within Slack's 255-char ceiling
- **Type**: unit
- **Preconditions**: Phase 2.5 complete.
- **Steps**:
  1. Construct a `YesNoCard` with `actionId` at its 64-char maximum.
  2. Render and substitute placeholders with a 24-char Mongo ObjectId groupId and a 12-char nanoid correlationId.
- **Expected**: Every substituted `action_id` is ≤ 255 characters.

### AC-24: `value` in synthesized inbound action is XML-escaped in the router
- **Type**: unit
- **Preconditions**: Phase 3.3 complete.
- **Steps**:
  1. Build a Message with `actionMetadata.value = "\"></user_action><foo>"`.
  2. Run it through `formatMessagesAsXml`.
- **Expected**: Output contains `&quot;&gt;&lt;/user_action&gt;&lt;foo&gt;` (or equivalent escapes). No literal `<foo>` substring leaks into the prompt.

### AC-25: Slack manifest precondition is documented
- **Type**: manual (one-time deployment check)
- **Preconditions**: Phase 3 ready for staging rollout.
- **Steps**:
  1. Open the Slack App's manifest (slack.com/api/apps).
  2. Verify "Interactivity & Shortcuts" is enabled (Socket Mode delivery).
- **Expected**: Toggle is on. If off, button clicks silently no-op; flipping it on requires no code change.

### AC-26: Mapbox/image card with unreachable URL falls back gracefully
- **Type**: integration
- **Preconditions**: Phase 4 complete.
- **Steps**:
  1. Render a `MapCard` whose marker count or coordinates would produce a Mapbox URL that returns a 4xx on retrieval (simulate via stub).
  2. Render an `ImageCard` with a URL that 404s.
- **Expected**: When Slack returns `invalid_blocks` or the image fails, the renderer logs a warning and the response is re-sent as a `text` card containing the caption plus a "(image unavailable)" note. The user is not left with a silent failure.

### testID inventory (for Playwright generator)

| testID | Component | Screen | Used by |
|---|---|---|---|
| `admin-card-preview-screen` | root `View` | `frontend/screens/admin/cardPreview.tsx` | AC-17 |
| `admin-card-preview-input` | `TextField` (multiline, monospace) | same | AC-17 |
| `admin-card-preview-render-button` | `Button` | same | AC-17 |
| `admin-card-preview-output-slack` | `Box` showing block JSON | same | AC-17 |
| `admin-card-preview-output-validation` | `Box` showing validation errors | same | AC-17 |
