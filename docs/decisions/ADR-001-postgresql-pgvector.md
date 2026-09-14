# ADR-001: PostgreSQL + pgvector as Authoritative Database and Vector Store

## Status

Accepted

## Context

Knowledge Engine requires both relational data storage (for documents, versions, ingestion jobs, outbox messages, and conversations) and dense vector similarity search capabilities (for text chunk retrieval). Storing relational data and vector indexes in separate dedicated systems (e.g., PostgreSQL for state + Pinecone/Qdrant/Milvus for vectors) introduces dual-write consistency issues, cross-system transactional complexity, separate backup strategies, and higher operational overhead.

## Decision

We will use **PostgreSQL** with the **`pgvector`** extension as both the authoritative relational source of truth and the primary vector similarity search store for Knowledge Engine.

## Alternatives Considered

1. **PostgreSQL + Specialized Managed Vector DB (Pinecone / Qdrant / Milvus)**:
   - *Pros*: Higher specialized vector search indexing options at massive scale (billions of vectors).
   - *Cons*: Dual-write inconsistencies, extra infrastructure cost, complex sync pipelines, external vendor dependency.
2. **MongoDB / OpenSearch with Vector Capabilities**:
   - *Pros*: Document-oriented storage with built-in vector search.
   - *Cons*: Weaker relational consistency models, less mature tooling for outbox pattern execution compared to PostgreSQL.

## Rationale

- **Single System Simplicity**: Using PostgreSQL with `pgvector` allows relational domain data and vector embeddings to coexist in a single database with atomic ACID transaction guarantees.
- **Transactional Outbox Compatibility**: Outbox message creation and domain updates happen inside a single relational transaction without distributed commit complexity.
- **Operational Efficiency**: Backup, point-in-time recovery (PITR), replication, and security rely on standard, battle-tested PostgreSQL infrastructure (AWS RDS PostgreSQL).
- **Adequate Performance**: `pgvector` with HNSW or IVFFlat indexing easily handles millions of vectors with low query latency, fulfilling all initial project requirements.

## Consequences

### Positive
- Zero dual-write synchronization bugs between relational metadata and vector storage.
- Unified ACID database transactions across documents, jobs, and vector chunk records.
- Lower infrastructure costs and simplified local development (`docker-compose` with `pgvector` container).

### Negative
- Extremely high-volume vector search workloads (tens of millions of vectors with high write throughput) may compete with relational SQL queries for CPU and RAM.
- Fewer specialized vector filtering optimizations compared to specialized vector databases like Milvus or Pinecone.

## Revisit When

Reconsider this decision if:
1. Vector dataset volume scales into tens of millions of vectors where `pgvector` memory or query latency violates performance SLA requirements despite HNSW indexing.
2. Advanced vector-native features (e.g., native hybrid dense-sparse indexing, dynamic graph re-indexing) become a strict product requirement not supported by `pgvector`.

## Related Documentation

- [[../architecture/overview]]
- [[../infrastructure/database]]
- [[ADR-003-transactional-outbox]]
