## Why

Dense vector embedding search (bi-encoder similarity) excels at broad candidate recall across large document corpora, but can struggle with subtle semantic distinctions, query-document interaction nuance, and keyword precision. Integrating a neural cross-encoder reranker (Qwen3-Reranker-4B hosted manually inside local Ollama) provides deep, full-attention interaction between the user query and candidate chunks, significantly boosting precision-at-k and context quality for downstream LLM answer generation without altering ingestion, chunking, or persistent vector representations.

Operating behind an environment-driven feature flag ensures zero behavioral regression for the existing pipeline, safe local development, and graceful fallback when Ollama reranking is disabled or encounters timeouts.

## What Changes

- **Ollama-Hosted Reranker Integration**: Target Qwen3-Reranker hosted directly inside local Ollama (`http://localhost:11434`), avoiding separate Docker container deployments.
- **Reranker Client Abstraction & Provider**: Decoupled `IQwenRerankerProvider` interface and concrete HTTP provider with native `fetch`, circuit breaker protection, configurable timeout (`AbortSignal`), input/output validation, and score-to-chunk mapping.
- **Environment Configuration & Feature Flags**: Add typed configuration in `env.validation.ts` and `AppConfigService`:
  - `RERANKING_ENABLED` (boolean, default: `false`)
  - `RERANKER_BASE_URL` (string, default: `http://localhost:11434`)
  - `RERANKER_MODEL_NAME` (string, default: `qwen3-reranker`)
  - `RERANKER_ENDPOINT_PATH` (string, default: `/api/rerank`)
  - `RERANKER_TIMEOUT_MS` (number, default: `5000`)
  - `RERANKER_CANDIDATES_TOP_K` (number, default: `30`)
  - `RERANKER_FINAL_TOP_K` (number, default: `5`)
- **Retrieval Orchestration Integration**: When `RERANKING_ENABLED=true`, retrieve an expanded candidate pool (e.g. 30 candidates), invoke the reranker, sort by relevance score, slice the top-N (e.g. 5), and pass to `ChatContextAssembler`. Preserves all chunk IDs, version IDs, heading paths, page ranges, and citation metadata.
- **Fail-Safe Fallback Handling**: On reranker timeout, network failure, circuit breaker trip, or malformed response, automatically fall back to original vector search ranking without user-facing failures, logging structured fallback diagnostics.
- **Observability & Diagnostics**: Record trace spans (`retrieval.rerank`) with candidate chunk IDs, original positions, reranked positions, relevance scores, selected context IDs, duration, and fallback status using `AppTracer` and `StructuredLogger`.
- **Reproducible Evaluation & Smoke Testing**: Scripted evaluation harness comparing original vector retrieval versus reranked retrieval across factual, multi-chunk, ambiguous, and out-of-domain query sets.

## Capabilities

### New Capabilities
- `retrieval/reranking`: Optional neural cross-encoder reranking stage for candidate chunks using Qwen3-Reranker-4B hosted in Ollama behind an environment-based feature flag.

### Modified Capabilities

None. Existing vector retrieval, embedding generation, database schema, and LLM chat streaming retain identical behavior and contracts when reranking is disabled or during fallback.

## Impact

- **Backend Modules**:
  - `apps/backend/src/retrieval/`: New reranker provider, interfaces, and updated `RetrievalService` or pipeline orchestrator.
  - `apps/backend/src/chat/services/chat.service.ts`: Supplies reranked candidate set to `ChatContextAssembler`.
  - `apps/backend/src/config/`: New environment variables in `env.validation.ts` and `AppConfigService`.
  - `apps/backend/src/common/logger/log-events.ts`: New event keys for reranker operations and fallback events.
  - `apps/backend/src/common/telemetry/app-tracer.ts`: Semantic attributes for rerank diagnostics.
- **Infrastructure**:
  - Zero new Docker container setups; utilizes the existing Ollama instance where the reranker model is loaded manually.
- **Dependencies & APIs**: Zero new npm dependencies; uses existing native `fetch`, TypeORM entities, and resilience utilities.
