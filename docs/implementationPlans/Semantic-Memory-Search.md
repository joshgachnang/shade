# Implementation Plan: Semantic Memory & File Search

**Status:** Open
**Priority:** High
**Effort:** Big batch (1-2 weeks)
**IP:** IP-013

Give Shade recall by *meaning*, not just keywords. Today `search_history` is a MongoDB text index over `Message.content` and skills/data are only findable by name. This IP adds an embedding pipeline and a `semantic_search` MCP tool over message history, skills, saved data blobs, and memory files — the "GBrain semantic layer" pattern: the agent can query content both with exact tools (text index, load_skill) *and* by semantic similarity.

Builds directly on IP-008 (Agent Memory & Learning). IP-008 is still Pending Verification — verify it first; this IP layers on top of its storage, not around it.

## Decisions & Options

### D1: Vector store

Production MongoDB is **self-hosted** (`mongodb://localhost:27017/shade` on the shade host), so `$vectorSearch` (Atlas-only) is not available — the movie pipeline's `withAtlasFallback` pattern exists precisely because of this.

- **A (recommended): Embeddings in Mongo + brute-force cosine in Node.** New `Embedding` collection stores vectors as `Buffer` (Float32). A small in-process index loads vectors into a Float32Array matrix at boot and on invalidation, scoring queries by cosine similarity. Zero new infrastructure. Single-user scale math: ~100k chunks × 768 dims × 4 bytes ≈ 300 MB worst case, and realistic volume (a few years of messages) is well under that; a `maxIndexedChunks` config cap plus recency windowing keeps it bounded.
- **B: sqlite-vec via bun:sqlite.** Real ANN, tiny footprint. Adds a native extension dependency and a second datastore to back up/migrate.
- **C: Qdrant sidecar on the shade host.** Proper vector DB, HNSW, filters. New systemd service, ops burden; overkill for one user.
- **D: Migrate prod to Atlas.** Unlocks `$vectorSearch` + the movie `$search` paths for real. Biggest blast radius; not worth coupling to this feature.

### D2: Embedding provider

- **A (recommended): OpenAI `text-embedding-3-small`** via the existing `apiKeys.openai`. ~$0.02/1M tokens, 1536 dims (or 512 truncated), batched API. Cheap enough to embed everything without thinking.
- **B: Voyage `voyage-3.5-lite`.** Better retrieval quality per dollar; new API key + SDK.
- **C: Local (fastembed / transformers.js, e.g. bge-small).** No API cost, works offline; CPU-only shade host makes backfill slow, adds a native/ONNX dependency.
- Provider is abstracted behind one `embed(texts: string[]): Promise<Float32Array[]>` interface with the model name recorded per embedding, so switching later only requires a re-embed backfill.

### D3: What gets indexed (proposed: all of these, each behind a config toggle)

1. `Message` documents (chunk = single message; skip bot progress noise and messages under ~20 chars).
2. Skills (chunk = whole skill file, re-embedded on `save_skill`).
3. Saved data blobs (`save_data` JSON, stringified, chunked at ~1k tokens).
4. Memory files (SOUL/CLAUDE/USER/group memory, re-embedded on `update_memory`).

Email bodies and documents are **out of scope** here — IP-016 (Apple Mail ingestion) produces the files; this IP's indexer picks them up as a fast-follow once both land.

## Models

- **`Embedding`** (new): `{sourceType: "message" | "skill" | "data" | "memoryFile", sourceId: string, groupId?: ObjectId, chunkIndex: number, text: string (the chunk, ≤2k chars), vector: Buffer, model: string, contentHash: string}` + default plugins. Indexes: `{sourceType: 1, sourceId: 1}`, `{groupId: 1}`, unique on `{sourceType, sourceId, chunkIndex}`. `contentHash` (sha256 of chunk text) makes re-index idempotent.
- **`AppConfig` additions** (`semanticSearch` section): `enabled` (default false until backfilled), `provider` ("openai"), `model` ("text-embedding-3-small"), `dimensions` (512), `maxIndexedChunks` (100000), `searchLimit` (8), `minScore` (0.3), per-source toggles (`indexMessages`, `indexSkills`, `indexData`, `indexMemoryFiles`).

## APIs

- **MCP tool `semantic_search`**: `{query: string, sourceTypes?: string[], limit?: number}` → scored results `{score, sourceType, sourceId, text, createdAt}`, group-scoped for messages (same isolation rule as `search_history`). Description steers the agent: use `search_history` for exact phrases/names, `semantic_search` for "what did we decide about X"-style recall.
- **Indexer service** (gateway process): buffered queue fed by hooks — post-save on `Message`, plus explicit calls from `save_skill`, `save_data`, `update_memory`. Batches up to 64 chunks per embed call; failures log and retry with backoff; the tool works on whatever is indexed (search never blocks on indexing).
- **Backfill script** `src/scripts/backfillEmbeddings.ts`: idempotent (skips matching `contentHash`), rate-limited, reports cost estimate before running with `--dry-run`.
- No new REST endpoints; admin visibility via the generic `/admin/[model]` CRUD over `Embedding` (list count, spot-check).

## Notifications

None. Indexer errors go to `logger.error`; sustained failure is visible via the session-review loop (failed runs / cost anomalies), not a new alert channel.

## UI

None required. Optional fast-follow: a "semantic" toggle on the existing global search screen once the tool is proven from chat.

## Phases

1. **Foundation**: `Embedding` model, AppConfig section, provider abstraction + OpenAI implementation, chunking + hashing utilities. Unit tests with a fake provider.
2. **Indexer + backfill**: hook wiring for the four source types, in-memory cosine index with invalidation, backfill script. Verify recall on real history in dev.
3. **Tool + rollout**: `semantic_search` MCP tool, system-prompt guidance line, enable in prod after backfill, tune `minScore`/`searchLimit` against real queries.

## Feature Flags & Migrations

`semanticSearch.enabled` gates the tool and indexer both (off = zero behavior change). No migration; backfill is additive and re-runnable. Rollout: deploy off → backfill → enable → observe a week of usage via `AIRequest`/tool logs.

## Activity Log & User Updates

Indexer logs chunk counts at info level on backfill and per-batch at debug. `semantic_search` calls are visible in session transcripts like any tool call.

## Not Included / Future Work

- Email/document indexing (arrives with IP-016's archive; add `sourceType: "document"` then).
- ANN index (only needed if brute-force latency exceeds ~100ms at real scale; D1-B is the escape hatch).
- Movie frame semantic search (Atlas `$search` path already covers it adequately).
- Cross-encoder re-ranking, hybrid BM25+vector fusion, memory decay/importance weighting.

## Decisions (2026-07-12)

1. **D1 = A**: embeddings in Mongo + brute-force cosine in Node. sqlite-vec remains the escape hatch if latency demands it.
2. **D2 = A**: OpenAI `text-embedding-3-small` via existing `apiKeys.openai`.
3. **Group scoping**: `semantic_search` stays strictly group-scoped for messages (safe default; main-group cross-group search deferred to future work).

---

## Task List

### Phase 1: Foundation

- [ ] **Task 1.1**: `Embedding` model + types
  - Files: `backend/src/models/embedding.ts`, `backend/src/types/models/embeddingTypes.ts`, index exports
  - Acceptance: model tests cover unique chunk constraint and hash round-trip
- [ ] **Task 1.2**: AppConfig `semanticSearch` section + types
  - Files: `backend/src/models/appConfig.ts`, `backend/src/types/models/appConfigTypes.ts`
- [ ] **Task 1.3**: Provider abstraction + OpenAI embed client + chunker
  - Files: `backend/src/orchestrator/semantic/provider.ts`, `chunker.ts` (+ tests with fake provider)
  - Acceptance: batching, dimension truncation, hash stability tested

### Phase 2: Indexer + backfill

- [ ] **Task 2.1**: Indexer service with buffered queue + source hooks
  - Files: `backend/src/orchestrator/semantic/indexer.ts`, hooks in `skills.ts`, `mcpServer.ts` (save_data/update_memory), `Message` post-save
  - Acceptance: saving a message/skill produces embeddings; failures don't block the write path
- [ ] **Task 2.2**: In-memory cosine index with invalidation
  - Files: `backend/src/orchestrator/semantic/searchIndex.ts` (+ tests)
  - Acceptance: top-k correctness vs naive reference; reload on invalidation
- [ ] **Task 2.3**: Backfill script with --dry-run cost estimate
  - Files: `backend/src/scripts/backfillEmbeddings.ts`

### Phase 3: Tool + rollout

- [ ] **Task 3.1**: `semantic_search` MCP tool + prompt guidance
  - Files: `backend/src/agentRunner/mcpServer.ts`, memory prompt block
  - Acceptance: group scoping enforced; disabled flag returns friendly text
- [ ] **Task 3.2**: Prod backfill + enable + tuning notes
  - Acceptance: real-query spot checks documented in the IP on close
