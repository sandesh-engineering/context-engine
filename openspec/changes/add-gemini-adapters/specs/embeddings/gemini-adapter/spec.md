## Purpose

Provides a dense vector embedding adapter using Google Gemini embedding models via the official Google Gen AI SDK for text batch embeddings.

## ADDED Requirements

### Requirement: Gemini batch vector embedding generation
The Gemini embedding provider SHALL implement `IEmbeddingProvider` to generate 768-dimensional (or model-configured) dense vector embeddings for input text batches.

#### Scenario: Successful batch embedding generation
- **WHEN** `generateEmbeddings` is called with an array of text strings
- **THEN** it batches requests to the Gemini embedding model and returns an `EmbeddingResult` containing an array of float vectors matching the input length.

#### Scenario: Empty input handling
- **WHEN** `generateEmbeddings` is invoked with an empty array of texts
- **THEN** it immediately returns an empty array of embeddings without invoking the SDK.

### Requirement: Embedding resilience and telemetry
The Gemini embedding adapter SHALL wrap API invocations inside CircuitBreaker and RetryPolicy execution guards while recording OpenTelemetry span metrics.

#### Scenario: Upstream embedding failure with retry
- **WHEN** a batch embedding call fails with a retryable network timeout
- **THEN** it retries up to the configured retry limit before classifying the failure.
