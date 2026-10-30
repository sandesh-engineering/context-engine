## Context

`apps/backend/docker-compose.dev.yaml` includes an optional service:
```yaml
  reranker:
    image: ghcr.io/huggingface/text-embeddings-inference:cpu-1.8
    container_name: frogtoberfest_reranker_dev
    profiles: [ "reranker" ]
    command: [ "--model-id", "${RERANKER_MODEL:-cross-encoder/ms-marco-MiniLM-L-6-v2}", "--max-batch-tokens", "4096" ]
    ports:
      - "8081:80"
```
Currently, the codebase contains `HttpQwenRerankerProvider`, which formats a natural language prompt instructing Ollama (`/api/generate`) to emit JSON scores. This approach is slow, brittle, and decoupled from the Docker Compose service.

To achieve production reliability with zero regression, we refactor the reranker subsystem to directly support Hugging Face Text Embeddings Inference (TEI), either containerized via Docker Compose or run standalone.

See `proposal.md` for motivation and `specs/retrieval/reranking/spec.md` for functional requirements.

## Goals / Non-Goals

**Goals:**
- Provide a dedicated, high-performance `HttpTeiRerankerProvider` implementing the native Hugging Face TEI REST specification (`POST /rerank`).
- Apply the **Strategy and Adapter** design patterns with dependency inversion (`DIP` and `OCP` from SOLID): define `IRerankerProvider` while preserving `IQwenRerankerProvider` as an alias and retaining the `RERANKER_PROVIDER` token.
- Implement dynamic provider selection in `RetrievalModule` (`useFactory`) so the system can default to TEI while allowing fallback to Ollama without regression.
- Support `RERANKER_URL` (as documented in `docker-compose.dev.yaml`) alongside `RERANKER_BASE_URL`.
- Enforce strict TypeScript typing across all request and response structures without any `any` types.
- Ensure resilient circuit breaker protection and automatic fallback to vector search order when the reranker is unreachable or fails.

**Non-Goals:**
- No external third-party cloud API calls (e.g. Cohere, Voyage).
- No end-to-end (e2e) test runs.
- No test proliferation for trivial repository queries or small internal helpers; focus strictly on provider and retrieval fallback correctness.
- No modifications to database schemas, embedding providers, or chat streaming contracts.

## Decisions

### 1. Strategy & Adapter Abstraction for Reranker Providers
- **Decision**: Define a generalized interface `IRerankerProvider` in `apps/backend/src/retrieval/interfaces/reranker-provider.interface.ts`.
- **Backward Compatibility**: Provide `export type IQwenRerankerProvider = IRerankerProvider;` to guarantee all existing imports, mocks, and test fixtures in `RetrievalService` and tests compile with zero changes.
- **Alternatives Considered**:
  - *Hard-replacing `HttpQwenRerankerProvider`*: Would break existing tests and remove the ability to test prompt-based reranking.
  - *Creating completely separate retrieval services*: Violates DRY and complicates the pipeline.

### 2. Native TEI REST Protocol Adapter (`HttpTeiRerankerProvider`)
- **Decision**: Implement `HttpTeiRerankerProvider` targeting:
  - Endpoint: `POST ${rerankerUrl}/rerank`
  - Request body:
    ```json
    {
      "query": "string",
      "texts": ["candidate 0 content", "candidate 1 content"],
      "truncate": false
    }
    ```
  - Response body:
    ```json
    [
      { "index": 0, "score": 0.985 },
      { "index": 1, "score": 0.123 }
    ]
    ```
- **Rationale**: TEI performs direct GPU/CPU cross-encoder inference in Rust/C++ without LLM prompt formatting or markdown slicing, reducing latency from seconds to tens of milliseconds.

### 3. Factory-Based Dependency Injection in `RetrievalModule`
- **Decision**: Configure `RERANKER_PROVIDER` via NestJS `useFactory` in `RetrievalModule`:
  ```typescript
  {
    provide: RERANKER_PROVIDER,
    useFactory: (appConfig: AppConfigService) => {
      if (appConfig.rerankerProviderType === 'ollama') {
        return new HttpQwenRerankerProvider(appConfig);
      }
      return new HttpTeiRerankerProvider(appConfig);
    },
    inject: [AppConfigService],
  }
  ```
- **Rationale**: Decouples `RetrievalService` from concrete provider implementations (DIP/IoC). New providers can be added without modifying `RetrievalService`.

### 4. Robust Configuration with `RERANKER_URL` Support
- **Decision**: In `env.validation.ts` and `AppConfigService`:
  - `RERANKER_PROVIDER_TYPE`: `z.enum(['tei', 'ollama']).default('tei')`
  - `RERANKER_URL`: Optional string, defaulting to `http://localhost:8081` (matching `docker-compose.dev.yaml`)
  - `RERANKER_BASE_URL`: Falls back to `RERANKER_URL` if not explicitly specified
  - `RERANKER_ENDPOINT_PATH`: Defaults to `/rerank` for TEI and `/api/generate` for Ollama
  - `RERANKER_MODEL_NAME`: Defaults to `cross-encoder/ms-marco-MiniLM-L-6-v2` for TEI
- **Rationale**: Aligns directly with comments and configuration in `docker-compose.dev.yaml` while remaining fully backward compatible with existing `.env` files.

### 5. Strict Scoring Semantics & Cross-Encoder Logits
- **Decision**: TEI cross-encoder models output raw logits (which can be negative or > 1) or probabilities. The provider must validate `Number.isFinite(score)` rather than assuming strict `[0.0, 1.0]` bounds. Stable sort preserves relative vector rank on score ties.
- **Rationale**: Prevents unexpected validation errors across diverse cross-encoder model heads (e.g. `ms-marco-MiniLM-L-6-v2` vs `bge-reranker-base`).

## Risks / Trade-offs

- **[Risk] TEI container not running when `RERANKING_ENABLED=true`**
  - *Mitigation*: Built-in `CircuitBreaker` trips after configured threshold (default 5); `RetrievalService` catches the exception and falls back to original vector / hybrid search ordering immediately without failing user queries.
- **[Risk] Cross-encoder token limits exceeded on large chunks**
  - *Mitigation*: Pass `truncate: true` or rely on TEI's configured `--max-batch-tokens 4096`; truncate individual candidate strings to reasonable length before transmission if necessary.
- **[Risk] Breaking existing test suites**
  - *Mitigation*: `IRerankerProvider` contract matches `IQwenRerankerProvider` method signature `rerank(query, candidates, options)` identically; existing test mocks continue to function without modification.

## Migration Plan

1. Pull or build standalone TEI container or run:
   ```bash
   docker compose -f apps/backend/docker-compose.dev.yaml --profile reranker up -d reranker
   ```
2. Enable reranking in environment:
   ```bash
   RERANKING_ENABLED=true
   RERANKER_URL=http://localhost:8081
   ```
3. Rollback: Setting `RERANKING_ENABLED=false` or `RERANKER_PROVIDER_TYPE=ollama` immediately reverts to baseline vector retrieval or legacy Ollama reranker.
