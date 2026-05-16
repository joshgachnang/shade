# Research: Rich Response UI Components for Shade

## Summary
Shade currently produces every response as a single plain string from the Agent SDK and dispatches it through one channel-agnostic send method. Four output channels exist (Slack, Email, Webhook, iMessage), but none consume structured output today. Adding rich UI is therefore best modeled as a **schema layered on top of the existing single-string pipeline**: the schema is the canonical artifact, Slack rendering is the first concrete target, and Email/Webhook/iMessage degrade to `fallbackText`. @terreno/ui rendering is schema-ready, not built. Zod is already in the codebase and is the right validator.

## Context
- Worktree: `/Users/joshgachnang/.claude-worktrees/shade/ui-components` on branch `ui-components`
- Backend: Express + Mongoose + @terreno/api, models singleton (`AppConfig`)
- Agent runtime: `@anthropic-ai/claude-agent-sdk` via `DirectAgentRunner`
- Slack stack: `@slack/bolt` v4.6.0 + `@slack/web-api` v7.14.1 (Socket Mode, no public HTTP)

## Findings

### 1. Response pipeline has a single, clean integration point
- LLM output produced in `backend/src/orchestrator/runners/direct.ts:21-204` (`DirectAgentRunner.run`) as `{output: redactSecrets(result)}` — a string today.
- Cleaned for delivery in `backend/src/orchestrator/router.ts:105-113` (`formatOutboundMessage`) — strips internal tags, returns a string.
- Fanned out via `backend/src/orchestrator/channels/manager.ts:247-293` (`sendMessageToGroup`) — one method, all four channels.
- Send path per channel implements `ChannelConnector.sendMessage(groupExternalId, content: string)` — `backend/src/orchestrator/channels/types.ts:13-40`.

### 2. Slack stack is healthy but not interactive yet
- Send via `app.client.chat.postMessage({token, channel, text})` at `backend/src/orchestrator/channels/slack.ts:183-207` — text only.
- One existing Block Kit usage: `backend/src/orchestrator/services/radioTranscriber.ts:569-626` (URL-only button, no action handler).
- **NO `app.action()` / `app.shortcut()` / `app.view()` handlers** — interactivity round-trip must be built.
- `thread_ts` is captured on inbound (`channels/slack.ts:53-89`) but ignored when replying — easy fix once we touch the send path.
- Auth lives per-Channel: `channel.config.botToken`, `appToken`, `signingSecret` (`backend/src/models/channel.ts`).

### 3. The MCP tool surface is the right place for the LLM to "speak schema"
- MCP tools defined in `backend/src/agentRunner/mcpServer.ts` (`buildTools`) — all currently return `{content: [{type: "text", text}]}`.
- Tool inputs are validated with **Zod 4.3.6** — already imported, already idiomatic.
- Cleanest design: a single `respond_with_card` MCP tool whose Zod input is the `RichResponse` envelope. Tool writes an IPC file the orchestrator picks up, just like `send_message` does today.

### 4. @terreno/ui composes cards from primitives — no `WeatherCard` exists today, and that's fine
- Catalog: `Card` (wrapper), `Box` (flex w/ direction/gap/padding/color/rounding), `Heading`, `Text` (semantic colors), `Badge`, `Button`, `Image` (RN), `Spinner`, `TextField`.
- No `DataTable`. Lists = `FlatList` + `Card` items. Pattern is well-established in `frontend/screens/features/index.tsx` and `frontend/screens/movies/index.tsx`.
- Theme tokens are **semantic strings** (`primary`, `error`, `secondaryLight`). Schema carries semantic tokens; Slack renderer ignores them, @terreno/ui resolves them later.

### 5. Codebase conventions to align with
- Models: `backend/src/models/{name}.ts`, `addDefaultPlugins(schema)`, `strict: 'throw'`.
- Feature flags: `AppConfig` (cache auto-invalidates on save). Add `richResponses: { enabled, schemaVersion }`.
- Logger: `import {logger} from "@terreno/api"`.
- Tests: `bun:test` colocated as `*.test.ts`.
- SDK: `bun run sdk` regenerates `frontend/store/openApiSdk.ts` after backend OpenAPI changes.

## Card-type → renderer mapping

| `kind` | Slack Block Kit translation | @terreno/ui composition (later phase) |
|---|---|---|
| `text` | `section` w/ `mrkdwn` | `Card` → `Text` |
| `yes_no` | `section` + `actions` (two buttons w/ `action_id`) | `Card` → `Heading` + `Box(row)` → `Button` × 2 |
| `weather` | `section` w/ `accessory` image + `fields[]` | `Card` → `Heading` + `Box(row, gap)` → `Text` × N + `Image` |
| `code` | `section` mrkdwn fenced ```code``` | `Card` → `Text` monospace |
| `map` | `image` block (Mapbox Static URL) | `Card` → `Image` (later: `react-native-maps`) |
| `list` | repeated `section` w/ `divider`s | `Card` w/ `FlatList` items |
| `error` | `context` block w/ ⚠️ + text | `Card` → `Text color="error"` |

## Options considered

| Option | Pros | Cons | Effort |
|---|---|---|---|
| **A. Discriminated-union Zod schema, single `respond_with_card` MCP tool** *(chosen)* | One schema, one tool, evolvable via versioned envelope; matches existing Zod conventions; LLM picks `kind` and emits structured payload | Requires updating prompts to teach card vocabulary; need a fallback for plain text | M |
| B. Per-card MCP tools (`render_weather`, `render_code`, …) | Tool-name acts as type tag; very explicit prompts | Tool sprawl; harder to add card types without redeploy; doesn't leverage Zod discriminated unions | M-L |
| C. Free-form Slack Block Kit JSON, no schema | Maximum flexibility, no abstraction tax | Brittle, model hallucinations break Slack, no path to @terreno/ui parity, no validation, no portability | S now / L later |
| D. Markdown-only with Slack emoji conventions | Trivial to ship | No buttons / interactivity, contradicts the PRD | XS |

## Recommendation: Option A

**Versioned `RichResponse` envelope, discriminated union of card types, Zod-validated, single MCP tool, per-channel renderer registry.**

```ts
// backend/src/orchestrator/responses/schema.ts
const SCHEMA_VERSION = "1" as const;

const Card = z.discriminatedUnion("kind", [
  TextCard, YesNoCard, WeatherCard, CodeCard, MapCard, ListCard, ErrorCard,
]);

const RichResponse = z.object({
  v: z.literal(SCHEMA_VERSION),
  cards: z.array(Card).min(1).max(10), // Slack 50-block ceiling w/ headroom
  fallbackText: z.string(),             // plaintext for non-rich channels
});
```

```ts
tool("respond_with_card", "Reply to the user with a structured card response.",
  RichResponse.shape, async (args) => {
    await writeIpcFile(ctx.ipcDir, {type: "rich_response", groupId, channelId, payload: args});
    return {content: [{type: "text", text: "Card queued"}]};
  })
```

Slack renderer maps each card to Block Kit (cap 10 cards × ~5 blocks = 50). Interactive `action_id`s are namespaced (`shade:yes_no:<groupId>:<correlationId>:<choice>`) so the action handler can route the click back into the orchestrator as a synthetic inbound message tagged with the originating correlationId.

## Decisions locked from open questions

1. **Non-Slack channels at v1** — Email/Webhook/iMessage receive `fallbackText` only.
2. **Action round-trip** — button click becomes a synthetic inbound `Message` carrying `correlationId` referencing the originating outbound message.
3. **Card overflow** — auto-truncate to 10 cards / 50 blocks; emit a warning log + a final `text` card noting truncation.
4. **Map provider** — Mapbox Static. Key lives in `AppConfig.maps.mapboxAccessToken`.
5. **LLM default** — plain text default; `respond_with_card` is opt-in for when structure adds value. System prompt teaches when to use it.
6. **Feature flag** — `AppConfig.richResponses.enabled` (default `true`); flips the orchestrator to render via the registry vs. the existing string path.

## References
- `backend/src/orchestrator/runners/direct.ts:21-204`
- `backend/src/orchestrator/router.ts:105-113`
- `backend/src/orchestrator/channels/manager.ts:247-293`
- `backend/src/orchestrator/channels/slack.ts:27-226`
- `backend/src/orchestrator/channels/types.ts:13-40`
- `backend/src/orchestrator/services/radioTranscriber.ts:569-626`
- `backend/src/agentRunner/mcpServer.ts:47+`
- `backend/src/models/channel.ts`, `backend/src/models/appConfig.ts`
- `frontend/screens/features/index.tsx` (canonical @terreno/ui card composition)
- `docs/implementationPlans/IP_TEMPLATE.md`, `Movie-Scene-Analyzer.md`, `shade-orchestrator.md`
