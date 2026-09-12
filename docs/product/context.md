# Product Context

## Purpose

Knowledge Engine is a production-style enterprise knowledge management and retrieval-augmented generation (RAG) platform. It enables organizations to securely upload internal documents, process them into searchable vector embeddings, and interact with the knowledge base via an AI-powered conversational interface.

---

## Target Audience

- **Knowledge Workers / Employees**: Need quick, reliable answers derived strictly from authoritative internal company documents without searching through disparate repositories.
- **System Administrators**: Require observable, reliable document ingestion pipelines with deterministic tracking, idempotency, and auditability.
- **AI / Software Engineers**: Need a modular, production-grade codebase demonstrating reliable RAG architecture patterns (Transactional Outbox, SQS queuing, vector storage in pgvector, and LLM abstraction).

---

## Core Problem Statement

Organizations accumulate vast quantities of unstructured documentation (PDFs, Markdown files, technical manuals, internal guides). Traditional keyword search fails to capture semantic context, while standard off-the-shelf generative AI tools risk hallucinating facts or leaking proprietary knowledge. 

Knowledge Engine solves this by combining reliable asynchronous document processing pipelines with grounded vector retrieval, ensuring that generated answers cite source evidence and explicitly decline to answer when evidence is lacking.

---

## Core Use Cases

1. **Document Ingestion & Versioning**: Upload raw documents into the platform; the system automatically parses, chunks, embeds, and indexes them asynchronously.
2. **Semantic Knowledge Search**: Query internal documentation using natural language queries to retrieve the top matching document passages based on vector similarity.
3. **Grounded Conversational RAG**: Engage in multi-turn chat conversations where AI answers are generated strictly using retrieved internal context, complete with inline source citations.

---

## Product Scope

### In-Scope (V1)
- Asynchronous document parsing, chunking, embedding generation, and vector indexing.
- At-least-once delivery guarantees using Transactional Outbox and SQS queues.
- Relational state and vector storage managed in PostgreSQL via `pgvector`.
- Single-turn and multi-turn chat sessions with grounded answer generation.
- Insufficient evidence fallback (system clearly states when information is missing).
- Replaceable LLM and Embedding provider interfaces.

---

## Non-Goals (Out of Scope for V1)

- **Agentic Workflows / Actions**: Automated execution of external APIs, tool-calling, or multi-step autonomous planning.
- **Real-Time Event Stream Processing**: Log retention or stream replay mechanisms (e.g., Apache Kafka or AWS Kinesis).
- **Multi-Tenant Data Isolation / Complex RBAC**: Advanced tenant partitioning beyond basic workspace/user context.
- **Web Scraping / Live Crawling**: Automatic scraping of external third-party websites or real-time web search integration.
- **Complex Retrieval Pipeline Variants**: Graph RAG, multi-stage reranking, query rewriting, or hybrid dense/sparse search (deferred until concrete metrics warrant them).

---

## Open Questions

- What specific file formats beyond text/PDF should be officially supported in Phase 1?
- Should user document deletion immediately trigger hard deletion of associated vector chunks or asynchronous background cleanup?

---

## Related Documentation

- [[requirements]]
- [[roadmap]]
- [[../architecture/overview]]
- [[../decisions/ADR-001-postgresql-pgvector]]
