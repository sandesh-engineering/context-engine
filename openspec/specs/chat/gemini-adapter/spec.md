# Gemini Chat Adapter Specification

## Purpose

Provides a streaming Google Gemini chat adapter that supports stateful multi-turn history, CircuitBreaker protection, and retry policies following standard LLM provider abstractions.

## Requirements

### Requirement: Gemini LLM streaming with conversation history
The Gemini LLM adapter SHALL implement the `ILlmProvider` interface and stream tokens asynchronously given a formatted system prompt, prior conversation turns, and runtime stream options.

#### Scenario: Successful streaming generation with multi-turn history
- **WHEN** `generateStream` is called with a prompt, prior user and assistant history turns, and options
- **THEN** it maps history turns into Gemini content format, starts or continues a chat session via the SDK, and yields `LlmStreamChunk` objects until completion with `isComplete: true`.

#### Scenario: Client cancellation via AbortSignal
- **WHEN** caller aborts the `AbortSignal` during active token streaming
- **THEN** the adapter cancels the SDK stream generator and terminates iteration without unhandled rejection.

### Requirement: Resilience and error classification
The Gemini LLM adapter SHALL wrap SDK generation calls in CircuitBreaker and RetryPolicy execution guards.

#### Scenario: Transient upstream API failure
- **WHEN** the Gemini API returns a rate limit (HTTP 429) or transient server error (HTTP 503)
- **THEN** the adapter retries according to the retry policy before propagating classified errors.

#### Scenario: Circuit breaker trip on repeated outages
- **WHEN** consecutive Gemini API calls fail beyond the failure threshold
- **THEN** the circuit breaker trips open and fails fast on subsequent requests without invoking the remote SDK.
