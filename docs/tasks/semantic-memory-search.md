# Semantic Memory & File Search (IP-013) — Task List

Source: [Semantic-Memory-Search.md](../implementationPlans/Semantic-Memory-Search.md)

Decisions: embeddings in Mongo + brute-force cosine (no Atlas); OpenAI `text-embedding-3-small`; strictly group-scoped message search.

## Phase 1: Foundation

- [ ] **1.1** `Embedding` model + types (unique `{sourceType, sourceId, chunkIndex}`, contentHash, vector as Buffer)
- [ ] **1.2** `semanticSearch` AppConfig block (enabled, provider, model, dimensions, maxIndexedChunks, searchLimit, minScore, per-source toggles)
- [ ] **1.3** Provider abstraction + OpenAI embed client + chunker (batching, dimension truncation, hash stability; tests with fake provider)

## Phase 2: Indexer + backfill

- [ ] **2.1** Indexer service (buffered queue) + hooks: Message post-save, save_skill, save_data, update_memory
- [ ] **2.2** In-memory cosine index with invalidation (top-k correctness tests vs naive reference)
- [ ] **2.3** `backfillEmbeddings.ts` script with `--dry-run` cost estimate, idempotent by contentHash

## Phase 3: Tool + rollout

- [ ] **3.1** `semantic_search` MCP tool (group-scoped, disabled-flag friendly text) + memory prompt-block guidance
- [ ] **3.2** Prod backfill, enable, tune minScore/searchLimit; document spot-checks in the IP
