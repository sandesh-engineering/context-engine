# Development: Coding Conventions & Architectural Rules

## Purpose

This document outlines mandatory engineering rules, SOLID principles, design patterns, and architectural conventions for developers and AI coding agents writing code in Knowledge Engine.

---

## 1. Design Patterns & SOLID Principles

### Single Responsibility Principle (SRP)
- **Single Reason to Change**: Every class, service, and module must have one, and only one, primary responsibility.
  - **Controllers**: Handle HTTP routing, payload validation, and status code mapping. Never put domain or database logic in controllers.
  - **Services / Use-Cases**: Execute specific application business logic.
  - **Repositories / Adapters**: Handle database operations or external API communications.
  - **Ingestion Workers**: Each worker stage (`Parse`, `Chunk`, `Embed`, `Index`) is isolated into single-purpose handlers.

### Open/Closed Principle (OCP) & Strategy Pattern
- **Extensible via Strategies**: Core algorithms (chunking strategies, vector search formatters, embedding providers, LLM completions) must be open for extension but closed for modification.
- Implement replaceable components behind Strategy interfaces (`IEmbeddingProvider`, `ILlmProvider`, `IChunkingStrategy`).

### Liskov Substitution Principle (LSP)
- **Interchangeable Implementations**: Concrete implementation classes (e.g., `OllamaLlmProvider`, `OpenAiLlmProvider`, `MockLlmProvider`) must adhere strictly to interface contracts so that swapping implementations at runtime via configuration introduces zero behavioral regressions.

### Interface Segregation Principle (ISP)
- **Focused Interfaces**: Prefer fine-grained, target-specific interfaces over large monolithic interfaces. Components should not be forced to depend on methods they do not use.

### Dependency Inversion Principle (DIP)
- **Depend on Abstractions**: High-level domain modules must depend on abstract interfaces, never on concrete infrastructure classes (e.g., depend on `IStorageProvider`, not directly on `@aws-sdk/client-s3`). Inject dependencies via NestJS Dependency Injection.

### Repository & Adapter Patterns
- Encapsulate data access logic behind repositories and infrastructure adapters, isolating external database schema details or vendor SDK specifics from domain models.

---

## 2. Architectural Boundaries

- **Framework Isolation**: Application domain logic must not depend directly on framework specifics (NestJS HTTP decorators, Express request objects). Keep domain models and use cases decoupled from infrastructure adapters.
- **Provider Interfaces**: Always consume third-party or external models via abstract interfaces (`IEmbeddingProvider`, `ILlmProvider`, `IStorageProvider`). Never import vendor SDK classes directly in domain or service layers.

---

## 3. Database & Outbox Rules

- **Relational Source of Truth**: PostgreSQL is authoritative. Never assume S3, SQS, or external services hold state that disagrees with PostgreSQL.
- **Atomic State + Outbox Writes**: Any domain modification that triggers background processing **must** write an outbox record inside the exact same SQL database transaction (`ADR-003`). Never perform direct dual-writes to SQS inside HTTP handlers.

---

## 4. Messaging & Idempotency Expectations

- **At-Least-Once Assumption**: Assume every message consumer will receive duplicate deliveries. Handlers must be strictly idempotent.
- **Deterministic ID Generation**: Derive entity IDs deterministically (e.g., `hash(version_id + chunk_index)`) to enable clean `UPSERT` operations during retries.
- **Checkpoint Inspection**: Worker stage handlers must inspect current `IngestionJob.stage` in PostgreSQL before starting work to avoid re-executing completed stages.

---

## 5. Error Handling & Failure Reporting

- **Explicit Exception Hierarchy**: Define domain-specific exceptions (e.g., `DocumentParseException`, `InsufficientEvidenceException`).
- **No Swallowed Exceptions**: Never use empty `catch` blocks or return silent fallback dummy objects when database or provider failures occur.
- **Graceful Insufficient Evidence**: If vector search yields no relevant context, return the explicit insufficient evidence domain response rather than guessing.

---

## 6. Observability & Logging Rules

- **Trace ID Propagation**: Pass `traceId` through all API requests, database outbox entries, SQS message headers, and background worker contexts.
- **Structured JSON Logging**: Log output must be JSON-formatted containing timestamp, log level, `traceId`, `component`, and structured metadata context.

---

## 7. Commenting and Spacing Rules

- The comment should always be in the format `/* Comment goes here */` not `// Comment goes here`.
- Proper spacing between lines are needed. Group logical parts accordingly but they need to have proper comments.

---

## Related Documentation

- [[implementation-plan]]
- [[testing-strategy]]
- [[../architecture/reliability]]
- [[../README]]
