## 1. Domain Entities and Provider Interfaces

- [x] 1.1 Create `ConversationEntity` and `MessageEntity` in `apps/backend/src/chat/database/entities/` and register in TypeORM data source.
- [x] 1.2 Define `ILlmProvider` interface and streaming chunk types in `apps/backend/src/chat/interfaces/llm-provider.interface.ts`.
- [x] 1.3 Implement `ChatContextAssembler` service in `apps/backend/src/chat/services/chat-context-assembler.service.ts` with prompt injection guardrails.

## 2. LLM Provider Implementation & Resilient Streaming

- [x] 2.1 Implement `OllamaLlmProvider` in `apps/backend/src/chat/providers/ollama-llm.provider.ts` supporting `AsyncIterable` streaming and `AbortSignal` cancellation.
- [x] 2.2 Implement `ChatService` in `apps/backend/src/chat/services/chat.service.ts` managing conversation persistence, retrieval triggering, fallback messages, and LLM stream delegation with CircuitBreaker and RetryPolicy wrappers.
- [x] 2.3 Implement `ChatController` in `apps/backend/src/chat/chat.controller.ts` providing `@Sse()` endpoint for streaming tokens to client.
- [x] 2.4 Construct `ChatModule` in `apps/backend/src/chat/chat.module.ts` registering providers, entities, and controllers.

## 3. Mandatory Unit & Integration Tests

- [x] 3.1 Implement unit tests for `ChatContextAssembler` verifying prompt injection isolation and evidence chunk formatting.
- [x] 3.2 Implement unit tests for `ChatService` covering happy path SSE streaming, insufficient evidence fallback, circuit breaker tripping on provider error, and exponential backoff retry policy.
- [x] 3.3 Verify typecheck (`pnpm check-types`) and run backend tests to confirm clean execution.
