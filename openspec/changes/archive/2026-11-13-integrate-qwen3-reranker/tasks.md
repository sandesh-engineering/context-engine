## 1. Environment & Configuration

- [x] 1.1 Add typed reranker environment variables to `apps/backend/src/config/env.validation.ts` (`RERANKING_ENABLED`, `RERANKER_BASE_URL`, `RERANKER_ENDPOINT_PATH`, `RERANKER_MODEL_NAME`, `RERANKER_TIMEOUT_MS`, `RERANKER_CANDIDATES_TOP_K`, `RERANKER_FINAL_TOP_K`) defaulting `RERANKER_BASE_URL` to Ollama (`http://localhost:11434`), and verify schema parsing with unit test.
- [x] 1.2 Expose typed getters in `apps/backend/src/config/app-config.service.ts` and document default variables in `apps/backend/.env.example`.

## 2. Model Verification & Smoke Test

- [x] 2.1 Create standalone model smoke test script `apps/backend/scripts/smoke-test-reranker.ts` verifying Ollama reranker HTTP connectivity, endpoint schemas, and score separation between relevant and irrelevant documents.

## 3. Reranker Provider Abstraction & HTTP Client

- [x] 3.1 Define `IQwenRerankerProvider` interface, candidate types, and `RERANKER_PROVIDER` injection token in `apps/backend/src/retrieval/interfaces/reranker-provider.interface.ts`.
- [x] 3.2 Implement `HttpQwenRerankerProvider` in `apps/backend/src/retrieval/providers/http-qwen-reranker.provider.ts` using native `fetch`, `AbortSignal` timeout, `CircuitBreaker`, and score-to-chunk index mapping.
- [x] 3.3 Create unit test suite `apps/backend/src/retrieval/providers/__tests__/http-qwen-reranker.provider.spec.ts` testing successful scoring, score-to-candidate ID mapping, request timeout handling, HTTP error handling, and malformed response rejection.

## 4. Retrieval Pipeline Integration & Fallback

- [x] 4.1 Update `apps/backend/src/retrieval/services/retrieval.service.ts` to orchestrate reranking when `RERANKING_ENABLED=true`, expanding initial vector candidate pool and slicing top-N reranked chunks.
- [x] 4.2 Implement resilient fallback in `RetrievalService` that reverts to original vector similarity ordering when the reranker fails or times out without raising user-facing errors.
- [x] 4.3 Register `HttpQwenRerankerProvider` and dependencies inside `apps/backend/src/retrieval/retrieval.module.ts`.
- [x] 4.4 Create integration unit tests in `apps/backend/src/retrieval/__tests__/retrieval-reranker.spec.ts` covering feature flag disabled baseline, successful reranking, stable score tie-breaking, zero-candidate bypass, and fallback activation.
- [x] 4.5 Propagate reranker integration into chat pipeline: forward `topK` / `similarityThreshold` in `SendMessageDto` and `ChatController`, incorporate reranked candidates into LLM context, and persist reranked status in assistant message metadata and SSE stream.

## 5. Observability & Tracing

- [x] 5.1 Define reranking log events in `apps/backend/src/common/logger/log-events.ts` (`RETRIEVAL_RERANK_STARTED`, `RETRIEVAL_RERANK_COMPLETED`, `RETRIEVAL_RERANK_FALLBACK`).
- [x] 5.2 Add reranking OpenTelemetry semantic attributes in `apps/backend/src/common/telemetry/app-tracer.ts` (`rag.rerank.*`) and wrap reranking execution in active trace span `retrieval.rerank`.
- [x] 5.3 Verify trace span attributes and structured logs in unit tests, ensuring no raw document content is emitted to log sinks.

## 6. Evaluation Harness & Final Verification

- [x] 6.1 Create evaluation script `apps/backend/scripts/evaluate-reranking.ts` running test query suites (factual, multi-chunk, ambiguous, no-evidence) to record original vs reranked positions, final context selection, and latency.
- [ ] 6.2 Execute full backend test suite (`pnpm --filter backend test`) and type check (`pnpm --filter backend check-types`) to verify zero regressions across existing retrieval and chat pipelines.
