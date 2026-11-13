## Purpose

Provides an optional neural cross-encoder reranking capability for candidate document chunks using Qwen3-Reranker-4B to optimize evidence relevance and context ordering for downstream LLM generation.

## ADDED Requirements

### Requirement: Feature-flag controlled reranking
The system SHALL evaluate the `RERANKING_ENABLED` environment configuration to decide whether candidate document chunks retrieved from vector search undergo neural cross-encoder reranking before prompt context assembly.

#### Scenario: Reranking disabled (default)
- **WHEN** `RERANKING_ENABLED` is `false` or unset
- **THEN** system SHALL return candidate chunks in their original vector similarity order
- **THEN** system SHALL NOT invoke the external reranker model service
- **THEN** downstream answer generation behavior remains strictly identical to existing vector search baseline

#### Scenario: Reranking enabled
- **WHEN** `RERANKING_ENABLED` is `true` and candidate chunks exist
- **THEN** system SHALL query an expanded candidate pool (`RERANKER_CANDIDATES_TOP_K`)
- **THEN** system SHALL send the sanitized user query and candidate chunks to the reranker provider
- **THEN** system SHALL order candidates by relevance score descending and select the top `RERANKER_FINAL_TOP_K` chunks

### Requirement: Cross-encoder relevance scoring and candidate ordering
The system SHALL transmit user queries and retrieved candidate chunk texts to the reranker model service, validate model response schemas, and map returned relevance scores back to candidate chunk entities without losing metadata.

#### Scenario: Successful candidate reranking
- **WHEN** reranker service returns valid relevance scores for all candidate chunks
- **THEN** system SHALL map each relevance score to its matching chunk ID
- **THEN** system SHALL sort candidate chunks in descending order of relevance score
- **THEN** system SHALL preserve all original chunk metadata including `id`, `versionId`, `chunkIndex`, `headingPath`, `pageStart`, `pageEnd`, and `metadataJson`
- **THEN** system SHALL select the configured top-N candidates and provide them to the prompt context assembler

#### Scenario: Score tie-breaking
- **WHEN** two or more candidate chunks receive identical relevance scores from the reranker
- **THEN** system SHALL preserve their relative order from the initial vector similarity search (stable sort)

### Requirement: Resilient fallback to vector search order
The system SHALL guarantee high availability by falling back to original vector search ranking whenever the reranker service encounters network failures, timeouts, service unavailability, circuit breaker trips, or invalid responses.

#### Scenario: Reranker service timeout
- **WHEN** the reranker HTTP request exceeds the configured `RERANKER_TIMEOUT_MS`
- **THEN** system SHALL abort the HTTP request
- **THEN** system SHALL fall back to the top-N candidate chunks ordered by original vector similarity
- **THEN** system SHALL log a structured warning containing the fallback reason
- **THEN** downstream answer generation SHALL proceed without throwing an error to the user

#### Scenario: Reranker service HTTP error or unavailable
- **WHEN** the reranker service returns an HTTP 5xx/4xx error or connection is refused
- **THEN** system SHALL catch the error, evaluate retry and circuit breaker policies
- **THEN** system SHALL fall back to the original vector similarity ordering
- **THEN** system SHALL NOT fail the user's chat or query request

#### Scenario: Malformed or incomplete model response
- **WHEN** the reranker returns a payload with missing scores, mismatched length, or invalid JSON
- **THEN** system SHALL treat the response as invalid
- **THEN** system SHALL fall back to original vector similarity ordering
- **THEN** system SHALL log the schema validation failure details

### Requirement: Zero-candidate bypass
The system SHALL bypass the reranking stage completely when the initial vector similarity search produces zero candidate chunks.

#### Scenario: Empty vector search results
- **WHEN** vector similarity search yields zero candidate chunks
- **THEN** system SHALL NOT make any HTTP request to the reranker service
- **THEN** system SHALL trigger the standard insufficient evidence workflow directly

### Requirement: Observability and diagnostics
The system SHALL instrument the reranking stage with OpenTelemetry spans and structured logging to record reranking latency, candidate ordering changes, score distributions, and fallback events.

#### Scenario: Diagnostic span recording
- **WHEN** candidate reranking is executed
- **THEN** system SHALL record an active OpenTelemetry trace span (`retrieval.rerank`)
- **THEN** trace span SHALL include attributes for input candidate count, reranked count, model name, execution duration, and whether fallback occurred
- **THEN** system SHALL NOT log sensitive document content or authorization tokens
