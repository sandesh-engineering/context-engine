## Why

The current reranker implementation (`HttpQwenRerankerProvider`) relies on prompt-based generative completion via local Ollama (`/api/generate`) with fragile JSON extraction. In contrast, `apps/backend/docker-compose.dev.yaml` defines a dedicated cross-encoder service powered by Hugging Face `text-embeddings-inference` (`ghcr.io/huggingface/text-embeddings-inference:cpu-1.8`) exposing high-performance, purpose-built neural cross-encoder scoring (`POST /rerank`) over models such as `cross-encoder/ms-marco-MiniLM-L-6-v2` or `BAAI/bge-reranker-base`.

Refactoring to use this TEI reranker—runnable either standalone or via Docker Compose on port 8081—drastically reduces inference latency, eliminates JSON parsing fragility, and aligns the application runtime with the infrastructure defined in `docker-compose.dev.yaml`. Designing this refactor with strict SOLID principles, generic provider abstractions, and backward-compatible interfaces ensures zero regression for existing retrieval flows, hybrid search, and telemetry.

## What Changes

- **TEI Cross-Encoder Provider (`HttpTeiRerankerProvider`)**: Implement a dedicated provider targeting the native Hugging Face Text Embeddings Inference `/rerank` REST specification (`POST /rerank` with `{ query: string, texts: string[] }` returning `Array<{ index: number, score: number }>`).
- **Provider Interface Refactoring & Aliasing**: Introduce generic `IRerankerProvider` contract in `src/retrieval/interfaces/reranker-provider.interface.ts`. Retain `IQwenRerankerProvider` as a type alias and keep `RERANKER_PROVIDER` injection token to guarantee 100% backward compatibility and zero consumer breakage.
- **Dynamic Provider Resolution in `RetrievalModule`**: Provide a factory provider for `RERANKER_PROVIDER` that instantiates `HttpTeiRerankerProvider` (or legacy `HttpQwenRerankerProvider` based on `RERANKER_PROVIDER_TYPE` / configuration), defaulting to TEI.
- **Environment & Configuration Alignment**:
  - Add `RERANKER_PROVIDER_TYPE` (`tei` | `ollama`, defaulting to `tei`).
  - Support `RERANKER_URL` (used in `docker-compose.dev.yaml` comment `http://localhost:8081`) while maintaining backward compatibility with `RERANKER_BASE_URL`.
  - Update default reranker port to `8081` and endpoint to `/rerank` when using TEI.
  - Update default model name to `cross-encoder/ms-marco-MiniLM-L-6-v2`.
- **Strict Typing & Robust Validation**: Define strict TypeScript interfaces for TEI request/response payloads with full boundary validation (index bounds, NaN/infinite score checks, duplicate index checks, non-null assertions avoided).
- **Circuit Breaker & Fallback Preservation**: Maintain existing circuit breaker, request timeout propagation via `AbortSignal`, and automatic fallback to dense vector / RRF order on any reranker failure.

## Capabilities

### New Capabilities
- `retrieval/reranking`: Neural cross-encoder candidate reranking using the containerized/standalone Hugging Face Text Embeddings Inference (TEI) service with resilient fallback.

### Modified Capabilities
None. Existing vector similarity search, hybrid search (pgvector + FTS + RRF), and chat streaming preserve identical behavior and interfaces.

## Impact

- **Backend Code**:
  - `apps/backend/src/retrieval/interfaces/reranker-provider.interface.ts`: Generic `IRerankerProvider` interface, backward-compatible `IQwenRerankerProvider` alias, strictly typed TEI types.
  - `apps/backend/src/retrieval/providers/http-tei-reranker.provider.ts`: New TEI reranker HTTP provider.
  - `apps/backend/src/retrieval/retrieval.module.ts`: Updated provider factory binding `RERANKER_PROVIDER`.
  - `apps/backend/src/config/env.validation.ts` & `apps/backend/src/config/app-config.service.ts`: Added `RERANKER_PROVIDER_TYPE`, support `RERANKER_URL`, default to port `8081` and `/rerank`.
- **Docker Compose & Infrastructure**:
  - `apps/backend/docker-compose.dev.yaml`: Existing standalone/profiled reranker service verified and integrated directly.
- **External Dependencies**:
  - Zero external third-party API calls; standalone local/container inference only.
  - Zero new npm dependencies; uses native `fetch`, existing `CircuitBreaker`, and Zod validation.
