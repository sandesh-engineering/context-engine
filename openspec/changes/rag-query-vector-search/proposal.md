## Why

Now that the document ingestion pipeline processes documents into chunk embeddings stored in PostgreSQL via `pgvector`, the system needs a search and retrieval backend to query this knowledge base. This change introduces the foundational RAG retrieval pipeline: validating user queries, generating query vector embeddings using the configured local embedding provider, executing vector similarity search against stored document chunks, enforcing embedding dimension symmetry, failing fast on invalid or out-of-domain queries, and returning retrieved candidate document chunks with proper context propagation and structured logging.

## What Changes

- **Query Validation Service**: Implement input validation to catch gibberish, empty/whitespace strings, single-word low-context queries, excessive length, or invalid inputs early before inference.
- **Retrieval & Vector Search Module**: Implement decoupled NestJS service/module (`RetrievalService`, `VectorSearchRepository`) for embedding user queries via `IEmbeddingProvider` and querying `pgvector` chunk embeddings.
- **Embedding Size Invariant & Dimension Check**: Enforce strict verification that query embedding dimensions match the expected vector dimensions configured in the database / embedding model, throwing a dedicated exception on mismatch.
- **Fail-Fast & Similarity Thresholding**: Filter retrieved candidate chunks using a configurable minimum cosine similarity threshold. Return empty candidates / early rejection when question is unrelated to stored knowledge or vector candidates fall below threshold.
- **Context Propagation & Logging**: Ensure trace context/logger context propagation throughout query embedding and vector search.
- **Comprehensive Unit & Integration Test Suite**: Unit and integration tests covering happy path chunk retrieval, and unhappy path scenarios (invalid query, chunks not found / low score, dimension mismatch exception).

## Capabilities

### New Capabilities
- `retrieval`: Query validation, embedding generation, vector similarity search, dimension symmetry enforcement, and candidate chunk retrieval for RAG.

### Modified Capabilities
- None

## Impact

- **Backend Architecture**: Adds new `retrieval` module under `apps/backend/src/retrieval/` decoupled from ingestion pipeline services while sharing common embedding provider interfaces and database repositories/connections.
- **APIs**: Introduces core retrieval service methods and internal contract for RAG chat backend.
- **Dependencies**: Reuses existing NestJS, `pgvector`, typeorm/pg driver, Winston logger, and local embedding provider implementations.
