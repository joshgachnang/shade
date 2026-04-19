# Shade Refactoring Opportunities

Full-repo audit to identify refactoring opportunities across backend, frontend, and infrastructure.

---

## Backend

### 1. Identical modelRouter wrappers (~17 files)
Most files in `backend/src/api/` are 14-line boilerplate wrappers around `modelRouter()`. Could be consolidated into a single config-driven registration.
- Files: `users.ts`, `channels.ts`, `messages.ts`, `frames.ts`, `frameAnalyses.ts`, `characters.ts`, `groups.ts`, `movies.ts`, `plugins.ts`, `radioStreams.ts`, `remoteAgents.ts`, `appConfig.ts`, `commandClassifications.ts`, `webhookSources.ts`, `taskRunLogs.ts`, `scheduledTasks.ts`, `agentSessions.ts`, `aiRequests.ts`

### 2. Channel connector duplication
Status update, disconnect, and messageHandler null-check patterns repeated across all 4 channel types (Slack, iMessage, Email, Webhook). Should be pulled into the `ChannelConnector` base class.
- `orchestrator/channels/slack.ts`, `imessage.ts`, `email.ts`, `webhook.ts`

### 3. Auth check boilerplate (8+ endpoints)
Same `req.user` cast + 401 throw repeated in `appleCalendar.ts`, `appleContacts.ts`, `triviaAutoSearch.ts`, `command.ts`, etc. Could be a `requireAuth` middleware.

### 4. Search fallback duplication
`api/search.ts` — Atlas Search fallback to regex search is copy-pasted between `/search` and `/search/suggest` endpoints (lines 104-125 vs 180-192).

### 5. ChannelManager mixed concerns (360 lines)
`orchestrator/channels/manager.ts` handles channel lifecycle, message routing, group caching, AND hardcoded `!moviesearch` command parsing. Command routing should be extracted.

### 6. `buildPromptForGroup` complexity (64 lines)
`orchestrator/router.ts` lines 40-103 — does message fetching, merging, sorting, dedup, XML formatting, and prompt building in one function. Two separate DB queries could be combined.

### 7. Path traversal protection duplicated
Same static-file-serving guard in `api/movies.ts` (23-29) and `api/transcripts.ts` (21-27).

### 8. Inconsistent error handling
Mix of `logger.error()`, `logError()` util, raw `res.status().json()`, and `throw APIError()` across endpoints. Should standardize on `APIError`.

### 9. Magic strings for statuses
Movie statuses ("pending", "extracting", etc.), backend names ("claude", "ollama"), and search filter types used as raw strings in 10+ places. Should be constants.

### 10. Large service files
`radioTranscriber.ts` (781 lines), `triviaAutoSearch.ts` (794 lines) — could be broken into smaller focused modules.

### 28. Untyped `config` Mixed fields on Channel/Plugin/WebhookSource
`Channel.config`, `Plugin.config`, and `WebhookSource.config` are stored as `mongoose.Schema.Types.Mixed`. Every consumer (e.g. `slack.ts`, `email.ts`, `imessage.ts`) re-casts the same shape inline like `this.channelDoc.config as {botToken?: string}`, losing validation and autocomplete and risking drift when configs change. Migrate to per-type discriminated subschemas (one per `channel.type` / `plugin.type`) with required fields validated at write time. Same pattern likely applies to `Message.metadata` and `AIRequest.metadata`, though those are more open-ended and may stay loose.

**Includes a startup migration script** (run from `server.ts` after `connectToMongoDB()`, before route registration) that:
- Reads every existing `Channel`/`Plugin`/`WebhookSource` doc and rewrites `config` into the discriminator-shaped subdocument for its `type`.
- Logs (does not throw) on docs whose `config` is missing required fields, so a bad row can't block boot.
- Writes a `schemaVersion` marker on each doc so subsequent runs become no-ops.
- Is idempotent and safe to re-run; ships alongside the schema change in the same PR.

---

## Frontend

### 11. `formatTimestamp()` duplicated 3x
Identical function in `movies/[id]/index.tsx:18-23`, `frames/[frameId].tsx:8-13`, `search.tsx:19-24`. Should go in `utils/index.ts` (currently empty placeholder).

### 12. Frame image URL construction duplicated 3x
Same `${baseUrl}/static/movies/...` string template in movie detail, frame detail, and search. Extract to utility.

### 13. Progress bar duplicated
Identical Box-based progress bar in `movies/index.tsx:74-75` and `movies/[id]/index.tsx:174-175`. Extract component.

### 14. Movie detail screen too complex (236 lines)
4 queries, 2 mutations, 2 render callbacks, tab state. `renderFrame` and `renderCharacter` should be separate components.

### 15. Search screen state management
4 `useState` calls managing related search state (`search.tsx:28-31`). Could be a custom hook or reducer.

### 16. Status badge mapping inconsistent
Movie list uses mapping object, detail view uses inline ternary. Should share one approach.

### 17. Inline image styles duplicated
Same `{width: 120, height: 68, borderRadius: 4}` in movie detail and search. Extract constant.

### 18. Browser `prompt()` for movie creation
`movies/index.tsx:24-31` uses `prompt()` instead of a proper modal/form.

### 19. Tab icon `useCallback` over-engineering
`(tabs)/_layout.tsx:15-28` — three separate `useCallback` wrappers for trivial icon rendering.

---

## Infrastructure & Config

### 20. TypeScript version mismatch
Backend pins `5.8.2`, frontend uses `~5.9.2`, fleet-types pins `5.8.2`. Could cause SDK generation issues.

### 21. Biome version drift
Backend `^2.3.6` vs frontend `^2.0.0`. Rules may differ.

### 22. CI cache key typo
`frontend-ci.yml:28` references `bun.lockb` but actual file is `bun.lock`. Cache never hits.

### 23. E2E workflow installs deps twice
`e2e.yml` installs frontend deps at root and again in frontend directory, and mutates lockfile by adding `@playwright/test`.

### 24. No root `tsconfig.json`
No workspace-level TypeScript config for monorepo.

### 25. Frontend test coverage near zero
Only 1 test file (`store/store.test.ts`). No component or screen tests.

### 26. E2E test gaps
Only covers auth and navigation. No tests for Movies, Search, Admin, or error states.

### 27. Missing environment documentation
No root `.env.example`. `EXPO_PUBLIC_API_URL` and `OPENAPI_URL` undocumented.

---

## Priority Summary

| Priority | Items | Theme |
|----------|-------|-------|
| **High** | 1, 2, 3, 11, 12, 20, 22 | Duplication & correctness |
| **Medium** | 4, 5, 6, 8, 9, 13, 14, 21, 23, 28 | Complexity & consistency |
| **Low** | 7, 10, 15-19, 24-27 | Polish & coverage |
