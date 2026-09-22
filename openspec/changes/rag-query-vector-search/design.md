## Context

The system has an established ingestion pipeline in `apps/backend/src/ingestion` that parses documents, chunks text, generates vector embeddings using an `IEmbeddingProvider`, and stores chunk vectors in PostgreSQL with `pgvector`. See `proposal.md` for motivation.

This design details the technical architecture for the new decoupled `RetrievalModule` in `apps/backend/src/retrieval/`, serving as the search engine foundation for the RAG chat backend.

## Goals / Non-Goals

**Goals:**
- Create a decoupled `RetrievalModule` in NestJS with clear dependency boundaries (`QueryValidator`, `RetrievalService`, `VectorSearchRepository`).
- Validate user input queries early (empty, whitespace, single word, gibberish/low context) before embedding inference.
- Utilize the same `IEmbeddingProvider` as document ingestion to guarantee embedding space symmetry.
- Enforce vector dimension validation, raising explicit exceptions if query embedding dimensions mismatch configured expectations.
- Execute vector similarity search on PostgreSQL `pgvector` (`document_chunks` table) using cosine distance (`1 - (embedding <=> $1)`).
- Fail fast and return empty result sets when retrieved chunk similarity is below configurable thresholds or when queries are out-of-domain.
- Comprehensive Jest unit tests and integration tests covering happy path chunk retrieval and unhappy paths (invalid query, chunks not found, embedding size mismatch).

**Non-Goals:**
- Reranking models (Cohere / Cross-encoders) - deferred to later phases.
- Hybrid search (BM25 + vector RRF) - deferred to later phases.
- Generative LLM completion / response streaming - handled by separate chat engine module.

## Decisions

### 1. Module Structure and Decoupling
- **Choice**: Create `apps/backend/src/retrieval/` as a standalone NestJS module.
- **Rationale**: Keeps retrieval decoupled from ingestion state machines and outbox messaging, allowing independent testing and scaling.
- **Alternatives Considered**: Adding search endpoints inside `IngestionModule` (rejected: breaks single responsibility principle).

### 2. Query Validation Heuristics (`RetrievalQueryValidator`)
- **Choice**: Multi-layer heuristic validation:
  1. Non-empty string check after trim.
  2. Length check (minimum 3 characters, maximum 1000 characters).
  3. Single-word context check (single generic word rejected unless recognized entity/keyword).
  4. Character entropy / repeated char patterns check to reject random keyboard mashing/gibberish.
- **Rationale**: Prevents wasting expensive embedding inference requests on non-sensical inputs while failing fast.
- **Alternatives Considered**: Regex only (rejected: misses repeated char gibberish or zero-context single words).

### 3. pgvector Cosine Similarity Querying (`VectorSearchRepository`)
- **Choice**: Execute raw parameterized query via TypeORM `DataSource`:
  ```sql
  SELECT id, document_id, version_id, chunk_index, content, metadata, 1 - (embedding <=> $1) AS similarity
  FROM document_chunks
  WHERE 1 - (embedding <=> $1) >= $2
  ORDER BY similarity DESC
  LIMIT $3;
  ```
- **Rationale**: Directly leverages indexed `pgvector` cosine similarity with parameters for query vector `$1`, similarity threshold `$2`, and top-K `$3`.
- **Alternatives Considered**: Fetching all vectors into memory (rejected: scales poorly, violates database index usage).

### 4. Embedding Dimension Verification
- **Choice**: Compare `queryVector.length` against system-configured dimension (e.g., 384 for `bge-small-en-v1.5` / `all-MiniLM-L6-v2`) before executing database query. Throw `EmbeddingDimensionMismatchException` if unequal.
- **Rationale**: Guarantees database vector operation integrity and catches misconfigured embedding providers immediately.

## Risks / Trade-offs

- [Risk] Strict similarity threshold might return no chunks for borderline queries → Mitigation: Make threshold configurable (`RETRIEVAL_SIMILARITY_THRESHOLD`) with sensible default (e.g. 0.5) and structured logging when candidate count is zero.
- [Risk] Simple character entropy checks could falsely reject dense technical jargon → Mitigation: Maintain permissive threshold on entropy and test against typical domain queries.
