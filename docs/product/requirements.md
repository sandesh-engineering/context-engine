# Product Requirements

This document specifies the formal Functional Requirements (`FR-xxx`) and Non-Functional Requirements (`NFR-xxx`) for Knowledge Engine.

---

## Functional Requirements (FR)

### FR-001 — Document Upload & Storage
Users must be able to upload raw documents (e.g., Markdown, PDF, Plain Text) to the system. The system must store the raw document binary durably before triggering processing.

### FR-002 — Asynchronous Document Ingestion
Document processing (parsing, chunking, embedding generation, indexing) must execute asynchronously in the background without blocking API client upload calls.

### FR-003 — Ingestion Progress Tracking
The system must maintain explicit state for each ingestion job (`PENDING`, `PARSING`, `CHUNKING`, `EMBEDDING`, `INDEXING`, `COMPLETED`, `FAILED`), allowing clients to query current processing progress.

### FR-004 — Document Chunking & Metadata Preservation
Documents must be split into logical text chunks with metadata preserving the parent document ID, version ID, chunk sequence index, and source location references.

### FR-005 — Vector Embedding Generation
The system must generate dense vector embeddings for processed text chunks using a compatible embedding model during document ingestion.

### FR-006 — Semantic Similarity Retrieval
Given a natural language user query, the system must embed the query and retrieve the top-$K$ most relevant document chunks based on vector similarity search.

### FR-007 — Grounded Answer Generation
The system must generate conversational answers strictly conditioned on the retrieved document evidence. 

### FR-008 — Insufficient Evidence Handling
If the retrieved document evidence does not contain sufficient information to satisfy a user query, the system must explicitly communicate that it cannot answer based on available knowledge rather than speculating or hallucinating.

### FR-009 — Source Attribution & Citations
Generated answers must include reference citations pointing back to the specific source document chunks used to construct the answer.

### FR-010 — Multi-Turn Conversation History
The system must persist conversation sessions and message history, allowing users to conduct multi-turn contextual Q&A.

---

## Non-Functional Requirements (NFR)

### NFR-001 — At-Least-Once Delivery
The asynchronous processing infrastructure must guarantee at-least-once delivery for all document processing events and message tasks.

### NFR-002 — Processing Idempotency
All worker ingestion pipeline stages must be strictly idempotent. Re-delivering or re-processing an ingestion task must not produce duplicate database records or corrupted vector indices.

### NFR-003 — Fault Recovery & DLQ Handling
Tasks encountering persistent transient failures must retry with exponential backoff up to a bounded maximum retry count before being safely moved to a Dead-Letter Queue (DLQ).

### NFR-004 — Provider Boundary Abstraction
The system must isolate third-party or local LLM and embedding model implementations behind abstract service boundaries, allowing seamless swapping of model providers without modifying application business logic.

### NFR-005 — Streaming Response Latency
Chat response tokens must be streamed to the client incrementally to minimize time-to-first-token (TTFT) perception during answer generation.

### NFR-006 — Relational Source of Truth
PostgreSQL must serve as the single authoritative source of truth for all application domain state, transactional outbox messages, and vector embeddings.

---

## Related Documentation

- [[context]]
- [[roadmap]]
- [[../architecture/reliability]]
- [[../domain/documents]]
- [[../domain/ingestion-jobs]]
