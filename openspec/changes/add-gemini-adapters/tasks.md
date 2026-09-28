## 1. Dependencies & Configuration

- [x] 1.1 Add Google GenAI SDK dependency (`@google/genai` or `@google/generative-ai`) to `apps/backend/package.json` and verify `pnpm install` succeeds.
- [x] 1.2 Add Gemini configuration fields (`GEMINI_API_KEY`, `GEMINI_CHAT_MODEL`, `GEMINI_EMBEDDING_MODEL`) to `AppConfigService` with safe default fallbacks.

## 2. Gemini Chat Adapter

- [x] 2.1 Implement `GeminiLlmProvider` under `apps/backend/src/chat/providers/gemini-llm.provider.ts` implementing `ILlmProvider` with stateful chat history conversion, streaming tokens, AbortSignal handling, and CircuitBreaker/RetryPolicy resilience.
- [x] 2.2 Add unit test suite `apps/backend/src/chat/__tests__/gemini-llm.provider.spec.ts` mocking the Google SDK and verify all scenarios (happy path streaming, history turns, abort cancellation, rate limit retry, circuit breaker trip) pass.

## 3. Gemini Embedding Adapter

- [x] 3.1 Implement `GeminiEmbeddingProvider` under `apps/backend/src/ingestion/embeddings/providers/gemini-embedding.provider.ts` implementing `IEmbeddingProvider` with batch embedding generation and CircuitBreaker/RetryPolicy resilience.
- [x] 3.2 Add unit test suite `apps/backend/src/ingestion/__tests__/gemini-embedding.provider.spec.ts` mocking SDK batch embedding calls and verify all scenarios pass.

## 4. Provider Registry & Safety Verification

- [x] 4.1 Export new providers from their respective module barrel files while ensuring `ChatModule` and `IngestionModule` retain `OllamaLlmProvider` and `OllamaEmbeddingProvider` as the active runtime providers.
- [x] 4.2 Run full test suite and typecheck to verify zero regressions and confirm external API calls are not executed during standard test runs.
