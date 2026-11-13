## 1. Domain Exceptions and Query Validation Layer

- [x] 1.1 Create `InvalidQueryException` and `EmbeddingDimensionMismatchException` domain exceptions in `apps/backend/src/retrieval/exceptions/` and verify unit tests pass.
- [x] 1.2 Implement `RetrievalQueryValidator` service in `apps/backend/src/retrieval/services/` enforcing non-empty, length bounds, single-word low-context rejection, and character entropy checks, verifying with unit tests.

## 2. Vector Search Repository & Retrieval Service

- [x] 2.1 Implement `VectorSearchRepository` in `apps/backend/src/retrieval/repositories/` executing parameterized `pgvector` cosine similarity SQL search against `document_chunks` table.
- [x] 2.2 Implement `RetrievalService` in `apps/backend/src/retrieval/services/` connecting validation, embedding generation via `IEmbeddingProvider`, embedding size check, vector search, and score thresholding.
- [x] 2.3 Construct `RetrievalModule` in `apps/backend/src/retrieval/retrieval.module.ts` registering services, repositories, and context logger providers.

## 3. Mandatory Tests & Verification

- [x] 3.1 Implement unit tests for happy path query embedding and candidate chunk retrieval in `apps/backend/src/retrieval/__tests__/retrieval.service.spec.ts`.
- [x] 3.2 Implement unhappy path tests for invalid user query, embedding size mismatch exception, and missing/low-similarity candidate chunks.
- [x] 3.3 Run `pnpm --filter backend test` and confirm all `retrieval` test suites pass cleanly.
