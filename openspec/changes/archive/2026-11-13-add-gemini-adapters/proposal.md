## Why

The system currently relies on local Ollama endpoints for both LLM chat generation and vector embeddings. To support multi-provider extensibility and benchmark alternative cloud model providers, we need standard Google Gemini adapters for chat (with stateful multi-turn history) and vector embeddings using official Google Gen AI SDK conventions, while keeping local Ollama as the active runtime default.

## What Changes

- Add Google Gemini LLM provider implementing `ILlmProvider` with stateful chat session history support, streaming tokens, resilience wrappers (CircuitBreaker and RetryPolicy), and OpenTelemetry span instrumentation.
- Add Google Gemini embedding provider implementing `IEmbeddingProvider` for batch vector embedding generation with resilience and tracing.
- Keep Ollama providers as the active registered runtime providers in NestJS dependency injection modules to guarantee external APIs are not invoked accidentally.
- Add comprehensive unit tests covering Gemini chat streaming, history conversion, error handling, and embedding generation.

## Capabilities

### New Capabilities
- `chat/gemini-adapter`: Google Gemini chat adapter supporting stateful multi-turn history, token streaming, and circuit breaker resilience.
- `embeddings/gemini-adapter`: Google Gemini embedding adapter supporting text batch embedding generation.

### Modified Capabilities
<!-- None -->

## Impact

- **Dependencies**: Add `@google/genai` (or `@google/generative-ai`) to `apps/backend/package.json`.
- **Chat Module**: Add `GeminiLlmProvider` under `apps/backend/src/chat/providers/`.
- **Ingestion/Embeddings Module**: Add `GeminiEmbeddingProvider` under `apps/backend/src/ingestion/embeddings/providers/`.
- **Runtime Configuration**: Retain `OllamaLlmProvider` and `OllamaEmbeddingProvider` as active bindings in `ChatModule` and `IngestionModule`.
