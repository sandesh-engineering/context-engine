## Context

The backend currently uses `OllamaLlmProvider` and `OllamaEmbeddingProvider` for local offline inference. We are adding Google Gemini adapters (`GeminiLlmProvider` and `GeminiEmbeddingProvider`) using the `@google/genai` or `@google/generative-ai` SDK following existing `ILlmProvider` and `IEmbeddingProvider` contracts. As per strict user requirements, Ollama remains the default runtime provider in NestJS dependency injection bindings so external APIs are not called during standard local execution.

## Goals / Non-Goals

**Goals:**
- Implement `GeminiLlmProvider` supporting `ILlmProvider` with streaming output, multi-turn history conversion, `CircuitBreaker`, and `RetryPolicy`.
- Implement `GeminiEmbeddingProvider` supporting `IEmbeddingProvider` with batch embedding generation and resilience.
- Provide clean unit tests mocking SDK interactions to verify error handling, stream parsing, and history mapping.
- Follow existing provider patterns in `apps/backend/src/chat/providers/` and `apps/backend/src/ingestion/embeddings/providers/`.

**Non-Goals:**
- Do not replace Ollama as the active provider in `ChatModule` or `IngestionModule`.
- Do not make actual outbound network requests to Google Gemini in automated tests or default runtime configurations.
- Do not alter existing ingestion pipeline executors or chat service interfaces.

## Decisions

### 1. SDK Selection: Official `@google/genai` / `@google/generative-ai`
- **Choice**: Use `@google/genai` or `@google/generative-ai` official TypeScript SDK.
- **Rationale**: Provides native typing, chat session objects (`chats.create` or `startChat`), and streaming iterators (`sendMessageStream`).
- **Alternative**: Raw `fetch` to Gemini REST endpoints. Rejected to adhere to SDK conventions established in the prompt.

### 2. History Mapping Strategy
- **Choice**: Map domain `MessageHistory[]` (`role: 'USER' | 'ASSISTANT' | 'SYSTEM'`) into Gemini contents format (`role: 'user' | 'model'`, parts: `[{ text }]`). System instructions are passed via `systemInstruction` in model configuration.
- **Rationale**: Matches Gemini's content schema and keeps system context separated from dialog history.

### 3. Resilience and Provider Isolation
- **Choice**: Wrap SDK calls in `CircuitBreaker` and `RetryPolicy` identical to `OllamaLlmProvider`.
- **Rationale**: Uniform failure handling and error classification across all providers.

## Risks / Trade-offs

- **[Risk] Accidental External API Invocation**: Calling real cloud endpoints during tests or local runs could incur costs or fail when API keys are absent.
  - *Mitigation*: Unit tests use mocked SDK clients; DI modules keep Ollama providers bound by default.
