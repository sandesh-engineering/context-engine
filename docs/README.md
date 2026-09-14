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
- [[architecture/ingestion]] — Asynchronous document processing, transactional outbox, SQS, and ingestion workers.
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

### Development
- [[development/implementation-plan]] — Phased implementation progress and task breakdown.
- [[development/coding-conventions]] — Architectural boundaries, error handling, idempotency, and repository patterns.
- [[development/testing-strategy]] — Unit, integration, database, messaging, idempotency, and retrieval eval testing strategy.

---

## Related Documentation

- [[product/context]]
- [[architecture/overview]]
- [[development/coding-conventions]]
