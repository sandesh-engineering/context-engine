# Development Implementation Plan

## Purpose

This document tracks the phased implementation progression for Knowledge Engine. Tasks correspond directly to architecture and domain requirements established in the documentation vault.

---

## Phase 1 — Foundation & Core Domain State

- [ ] **Database Schema & Migrations**: Define PostgreSQL schema for `documents`, `document_versions`, `ingestion_jobs`, `outbox_messages`, `document_chunks`, `conversations`, and `messages`.
- [ ] **`pgvector` Integration**: Enable `pgvector` extension and configure HNSW cosine distance vector index on `document_chunks.embedding`.
- [ ] **S3 Object Storage Adapter**: Implement NestJS S3 storage service for uploading raw document binaries.
- [ ] **Document Management APIs**: Build REST endpoints for document registration and file uploads (`POST /documents/upload`).

---

## Phase 2 — Reliable Ingestion Pipeline

- [ ] **Transactional Outbox Implementation**: Build atomic outbox writer within document upload database transaction (`ADR-003`).
- [ ] **Outbox Relay Publisher**: Implement background worker process polling unpublished outbox events and pushing to AWS SQS.
- [ ] **SQS Infrastructure Integration**: Configure SQS queue client, visibility timeouts, and dead-letter queue (DLQ) integration (`ADR-002`).
- [ ] **Ingestion Worker & Stage Checkpoints**: Implement background worker processing state machine (`PENDING` → `PARSING` → `CHUNKING` → `EMBEDDING` → `INDEXING` → `COMPLETED`).
- [ ] **Structure-Aware Chunking Engine**: Build text chunking module with heading preservation, token limits, and metadata tracking.
- [ ] **Local Embedding Provider**: Implement `IEmbeddingProvider` interface wrapping local/self-hosted embedding model (`ADR-004`).
- [ ] **Idempotent Chunk Writer**: Implement deterministic chunk ID generation and `UPSERT` persistence in PostgreSQL.

---

## Phase 3 — Vector Retrieval & Grounded Chat Engine

- [ ] **Vector Similarity Retrieval**: Implement query vector embedding and `pgvector` Top-$K$ cosine search queries.
- [ ] **Similarity Threshold & Insufficient Evidence Handling**: Add score filtering and fallback response routing when evidence is below threshold.
- [ ] **LLM Provider Boundary**: Implement `ILlmProvider` interface isolating local LLM (Ollama) completion logic (`ADR-005`).
- [ ] **Grounded Context Assembly**: Build prompt formatter injecting retrieved document chunks with citation identifiers.
- [ ] **Streaming Chat APIs**: Implement Server-Sent Events (SSE) streaming endpoint (`POST /conversations/{id}/messages`).
- [ ] **Message & Citation Persistence**: Save completed AI responses, citations, and evidence chunk references to PostgreSQL.

---

## Phase 4 — Testing, Reliability & Observability

- [ ] **Idempotency & Re-delivery Unit Tests**: Verify worker handles duplicate SQS delivery cleanly without duplicate records.
- [ ] **Fault Injection & DLQ Tests**: Verify malformed inputs move to SQS DLQ and mark jobs `FAILED`.
- [ ] **Retrieval Quality Evaluation Suite**: Build evaluation test suite measuring retrieval hit rates against sample query sets.
- [ ] **Distributed Tracing & JSON Logging**: Instrument API and worker logs with unified `trace_id` tracking.

---

## Related Documentation

- [[coding-conventions]]
- [[testing-strategy]]
- [[../product/roadmap]]
- [[../architecture/overview]]
