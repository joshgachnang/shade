# Tasks: Rich Response UI (IP-005)

Linked plan: `docs/implementationPlans/Rich-Response-Ui.md`
Branch: `ui-components`
Commit prefix: `IP-005:`

Tasks are listed in dependency order. Each task is independently implementable and testable. Run `bun test` after each task; do not merge a task with failing tests.

## Phase 0 — Schema spike

### 0.1 Verify Zod 4 `.merge` on discriminated-union members
- **Goal**: Prove or disprove that `z.object(...).merge(WithActions)` parses correctly as a member of `z.discriminatedUnion("kind", [...])` under Zod 4.3.6.
- **Files**:
  - Throwaway scratch test (not committed) OR `backend/src/orchestrator/responses/schema.test.ts` skipped block.
- **Depends on**: none
- **Acceptance**: A documented decision: either keep `.merge(WithActions)` or inline `actions` on each card schema. Persist the decision as a comment in `schema.ts`.

## Phase 1 — Schema + renderers + feature flag

### 1.1 Zod schema with 9 card kinds
- **Files**:
  - Create `backend/src/orchestrator/responses/schema.ts`
  - Create `backend/src/orchestrator/responses/schema.test.ts`
- **Depends on**: none
- **Acceptance**: All card kinds have one accept + one reject test. Discriminated union rejects unknown `kind`. `fallbackText` required. `cards.max(10)` enforced.

### 1.2 Truncation helper
- **Files**:
  - Create `backend/src/orchestrator/responses/truncate.ts`
  - Create `backend/src/orchestrator/responses/truncate.test.ts`
- **Depends on**: 1.1
- **Acceptance**: Exactly-10, 11, 25 cards covered. Both `autoTruncate` values. Trailing notice card well-formed.

### 1.3 SlackBlockKitRenderer
- **Files**:
  - Create `backend/src/orchestrator/responses/renderers/types.ts`
  - Create `backend/src/orchestrator/responses/renderers/slack.ts`
  - Create `backend/src/orchestrator/responses/renderers/slack.test.ts`
- **Depends on**: 1.1
- **Acceptance**: Golden-output tests pass for one input per card kind. Block count ≤ 50 at max payload.

### 1.4 FallbackTextRenderer
- **Files**:
  - Create `backend/src/orchestrator/responses/renderers/fallback.ts`
  - Create `backend/src/orchestrator/responses/renderers/fallback.test.ts`
- **Depends on**: 1.3
- **Acceptance**: Returns `fallbackText` verbatim.

### 1.5 Renderer registry
- **Files**:
  - Create `backend/src/orchestrator/responses/renderers/terreno.ts` (stub)
  - Create `backend/src/orchestrator/responses/renderers/index.ts`
  - Create `backend/src/orchestrator/responses/renderers/index.test.ts`
- **Depends on**: 1.3, 1.4
- **Acceptance**: `pickRenderer` returns correct instance per channel type. Terreno stub throws.

### 1.6 AppConfig additions (+ type interface)
- **Files**:
  - Modify `backend/src/models/appConfig.ts`
  - Modify `backend/src/types/models/appConfigTypes.ts`
  - Modify `backend/src/models/appConfig.test.ts` (create if absent)
- **Depends on**: none
- **Acceptance**: New sections populated by defaults; cache invalidates on mutation. TS compiles with no `as any` casts. `strict: "throw"` does not reject `Message.create({...new fields})`.

### 1.7 Message model field additions (+ type interface)
- **Files**:
  - Modify `backend/src/models/message.ts`
  - Modify `backend/src/types/models/messageTypes.ts`
  - Modify or create `backend/src/models/message.test.ts`
- **Depends on**: none
- **Acceptance**: New documents save with all four fields; legacy fixtures hydrate; `Message.create` typechecks.

## Phase 2 — LLM emits cards

### 2.1 `respond_with_card` MCP tool
- **Files**:
  - Modify `backend/src/agentRunner/mcpServer.ts`
  - Modify or create `backend/src/agentRunner/mcpServer.test.ts`
- **Depends on**: 1.1
- **Acceptance**: Valid payload writes IPC file with `{type: "rich_response", …}`. Invalid payload returns `{isError: true, …}`.

### 2.2 IPC `rich_response` handler + authorization + privileged-channel gate
- **Files**:
  - Modify `backend/src/orchestrator/ipc.ts` (NOT `groupQueue.ts` — IPC switch lives here)
  - Modify `backend/src/orchestrator/index.ts` (wire `setSendRichMessage`)
  - Modify `backend/src/orchestrator/channels/manager.ts` (add `sendRichMessageToGroup` with `PRIVILEGED_ALLOWED_BACKENDS` gate)
  - Create or modify `backend/src/orchestrator/ipc.test.ts`
- **Depends on**: 1.1, 1.2, 1.5, 2.1
- **Acceptance**: IPC file triggers send. Invalid payloads warn + skip. Non-main group targeting another group is rejected. Claude-backed group targeting a privileged channel is rejected. Co-arriving `send_message` with same `agentRunId` is dropped.

### 2.3 nanoid correlationId on every outbound bot Message
- **Files**:
  - Modify `backend/src/orchestrator/channels/manager.ts`
  - Run from `backend/`: `bun add nanoid` (workspace lockfile churn expected)
- **Depends on**: 1.7
- **Acceptance**: All outbound Messages carry a 12-char `correlationId`.

### 2.4 System prompt structured-response block
- **Files**:
  - Create `backend/src/orchestrator/responses/jsonSchema.ts`
  - Create `backend/src/orchestrator/responses/promptBlock.ts`
  - Create `backend/src/orchestrator/responses/promptBlock.test.ts`
  - Modify `backend/src/orchestrator/memory.ts` (signature change — accept appConfig)
  - Modify `backend/src/orchestrator/groupQueue.ts` (pass appConfig through)
  - Run from `backend/`: `bun add zod-to-json-schema`
- **Depends on**: 1.1, 1.6
- **Acceptance**: Snapshot test stable; `buildSystemPrompt` includes block when `appConfig.richResponses.enabled === true` and omits it when `false`. Token count of the block asserted and documented (target < 1500 tokens).

### 2.5 `SlackConnector.sendRichMessage` + thread plumbing
- **Files**:
  - Modify `backend/src/orchestrator/channels/slack.ts`
  - Modify `backend/src/orchestrator/channels/types.ts`
  - Modify `backend/src/agentRunner/mcpServer.ts` (carry `threadTs` from `McpContext` to IPC)
  - Modify `backend/src/orchestrator/groupQueue.ts` (set `messageTs`/`threadTs` on `McpContext`)
  - Modify `backend/src/orchestrator/channels/manager.ts` (forward `threadTs`)
  - Modify or create `backend/src/orchestrator/channels/slack.test.ts`
- **Depends on**: 1.3, 1.5, 2.2
- **Acceptance**: `chat.postMessage` called with blocks + text + thread_ts. `action_id`s namespaced and total ≤ 255 chars. `threadTs` flows from inbound through to outbound. `supportsRichMessages = true`.

### 2.6 Non-Slack channel capability flags
- **Files**:
  - Modify `backend/src/orchestrator/channels/email.ts`
  - Modify `backend/src/orchestrator/channels/webhook.ts`
  - Modify `backend/src/orchestrator/channels/imessage.ts`
  - Modify or create `backend/src/orchestrator/channels/manager.test.ts`
- **Depends on**: 2.2
- **Acceptance**: Non-Slack receives `fallbackText` only; Message still carries `richPayload`.

### 2.7 End-to-end happy-path test
- **Files**:
  - Create `backend/src/orchestrator/responses/e2e-happy-path.test.ts`
- **Depends on**: 2.1, 2.2, 2.3, 2.5
- **Acceptance**: Stub agent → `YesNoCard` → expected `chat.postMessage` shape + persisted Message.

### 2.8 Feature-flag-off integration test
- **Files**:
  - Create `backend/src/orchestrator/responses/e2e-flag-off.test.ts`
- **Depends on**: 2.2, 2.5, 2.6
- **Acceptance**: With flag off, `connector.sendRichMessage` is NOT called; `connector.sendMessage(fallbackText)` is. Message still persists `richPayload`.

## Phase 3 — Interactivity round-trip

### 3.1 Slack action handler (with runtime flag check)
- **Files**:
  - Modify `backend/src/orchestrator/channels/slack.ts`
  - Modify `backend/src/orchestrator/channels/slack.test.ts`
- **Depends on**: 2.5
- **Acceptance**: Handler `ack()`s first. Reads `appConfig.richResponses.enabled` at click time — when false, logs "suppressed by flag" and returns. Otherwise validates `body.channel.id` resolves to the same group as in `action_id` (mismatch → ack + log + skip). Synthesized message has `parentCorrelationId` + `actionMetadata`.

### 3.2 Persist action-driven inbound Message
- **Files**:
  - Modify `backend/src/orchestrator/channels/manager.ts`
  - Modify `backend/src/orchestrator/channels/manager.test.ts`
- **Depends on**: 3.1, 1.7
- **Acceptance**: Persisted Message has `parentCorrelationId`, `actionMetadata`, `isFromBot: false`.

### 3.3 Router XML formatter for action messages (with escapeXml)
- **Files**:
  - Modify `backend/src/orchestrator/router.ts`
  - Modify or create `backend/src/orchestrator/router.test.ts`
- **Depends on**: 3.2
- **Acceptance**: Snapshot test produces expected `<user_action>` XML. Attribute values pass through existing `escapeXml` helper (`router.ts:11-18`). Test with `value = "\"></user_action><foo>"` confirms metacharacters are escaped.

### 3.4 End-to-end interactivity test
- **Files**:
  - Create `backend/src/orchestrator/responses/e2e-interactivity.test.ts`
- **Depends on**: 3.1, 3.2, 3.3
- **Acceptance**: Emit YesNoCard → simulate action payload → assert follow-up agent run scheduled.

## Phase 4 — Mapbox Static

### 4.1 Mapbox URL helper
- **Files**:
  - Create `backend/src/orchestrator/responses/mapbox.ts`
  - Create `backend/src/orchestrator/responses/mapbox.test.ts`
- **Depends on**: 1.1
- **Acceptance**: URL well-formed for 0, 1, 20 markers.

### 4.2 Wire Mapbox into SlackBlockKitRenderer
- **Files**:
  - Modify `backend/src/orchestrator/responses/renderers/slack.ts`
  - Modify `backend/src/orchestrator/responses/renderers/slack.test.ts`
- **Depends on**: 4.1, 1.6
- **Acceptance**: Token absent → text fallback; token present → image block.

### 4.3 Redact Mapbox token in logs
- **Files**:
  - Modify `backend/src/orchestrator/security.ts` (`redactSecrets` at lines 49-58 — currently env-value substitution only; add a URL-regex pass)
  - Create or modify `backend/src/orchestrator/security.test.ts`
- **Depends on**: 4.1
- **Acceptance**: Mapbox URL with `access_token=...` is rewritten to `access_token=<redacted>`. Existing env-var substitution behavior preserved.

## Phase 5 — Admin preview + dashboard hooks

### 5.1 `POST /orchestrator/preview-card` endpoint
- **Files**:
  - Create `backend/src/api/orchestratorPreview.ts` (exports `orchestratorPreviewRoutes`, matching `appConfigRoutes` / `aiRequestRoutes` pattern)
  - Modify `backend/src/server.ts` (import + register the route constant)
  - Create `backend/src/api/orchestratorPreview.test.ts`
- **Depends on**: 1.3, 1.5
- **Acceptance**: Valid payload returns blocks; invalid returns 400 with structured errors. Authenticated non-admin returns 403; anonymous returns 401.

### 5.2 `GET /orchestrator/messages/:id/rich` endpoint
- **Files**:
  - Modify `backend/src/api/orchestratorPreview.ts`
  - Modify `backend/src/api/orchestratorPreview.test.ts`
- **Depends on**: 5.1
- **Acceptance**: 200 for existing message; 404 for unknown id; `slackBlocks: null` when no `richPayload`.

### 5.3 Admin card preview screen
- **Files**:
  - Create `frontend/screens/admin/cardPreview.tsx`
  - Modify admin navigation route file
- **Depends on**: 5.1
- **Acceptance**: Screen mounts; testIDs present (`admin-card-preview-screen`, `-input`, `-render-button`, `-output-slack`, `-output-validation`); POSTs and renders response.

### 5.4 TaskRunLog observability fields (+ enum fix)
- **Files**:
  - Modify `backend/src/models/taskRunLog.ts` (new fields + extend `modelBackend` enum to include `"gemini"`)
  - Modify `backend/src/types/models/taskRunLogTypes.ts`
  - Modify `backend/src/orchestrator/ipc.ts` (set fields in the `rich_response` branch)
  - Modify existing TaskRunLog dashboard screen
- **Depends on**: 2.2
- **Acceptance**: New rows show `richPayloadEmitted`, `cardCount`, `truncated`. Gemini-backed runs no longer throw on `TaskRunLog.create`.

### 5.5 Regenerate frontend SDK
- **Files**:
  - Modify `frontend/store/openApiSdk.ts` (regenerated — do not hand-edit)
- **Depends on**: 5.1, 5.2
- **Acceptance**: `bun run sdk` exits 0 with new hooks. If backend not running, follow Movie-Scene-Analyzer precedent: add hooks manually to `sdk.ts`, reconcile later.
