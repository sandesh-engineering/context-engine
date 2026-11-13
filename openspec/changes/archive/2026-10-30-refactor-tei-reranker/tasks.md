## 1. Interface & Type System Refactoring

- [x] 1.1 Refactor `apps/backend/src/retrieval/interfaces/reranker-provider.interface.ts` to introduce `IRerankerProvider`, export `type IQwenRerankerProvider = IRerankerProvider` for backward compatibility, and define strict types for TEI (`TeiRerankRequest`, `TeiRerankResponseItem`). Verify compilation with `npm run build` or `npx tsc --noEmit`.

## 2. Configuration & Environment Updates

- [x] 2.1 Update `apps/backend/src/config/env.validation.ts` to add `RERANKER_PROVIDER_TYPE` (`'tei' | 'ollama'`, default `'tei'`), `RERANKER_URL` (default `http://localhost:8081`), and align default endpoint (`/rerank`) and model (`cross-encoder/ms-marco-MiniLM-L-6-v2`). Verify schema validation with existing env tests.
- [x] 2.2 Update `apps/backend/src/config/app-config.service.ts` to add getters for `rerankerProviderType` and resolve `rerankerBaseUrl` using `RERANKER_URL` when provided. Verify TypeScript type checking passes.

## 3. TEI Reranker Provider Implementation

- [x] 3.1 Implement `apps/backend/src/retrieval/providers/http-tei-reranker.provider.ts` implementing `IRerankerProvider` with native `fetch`, `CircuitBreaker`, `AbortSignal` timeout propagation, and strict validation of indices and finite scores. Verify by compiling the provider.
- [x] 3.2 Update `apps/backend/src/retrieval/retrieval.module.ts` to configure `RERANKER_PROVIDER` with a NestJS `useFactory` provider that instantiates `HttpTeiRerankerProvider` or `HttpQwenRerankerProvider` based on `rerankerProviderType`. Verify module initializes cleanly.

## 4. Targeted Provider Verification & Regression Testing

- [x] 4.1 Create targeted unit test suite `apps/backend/src/retrieval/providers/__tests__/http-tei-reranker.provider.spec.ts` covering success paths, empty input bypass, network errors, circuit breaker trips, timeouts, and malformed TEI responses using an injected mock `fetchFn`. Verify with `npm test -- src/retrieval/providers/__tests__/http-tei-reranker.provider.spec.ts`.
- [x] 4.2 Run existing retrieval unit tests in `apps/backend/src/retrieval/__tests__/retrieval-reranker.spec.ts` to guarantee zero regression on candidate ranking, fallback handling, and OpenTelemetry instrumentation.
