## Why

While dense vector similarity search (using `pgvector`) excels at capturing semantic intent and broad conceptual matches, it frequently underperforms on exact keyword queries, unique identifiers, code snippets, acronyms, and technical terminology. Integrating PostgreSQL native Full-Text Search (FTS) alongside pgvector similarity search provides sparse lexical precision to complement dense semantic recall. 

Using Reciprocal Rank Fusion (RRF) combines these two distinct ranking domains in the application layer without requiring problematic score normalization across disparate metric scales. Operating behind an environment configuration flag (`HYBRID_SEARCH_ENABLED=false` by default) ensures complete backward compatibility and prevents regression in the existing vector-only retrieval and chat streaming pipeline.

## What Changes

- **PostgreSQL Full-Text Search Migration & Repository**:
  - Introduce a database migration adding a PostgreSQL GIN index on `document_chunks` over `to_tsvector('english', content)` for performant sparse lexical queries.
  - Implement a dedicated keyword search query method (or repository method) using parameterized SQL queries with `websearch_to_tsquery('english', :query)` and `ts_rank_cd`, respecting the identical eligible chunk population and boundaries as vector search.
- **Reciprocal Rank Fusion (RRF) Utility**:
  - Implement a pure, reusable, deterministic RRF fusion utility in the application layer.
  - Formula: $\text{RRF}(d) = \sum_{m} \frac{1}{k + \text{rank}_m(d)}$, with default $k = 60$ and 1-based ranks.
  - Merges vector candidates (top 20) and keyword candidates (top 20), deduplicates by chunk ID, accumulates fusion scores, applies deterministic tie-breaking (combined score DESC, then candidate priority, then chunk ID), and slices top $N$ candidates (default 8).
- **Retrieval Pipeline Concurrency & Integration**:
  - Update `RetrievalService` to execute vector search and keyword search concurrently via `Promise.all` when `HYBRID_SEARCH_ENABLED=true`.
  - Keyword search begins immediately in parallel with vector search once the query is validated (keyword search does not wait on query embedding generation).
  - Handle empty retrieval results safely; if keyword search encounters a database failure or query syntax error, fall back to vector-only results with structured logging rather than aborting valid user chat requests.
  - Pass the merged top $N$ candidate chunks seamlessly to downstream `ChatContextAssembler` and LLM streaming pipeline, retaining all citation metadata, chunk IDs, and source references.
- **Typed Configuration & Observability**:
  - Add typed environment variables in `env.validation.ts` and `AppConfigService`:
    - `HYBRID_SEARCH_ENABLED` (boolean, default: `false`)
    - `HYBRID_SEARCH_VECTOR_TOP_K` (number, default: `20`)
    - `HYBRID_SEARCH_KEYWORD_TOP_K` (number, default: `20`)
    - `HYBRID_SEARCH_RRF_K` (number, default: `60`)
    - `HYBRID_SEARCH_FINAL_TOP_K` (number, default: `8`)
  - Instrument OpenTelemetry trace spans (`retrieval.keyword_search`, `retrieval.rrf_fusion`) and structured logger events for hybrid retrieval lifecycle and fallback diagnostics.

## Capabilities

### New Capabilities
- `retrieval/hybrid-search`: Hybrid candidate retrieval combining pgvector dense similarity search and PostgreSQL full-text keyword search via Reciprocal Rank Fusion (RRF) behind a feature flag.

### Modified Capabilities
- None. Existing vector-only search, reranker support, and LLM chat streaming retain identical behavior and public API contracts when `HYBRID_SEARCH_ENABLED=false`.

## Impact

- **Backend Architecture**:
  - `apps/backend/src/retrieval/`: New RRF utility, keyword search repository method or service, updated `RetrievalService`.
  - `apps/backend/src/config/`: New hybrid search configuration properties in `env.validation.ts` and `AppConfigService`.
  - `apps/backend/src/database/migrations/`: New migration adding GIN full-text index on `document_chunks`.
  - `apps/backend/src/common/telemetry/` & `apps/backend/src/common/logger/`: Semantic trace attributes and structured log events for hybrid search.
- **Public APIs & Contracts**:
  - Zero breaking changes to existing REST/SSE chat endpoints or `retrievalService.retrieveCandidates` return signatures. `CandidateChunk` interface remains compatible.
- **Dependencies**:
  - Zero new external runtime dependencies; uses PostgreSQL native full-text search and standard TypeScript application logic.
