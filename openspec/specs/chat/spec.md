# RAG Chat Specification

## Purpose

Defines context assembly guardrails, vendor-agnostic LLM completion streaming, prompt injection protection, circuit breaker resilience, and stateful conversation history tracking.

## Requirements

### Requirement: Context Construction and Prompt Injection Guardrails
The system MUST construct structured system prompts incorporating retrieved evidence chunks and MUST frame retrieved evidence and user prompts as reference data with explicit instruction boundaries to mitigate prompt injection.

#### Scenario: Successful evidence context framing
- **WHEN** retrieved candidate chunks are provided to the context assembler
- **THEN** system formats evidence blocks with source citations and wraps user query inside explicit reference markers prohibiting prompt instruction override

#### Scenario: Insufficient evidence fallback
- **WHEN** retrieval yields zero candidate chunks or scores below similarity threshold
- **THEN** system bypasses LLM generative completion and returns a standard insufficient evidence message

### Requirement: Vendor-Agnostic LLM Provider Interface with Resilience
The system MUST support a vendor-agnostic LLM provider abstraction capable of streaming tokens, protected by a circuit breaker, exponential backoff retry policy, and AbortController request cancellation.

#### Scenario: Provider streaming completion
- **WHEN** valid prompt and history are submitted to LLM provider
- **THEN** system streams token chunks back to client via Server-Sent Events (SSE)

#### Scenario: Circuit breaker trip on provider failure
- **WHEN** downstream LLM provider returns repeated 5xx errors or connection failures exceeding threshold
- **THEN** circuit breaker trips to OPEN state, immediately rejecting subsequent calls with a service unavailable error

#### Scenario: Request cancellation via AbortController
- **WHEN** client disconnects or aborts request during active token streaming
- **THEN** system signals AbortController to immediately cancel HTTP connection to LLM provider

### Requirement: Stateful In-App Conversation Tracking
The system MUST persist conversation sessions and message turns in PostgreSQL while mapping internal conversation IDs to vendor chat history without exposing internal vendor state tokens.

#### Scenario: Persistent multi-turn conversation
- **WHEN** user submits a new query to an existing conversation ID
- **THEN** system records user message, fetches prior message history, appends newly generated assistant response, and links citations to evidence chunk IDs
