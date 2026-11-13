# Knowledge Engine Documentation

Welcome to the **Knowledge Engine** documentation vault. This documentation system is designed for human engineering teams using Obsidian and AI coding agents working inside the repository.

---

## Source of Truth Hierarchy

When resolving ambiguities or engineering decisions, follow this strict hierarchy of authority:

```text
Current implementation
        ↓
Accepted ADRs
        ↓
Architecture documentation
        ↓
Domain documentation
        ↓
Product requirements
        ↓
Roadmap / Open Questions
```

### Discrepancy Policy for AI Agents and Engineers

- **Implementation vs. Documentation**: If the current codebase disagrees with the documentation, **do not silently change either one**. First identify and document the discrepancy, raise it for review, or file an issue/question.
- **Accepted ADRs**: Accepted Architecture Decision Records supersede general architecture or domain documentation if a conflict exists.
- **Speculative Features**: Content under Roadmap or Open Questions must never be treated as accepted architectural commitments.

---

## Documentation Directory Structure

### Product
- [[product/context]] — Product vision, problem statement, scope, and non-goals.
- [[product/requirements]] — Functional (`FR-xxx`) and non-functional (`NFR-xxx`) specifications with stable IDs.
- [[product/roadmap]] — System implementation status (Implemented, Current, Planned, Deferred, Open Questions).

### Architecture
- [[architecture/overview]] — High-level system context, component diagrams, and core data flows.
- [[architecture/ingestion]] — Asynchronous document processing, external object streaming, transactional outbox, SQS, and ingestion workers.
- [[architecture/retrieval]] — Vector search, top-K selection, context assembly, and grounding strategy.
- [[architecture/chat]] — Conversation lifecycle, message persistence, context building, and LLM streaming response.
- [[architecture/reliability]] — Centralized reliability principles (at-least-once delivery, idempotency, retries, DLQ, checkpoints).

### Domain Models
- [[domain/documents]] — Document and DocumentVersion domain entities, lifecycle, and invariants.
- [[domain/ingestion-jobs]] — IngestionJob state machine, stage transitions, and invariants.
- [[domain/chunking]] — Document chunking strategies, boundary handling, token limits, and metadata.
- [[domain/embeddings]] — Vector embedding generation, batching, interface boundaries, and persistence.
- [[domain/conversations]] — Conversation and Message domain models, evidence tracking, and streaming semantics.

### Infrastructure
- [[infrastructure/aws]] — AWS cloud infrastructure map (S3, RDS PostgreSQL, SQS, ECS/Fargate).
- [[infrastructure/database]] — PostgreSQL relational schema, pgvector vector store, and transaction boundaries.
- [[infrastructure/messaging]] — SQS work distribution queues, visibility timeouts, outbox mechanics, and DLQs.

### Architecture Decision Records (ADRs)
- [[decisions/ADR-001-postgresql-pgvector]] — PostgreSQL + pgvector as authoritative state & vector store.
- [[decisions/ADR-002-sqs-over-kinesis]] — SQS for work distribution vs. Kinesis event streaming.
- [[decisions/ADR-003-transactional-outbox]] — Transactional Outbox pattern for reliable database-to-queue publishing.
- [[decisions/ADR-004-self-hosted-embeddings]] — Self-hosted embedding model strategy.
- [[decisions/ADR-005-local-llm]] — Local/free LLM model initially behind a provider abstraction boundary.
- [[decisions/ADR-006-external-object-streaming-ingestion]] — External object streaming ingestion, SSRF defense, and S3 multipart lifecycle.

### Development
- [[development/implementation-plan]] — Phased implementation progress and task breakdown.
- [[development/coding-conventions]] — Architectural boundaries, error handling, idempotency, and repository patterns.
- [[development/testing-strategy]] — Unit, integration, database, messaging, idempotency, and retrieval eval testing strategy.

---

## Known Discrepancies (V1)

Recorded per the discrepancy policy above; the code is the current source of truth.

- **Deployment:** docs describe ECS/Fargate. V1 runs Docker Compose on a single EC2 host, deployed by `.github/workflows/ci-cd.yml`.
- **Outbox tables:** docs mention one `outbox_messages` table. The code has two, `ingestion_outbox` and `embedding_outbox`, one per queue.
- **URL / S3 import (ADR-006):** accepted but not implemented. There is no `POST /imports`, and the web page shows "coming soon".
- **Idempotency-Key:** not implemented. Identical re-uploads are deduplicated by SHA-256 instead.
- **Formats (FR-001):** only PDF is accepted. Markdown and plain text are not.
- **Job states (FR-003):** the code splits `status` (PENDING/PROCESSING/COMPLETED/FAILED) from `stage` (SOURCE_READY/PARSING/CHUNKING/EMBEDDING/INDEXING).
- **Authentication:** none yet. Every API route is open to whoever can reach it.

## Related Documentation

- [[product/context]]
- [[architecture/overview]]
- [[development/coding-conventions]]
