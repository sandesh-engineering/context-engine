## Context

The Knowledge Engine currently performs dense vector similarity retrieval via PostgreSQL `pgvector` (`VectorSearchRepository.searchSimilarChunks`) and feeds candidates to `ChatContextAssembler.assembleContext` before invoking generative LLMs (`OllamaLlmProvider` or `GeminiLlmProvider`).

External HTTP integrations in the codebase adhere to established patterns:
- Native Node 24 `fetch` with `AbortSignal`.
- Resilience wrapped in `CircuitBreaker` and `RetryPolicy` (`apps/backend/src/ingestion/resilience/`).
- Centralized configuration via `env.validation.ts`, `AppConfigService`, and `env-loader.ts`.
- Distributed tracing through OpenTelemetry (`AppTracer.traceSpan`) and structured event logging (`StructuredLogger`, `LogEvents`).

Integrating Qwen3-Reranker-4B (hosted manually in local Ollama) provides a second-stage cross-encoder that improves precision and ranking accuracy without modifying database schema, embeddings, or ingestion stages, and without requiring separate Docker containers.

## Goals / Non-Goals

**Goals:**
- Target Qwen3-Reranker-4B hosted manually inside local Ollama (`http://localhost:11434`), eliminating new Docker infrastructure overhead.
- Establish an abstract provider contract (`IQwenRerankerProvider`) with dependency injection token `RERANKER_PROVIDER`.
- Implement concrete `HttpQwenRerankerProvider` with timeout control, circuit breaker protection, response validation, and candidate ID mapping.
- Orchestrate reranking in `RetrievalService` behind the `RERANKING_ENABLED` feature flag with seamless fallback to vector search order upon any failure.
- Record structured OpenTelemetry spans and diagnostic logs comparing original vector ranks against reranked positions.
- Provide a reproducible evaluation script and smoke test for before/after comparison.

**Non-Goals:**
- Running separate Docker Model Runner or vLLM containers.
- Hybrid search (sparse BM25 / full-text indexing + dense vector fusion).
- Query rewriting, expansion, or agentic retrieval loops.
- Modifying ingestion worker, document chunking, or persistent embeddings.
- Introducing new queue brokers (RabbitMQ) or asynchronous job pipelines for interactive RAG retrieval.
- Altering frontend UI components.

## Decisions

### 1. Model Deployment & Endpoint Target
- **Decision**: Host Qwen3-Reranker-4B manually inside the local Ollama instance (`http://localhost:11434`).
- **Rationale**: Reuses the existing Ollama service already configured in the codebase (`AppConfigService.ollamaBaseUrl`), avoiding new Docker containers, port collisions, or GPU resource contention between multiple runtimes.
- **Endpoint & Configuration**:
  - `RERANKER_BASE_URL`: `http://localhost:11434` (defaults to Ollama)
  - `RERANKER_MODEL_NAME`: `qwen3-reranker`
  - `RERANKER_ENDPOINT_PATH`: `/api/rerank` (configurable to support custom routing or adapter endpoints)
- **Request/Response Schema**:
  - Request:
    ```json
    {
      "model": "qwen3-reranker",
      "query": "user question",
      "documents": ["chunk text 1", "chunk text 2"]
    }
    ```
  - Response:
    ```json
    {
      "results": [
        { "index": 0, "relevance_score": 0.892 },
        { "index": 1, "relevance_score": 0.124 }
      ]
    }
    ```

### 2. Architecture & Provider Abstraction
- **Decision**: Define `IQwenRerankerProvider` interface in `apps/backend/src/retrieval/interfaces/reranker-provider.interface.ts` and inject via token `RERANKER_PROVIDER`.
- **Rationale**: Adheres to SOLID Dependency Inversion Principle (DIP). Allows trivial mocking in unit tests, prevents tight coupling between retrieval logic and HTTP/vendor details, and permits alternate cross-encoder models in future phases.
- **Contract**:
  ```typescript
  export interface RerankCandidate {
    id: string;
    content: string;
  }

  export interface RerankResultItem {
    id: string;
    index: number;
    relevanceScore: number;
  }

  export interface RerankResponse {
    results: RerankResultItem[];
    modelName: string;
    durationMs: number;
  }

  export interface IQwenRerankerProvider {
    rerank(
      query: string,
      candidates: RerankCandidate[],
      options?: { signal?: AbortSignal },
    ): Promise<RerankResponse>;
  }
  ```

### 3. Pipeline Insertion & Retrieval Orchestration
- **Decision**: Embed reranking orchestration within `RetrievalService.retrieveCandidates()` (or dedicated helper method) rather than dispersing logic across `ChatService`.
- **Rationale**: Keeps `ChatService` focused on conversation session management and SSE streaming. `RetrievalService` already manages candidate vector search, metrics, and fail-fast logging.
- **Execution Flow**:
  1. If `RERANKING_ENABLED=true`:
     - Initial pgvector search queries `topK = RERANKER_CANDIDATES_TOP_K` (default: 30) instead of 5.
     - If candidate count is 0, return immediately (zero-candidate bypass).
     - Execute `AppTracer.traceSpan('retrieval.rerank')`.
     - Call `rerankerProvider.rerank(sanitizedQuery, candidates)`.
     - Map relevance scores back to `CandidateChunk` instances, sort descending by score (with stable tie-breaking on original vector similarity rank).
     - Select the top `RERANKER_FINAL_TOP_K` (default: 5) chunks.
     - If any exception occurs in the reranker, log structured warning `retrieval.rerank.fallback`, capture error in span, and fall back to top 5 of original vector order.
  2. If `RERANKING_ENABLED=false`:
     - Query pgvector directly with `topK = 5` and return immediately. Baseline performance remains 100% unchanged.

### 4. Resilience & Error Handling
- **Decision**: Equip `HttpQwenRerankerProvider` with a local `CircuitBreaker` instance (`failureThreshold: 5`, `resetTimeoutMs: 30000`) and strict `AbortSignal` timeout (`RERANKER_TIMEOUT_MS: 5000`).
- **Rationale**: Reranking is on the critical interactive path of chat responses. Inference delays must never hang the HTTP client or starve application threads. When the circuit breaker is OPEN, reranking fails fast in microseconds and immediately activates the vector search fallback.

### 5. Diagnostics & Observability
- **Decision**: Reuse `AppTracer` and `StructuredLogger` without introducing new telemetry dependencies.
- **Semantic Attributes**:
  - `rag.rerank.enabled`: boolean
  - `rag.rerank.model`: string
  - `rag.rerank.candidates_in`: number
  - `rag.rerank.candidates_out`: number
  - `rag.rerank.fallback`: boolean
  - `rag.rerank.duration_ms`: number
- **Structured Log Events**:
  - `RETRIEVAL_RERANK_STARTED`: `'retrieval.rerank.started'`
  - `RETRIEVAL_RERANK_COMPLETED`: `'retrieval.rerank.completed'`
  - `RETRIEVAL_RERANK_FALLBACK`: `'retrieval.rerank.fallback'`

## Risks / Trade-offs

- **[Risk: Additional Latency on Chat Generation]** → **Mitigation**: Bounded candidate pool (30 candidates maximum), local Ollama acceleration, and a strict 5000ms timeout with circuit breaker fallback.
- **[Risk: Ollama Endpoint Path Variance]** → **Mitigation**: Configuration allows overriding endpoint path via `RERANKER_ENDPOINT_PATH` (defaults to `/api/rerank`).
- **[Risk: Candidate Score Inversion / Misaligned Mapping]** → **Mitigation**: Unit tests rigorously assert score-to-chunk ID mapping across randomly permuted score lists and stable order preservation for score ties.
- **[Risk: Reranker Model Not Yet Loaded in Ollama]** → **Mitigation**: Default `RERANKING_ENABLED=false` prevents startup failure; automated tests use mock provider; smoke test script verifies Ollama connectivity and model presence.

## Migration & Rollback Plan

- **Enablement**: Load the reranker model into Ollama and set `RERANKING_ENABLED=true` in `apps/backend/.env`.
- **Rollback**: Set `RERANKING_ENABLED=false` in `apps/backend/.env`. No database migrations, data cleanup, or code reverts required.
