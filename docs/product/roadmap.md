# Product Roadmap

This document outlines the implementation status and future trajectory of Knowledge Engine. Speculative future items listed here are subject to evaluation and must not be treated as accepted architectural decisions until formal ADR approval.

---

## 1. Implemented

- [x] Initial monorepo repository setup (Turborepo structure with Next.js web app and NestJS backend framework).
- [x] Basic project configuration and toolchain setup.

---

## 2. Current Focus (Phase 1 — Foundation & Reliable Ingestion)

- [ ] Relational schema definition in PostgreSQL (Document, DocumentVersion, IngestionJob, OutboxMessage).
- [ ] `pgvector` extension setup and schema indexing.
- [ ] Transactional Outbox pattern implementation for document ingestion events.
- [ ] SQS work distribution queue integration.
- [ ] Asynchronous Ingestion Worker with checkpoint processing state machine (`PENDING` → `COMPLETED`).
- [ ] Self-hosted/local embedding model integration (`Ollama` / local transformer interface).

---

## 3. Planned (Phase 2 — Retrieval & Chat Engine)

- [ ] Vector search query pipeline using `pgvector` cosine/L2 similarity.
- [ ] Simple top-$K$ passage extraction and prompt context assembly.
- [ ] LLM provider boundary implementation (supporting local model via Ollama / mock provider).
- [ ] Grounded answer generation with insufficient evidence detection.
- [ ] Server-Sent Events (SSE) / WebSocket streaming of chat responses.
- [ ] Inline source citation rendering.

---

## 4. Deferred (Intentionally Excluded from Initial Releases)

- **Advanced Retrieval Techniques**: Multi-stage reranking (Cohere / Cross-Encoders), Hybrid Dense-Sparse search (BM25 + Dense), Query Rewriting, or Graph RAG (deferred until retrieval metrics justify added complexity).
- **Kinesis / Event Streaming**: Stream retention and event replay infrastructures (deferred; SQS work queue suffices).
- **Agentic Workflows**: Multi-step tool execution, autonomous web browsing, or workflow automation.
- **Complex Multi-Tenancy**: Dynamic schema-per-tenant or cross-organization RBAC structures.

---

## 5. Open Questions

- **Evaluation Benchmark**: What dataset and metric framework (e.g., RAGAS, hit rate, MRR) will be used to benchmark retrieval quality?
- **Chunking Strategy**: What specific chunk size (in tokens) and overlap percentage yield optimal retrieval context for internal technical documents?
- **Vector Dimension Alignment**: Which exact embedding model dimensions (e.g., 384, 768, 1536) should be standardized in the initial PostgreSQL vector column schema?

---

## Related Documentation

- [[context]]
- [[requirements]]
- [[../development/implementation-plan]]
