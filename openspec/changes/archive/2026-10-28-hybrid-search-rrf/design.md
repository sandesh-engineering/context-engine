## Context

Currently, `RetrievalService` executes dense cosine similarity search over `document_chunks.embedding` using `VectorSearchRepository`. The retrieved candidate chunks are optionally reranked by `IQwenRerankerProvider` (if `RERANKING_ENABLED=true`), or returned directly. Downstream `ChatContextAssembler` converts `CandidateChunk[]` into prompt evidence blocks and `CitationMetadata[]`.

While dense vector similarity excels at capturing high-level semantic meaning, user queries with exact part numbers, product names, error codes, abbreviations, or lexical terms can fail to match embeddings reliably. Introducing native PostgreSQL Full-Text Search (FTS) paired with Reciprocal Rank Fusion (RRF) combines sparse keyword matching and dense vector search into a unified candidate pool.

## Goals / Non-Goals

**Goals:**
- Add native PostgreSQL full-text search over `document_chunks.content` using `websearch_to_tsquery` and `ts_rank_cd`.
- Add a TypeORM database migration introducing a GIN expression index on `to_tsvector('english', "content")`.
- Create a pure, reusable, independently testable RRF fusion utility with configurable $k$ (default 60), 1-based ranks, and deterministic tie-breaking.
- Execute vector similarity search (top 20) and keyword search (top 20) concurrently in `RetrievalService` using `Promise.all`.
- Introduce `HYBRID_SEARCH_ENABLED=false` configuration flag to guarantee zero regression for existing vector-only behavior.
- Ensure graceful fallback to vector-only results if keyword search fails.
- Preserve identical chunk data structures (`CandidateChunk`), citation generation, and LLM chat streaming contracts.

**Non-Goals:**
- Introducing external search clusters (Elasticsearch, OpenSearch, Meilisearch).
- Changing embedding models, dimensions (768), or cosine similarity metric (`<=>`).
- Altering ingestion chunking, state machines, or SQS queues.
- Introducing an additional neural reranker (existing Qwen3-Reranker remains an optional subsequent stage).

## Decisions

### 1. PostgreSQL Expression GIN Index vs. Generated Column
- **Decision:** Create an expression GIN index in a TypeORM migration:
  ```sql
  CREATE INDEX "IDX_document_chunks_content_tsv" 
  ON "document_chunks" 
  USING GIN (to_tsvector('english', "content"));
  ```
- **Rationale:** An expression index requires zero alterations to the existing `document_chunks` table schema, zero modifications to `DocumentChunkEntity` column definitions, and zero changes to existing ingestion chunk write queries. PostgreSQL automatically routes queries containing `to_tsvector('english', documentChunk.content) @@ websearch_to_tsquery('english', :query)` to this GIN index.
- **Alternatives Considered:** A stored generated column (`search_vector tsvector GENERATED ALWAYS AS ... STORED`). While queryable, it modifies physical column definitions and increases migration complexity without runtime performance benefits over expression GIN.

### 2. Lexical Query Parsing: `websearch_to_tsquery` vs `plainto_tsquery`
- **Decision:** Use `websearch_to_tsquery('english', :query)`.
- **Rationale:** Unlike `to_tsquery` (which throws SQL syntax errors on unformatted user strings containing spaces, hyphens, or unclosed quotes) or `plainto_tsquery` (which strips boolean operators), `websearch_to_tsquery` safely handles natural search expressions including phrases (`"exact match"`), negative terms (`-exclude`), and `OR` logic without raising database syntax exceptions.
- **Security:** All user query strings are strictly passed as parameterized query arguments via TypeORM's query builder.

### 3. Application-Layer RRF vs Database SQL CTE Fusion
- **Decision:** Implement Reciprocal Rank Fusion as an isolated application-layer TypeScript utility (`reciprocal-rank-fusion.ts`).
- **Rationale:**
  1. Decouples vector retrieval and keyword retrieval into independent queries that run concurrently via `Promise.all`.
  2. Enables keyword search to execute immediately while query embedding generation is pending, minimizing total latency.
  3. Enables unit testing of the RRF algorithm, rank ordering, edge cases (empty lists, disjoint sets, ties), and metadata retention in complete isolation without database dependencies.
  4. Provides clean error boundary: if keyword search fails, vector search results can be used directly without complex SQL error recovery.

### 4. Reciprocal Rank Fusion Algorithm & Tie-Breaking
- **Formula:**
  $$\text{RRF}(d) = \sum_{m \in \{\text{vector}, \text{keyword}\}} \frac{1}{k + \text{rank}_m(d)}$$
  Where:
  - $k = 60$ (default, configurable via `HYBRID_SEARCH_RRF_K`).
  - $\text{rank}_m(d)$ is 1-based (i.e., top candidate is rank 1).
  - If a chunk is absent from a retrieval method, its score contribution for that method is 0.
- **Tie-Breaking:**
  - Primary sort: Combined RRF score descending.
  - Secondary tie-breaker: Presence in vector search results (vector rank ascending).
  - Tertiary tie-breaker: Stable alphanumeric string comparison on chunk ID (`a.id.localeCompare(b.id)`).
- **Candidate Merging:**
  - Unique candidates identified by chunk `id`.
  - Content, heading path, versionId, chunkIndex, page numbers, and metadataJson are preserved from the source chunk.
  - The `similarity` property on `CandidateChunk` is populated with the computed RRF score for citation metadata compatibility.

### 5. Concurrent Retrieval Orchestration Flow
When `HYBRID_SEARCH_ENABLED=true`:
```text
User Query
    │
    ├──> Query Validation
    │
    ├───┬──────────────────────────────────────────────────────────┐
    │   ▼ (Concurrent Branch A: Keyword Search)                    ▼ (Concurrent Branch B: Vector Search)
    │   Execute PostgreSQL FTS Query                               Query Embedding Provider
    │   `websearch_to_tsquery('english', :query)`                  Generate 768d dense vector
    │   LIMIT 20                                                   Query pgvector cosine similarity
    │   Returns top 20 keyword candidates                          LIMIT 20 (similarity >= threshold)
    │                                                              Returns top 20 vector candidates
    └───┴──────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                         Promise.all Settlement
             (On keyword error: log warning & use vector candidates)
                                    │
                                    ▼
                         Reciprocal Rank Fusion
                      Deduplicate + Accumulate RRF
                        Deterministic Tie-Breaker
                                    │
                                    ▼
                            Top 8 Candidates
                                    │
                                    ▼
                    (Optional: Qwen3 Reranker Stage)
                                    │
                                    ▼
                     ChatContextAssembler / Stream
```

### 6. Configuration & Feature Flags
Typed environment configuration in `env.validation.ts` and `AppConfigService`:
- `HYBRID_SEARCH_ENABLED`: boolean (default `false`)
- `HYBRID_SEARCH_VECTOR_TOP_K`: number (default `20`)
- `HYBRID_SEARCH_KEYWORD_TOP_K`: number (default `20`)
- `HYBRID_SEARCH_RRF_K`: number (default `60`)
- `HYBRID_SEARCH_FINAL_TOP_K`: number (default `8`)

## Risks / Trade-offs

- **[Risk] Natural language queries containing unusual symbols or stop words yield zero FTS matches.**
  - *Mitigation:* `websearch_to_tsquery` gracefully handles punctuation and stop words. If keyword search returns zero matches, RRF operates solely on vector candidates without penalty or error.
- **[Risk] Keyword search failure causes chat service interruption.**
  - *Mitigation:* Keyword search execution is wrapped in a dedicated `try/catch`. Any database error, timeout, or query parsing failure logs a structured error event (`LogEvents.RETRIEVAL_KEYWORD_FALLBACK`) and falls back immediately to the vector search result set.
- **[Risk] Score incompatibility between cosine similarity (0 to 1) and RRF values (~0.01 to ~0.03).**
  - *Mitigation:* RRF values are monotonic ranks. Downstream prompt assembly formats chunks by rank order rather than numerical thresholding. Similarity thresholding is performed upstream within the vector search query before RRF fusion.

## Migration Plan

1. **Migration Script:** Create `AddDocumentChunksContentFtsIndex` TypeORM migration:
   - `up`: `CREATE INDEX "IDX_document_chunks_content_tsv" ON "document_chunks" USING GIN (to_tsvector('english', "content"));`
   - `down`: `DROP INDEX "public"."IDX_document_chunks_content_tsv";`
2. **Backward Compatibility:** Index creation is purely additive. If `HYBRID_SEARCH_ENABLED=false`, the existing vector-only query path executes identically with zero query changes.
