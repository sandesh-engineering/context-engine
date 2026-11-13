## 1. Database Migration & Schema Indexing

- [x] 1.1 Create TypeORM database migration introducing GIN expression index on `to_tsvector('english', "content")` for `document_chunks` and verify migration up and down queries
- [x] 1.2 Verify migration script registers in TypeORM migration configuration and compiles cleanly

## 2. Configuration & Observability

- [x] 2.1 Add typed configuration properties to `env.validation.ts` and `AppConfigService` (`HYBRID_SEARCH_ENABLED`, `HYBRID_SEARCH_VECTOR_TOP_K`, `HYBRID_SEARCH_KEYWORD_TOP_K`, `HYBRID_SEARCH_RRF_K`, `HYBRID_SEARCH_FINAL_TOP_K`)
- [x] 2.2 Add structured logging event definitions to `log-events.ts` and semantic trace attributes to `app-tracer.ts` for keyword search and RRF fusion

## 3. Reciprocal Rank Fusion (RRF) Utility

- [x] 3.1 Implement pure, reusable RRF utility in `reciprocal-rank-fusion.ts` supporting 1-based ranks, configurable $k$ (default 60), candidate deduplication, score accumulation, deterministic tie-breaking, and metadata preservation
- [x] 3.2 Add comprehensive unit test suite in `reciprocal-rank-fusion.spec.ts` testing formula correctness, rank indexing, deduplication, disjoint sets, score accumulation, empty arrays, tie-breaking, top-N truncation, and metadata preservation

## 4. PostgreSQL Keyword Search

- [x] 4.1 Implement `searchByKeywords` method in `VectorSearchRepository` using `websearch_to_tsquery('english', :query)` and `ts_rank_cd` over parameterized queries
- [x] 4.2 Validate keyword search parameters and typing (repository layer testing omitted per instruction; tested at service layer)

## 5. Retrieval Pipeline Integration & Fallback Handling

- [x] 5.1 Update `RetrievalService.retrieveCandidates` to execute vector and keyword search concurrently via `Promise.all` when `HYBRID_SEARCH_ENABLED=true`
- [x] 5.2 Implement graceful fallback to vector-only results when keyword search encounters database errors or query failure with structured warning logging
- [x] 5.3 Verify vector-only path executes identically to existing behavior when `HYBRID_SEARCH_ENABLED=false`
- [x] 5.4 Ensure merged candidates seamlessly flow into `ChatContextAssembler` with preserved citations and chunk identifiers

## 6. Regression Testing & Validation

- [x] 6.1 Add integration and pipeline unit tests in `retrieval.service.spec.ts` covering feature flag enabled vs disabled, keyword fallback, and empty candidate handling
- [x] 6.2 Execute backend test suite (`pnpm --filter backend test`) and monorepo typecheck (`pnpm check-types`) to confirm zero regressions
