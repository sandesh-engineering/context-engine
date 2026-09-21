## Why

The current ingestion worker requires an independently retryable, idempotent processing pipeline where each stage (`PARSING` → `CHUNKING` → `EMBEDDING` → `INDEXING` → `COMPLETED`) is bound to a durable checkpoint in PostgreSQL. Rather than executing as an opaque in-memory operation, durable stage boundaries prevent unnecessary re-downloading, re-parsing, or re-chunking on job retries while local temporary disk storage resolves PDF parser seekability without memory buffering.

## What Changes

- Implement `DocumentParser` abstraction returning a structured `ParsedDocument` model (pages, page numbers, blocks, metadata) using a Node.js PDF parsing library (`pdf-parse`) to preserve page and block boundaries without Tika/Java dependencies or mandatory Markdown rendering.
- Implement temporary disk storage manager (`DOCUMENT_TEMP_DIR`, `DOCUMENT_MAX_SIZE_BYTES`, `DOCUMENT_TEMP_DISK_LIMIT_BYTES`) to stream S3 objects into unique temp files with `finally` cleanup block.
- Create `DocumentChunkEntity` and repository to persist structure-aware chunks (`document_chunks` table with `page_start`, `page_end`, `heading_path`) as the durable checkpoint between chunking and embedding.
- Implement `OllamaEmbeddingProvider` (`IEmbeddingProvider`) for local Ollama-hosted `embeddinggemma` (768 dimensions) with chunk-level idempotency, processing only unembedded chunks on retry.
- Implement configuration-driven Ollama resilience primitives (`RetryPolicy`, error classification, and reusable `CircuitBreaker` for embedding and future LLM requests).
- Enforce durable stage progression in `IngestionJobsRepository` and worker poller: SQS messages remain unacknowledged until stage checkpoints succeed.

## Capabilities

### New Capabilities
- `ingestion/pipeline-stages`: Independent, idempotent ingestion pipeline stages (`PARSING`, `CHUNKING`, `EMBEDDING`, `INDEXING`), structured PDF parsing, streaming temp disk storage, local Ollama `embeddinggemma` vectors, and resilient circuit breaker checkpointing.

### Modified Capabilities
- None

## Impact

- **Database**: Adds `DocumentChunkEntity` (`document_chunks` table) with `pgvector` / 768-dim vector column, `chunk_index`, `page_start`, `page_end`, offsets, and metadata.
- **Worker & Pipeline**: Refactors `SqsIngestionPollerService` pipeline execution into discrete stage processors with durable PostgreSQL state checkpoints.
- **Dependencies**: Adds `pdf-parse` Node.js dependency for PDF parsing.
- **Resilience & Config**: Adds `CircuitBreaker` class and environment configurations for Ollama, PDF temp disk limits, and embedding parameters.
