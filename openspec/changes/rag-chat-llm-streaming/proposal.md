## Why

Now that candidate document chunk vector retrieval is implemented, the Knowledge Engine requires a complete Chat Engine to construct prompt contexts, invoke external generative LLMs, stream response tokens to users via Server-Sent Events (SSE), and maintain stateful in-app conversations.

## What Changes

- **Context Assembly & Prompt Injection Guardrails**: Implement `ChatContextAssembler` to construct structured system prompts incorporating retrieved evidence chunks, explicitly framing user queries and context as reference data to protect against prompt injection.
- **Provider-Agnostic LLM Interface**: Introduce `ILlmProvider` contract with resilience wrappers (CircuitBreaker, RetryPolicy, AbortController cancellation) supporting seamless switching between local models (Ollama, local ONNX/transformers) and paid API providers (OpenAI, Anthropic).
- **SSE Token Response Streaming**: Stream generative response tokens to the API client using Server-Sent Events (SSE) with minimal time-to-first-token (TTFT).
- **Stateful In-App Conversations**: Maintain conversation history and message sequence in PostgreSQL without exposing internal vendor LLM history identifiers to external API consumers.
- **Resiliency & Circuit Breakers**: Automatically trip circuit breakers when LLM providers fail, apply exponential backoff retries, and handle client disconnect cancellation via `AbortController`.

## Capabilities

### New Capabilities
- `chat`: Stateful chat sessions, context assembly with prompt injection protection, vendor-agnostic LLM completion streaming via SSE, circuit breaker resiliency, and message history management.

### Modified Capabilities
- None

## Impact

- **Backend Architecture**: Introduces new `ChatModule` under `apps/backend/src/chat/` connecting `RetrievalModule`, LLM provider abstraction, and TypeORM conversation/message entities.
- **APIs**: Exposes `/conversations` and `/conversations/:id/messages` endpoints supporting SSE streaming responses.
- **Dependencies**: Integrates with NestJS controllers, TypeORM PostgreSQL entities (`ConversationEntity`, `MessageEntity`), SSE response handling, and existing circuit breaker / retry utilities.
