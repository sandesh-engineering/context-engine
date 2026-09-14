# Architecture: Reliability & Resiliency

## Purpose

This document centralizes system-wide reliability, resilience, fault-tolerance, and observability principles across Knowledge Engine components.

---

## Centralized Reliability Matrix

| Core Principle | Implementation Strategy | Target Failure Mode |
| :--- | :--- | :--- |
| **At-Least-Once Delivery** | Transactional Outbox + SQS Message Queuing | Database/Queue dual-write failures, network drops |
| **Consumer Idempotency** | Deterministic entity IDs (`version_id` + `chunk_index`) & atomic state transitions | Duplicate SQS delivery, worker retries |
| **Progress Checkpointing** | IngestionJob checkpoint updates in PostgreSQL | Worker process crashes mid-pipeline |
| **Bounded Retries & Backoff** | Exponential backoff with random jitter | Transient model or database connection spikes |
| **Dead-Letter Queue (DLQ)** | SQS DLQ after `maxReceiveCount` exceeded | Permanent parse failures (corrupt binary/malformed payload) |
| **Provider Fault Isolation** | Circuit breaker & timeout wrapper on external models | Model server hangs or latency degradation |
| **Bounded Streaming Memory** | Bounded buffer (8–16 MB) HTTP-to-S3 multipart upload | Worker OOM crashes on massive file ingestion |
| **Orphaned Multipart Cleanup** | Worker `AbortMultipartUpload` + S3 bucket lifecycle rule | Storage cost leaks from aborted or crashed uploads |
| **SSRF & Metadata Defense** | Pre-dial DNS resolution, IP blacklist, socket IP pinning | Internal network reconnaissance, cloud metadata theft |

---

## Resiliency Principles

### 1. Dual-Write Elimination via Transactional Outbox
To avoid inconsistencies where state is saved to the database but notification to SQS fails (or vice versa), domain modifications and outbox message creation execute in a single relational database transaction.

### 2. Idempotent Ingestion Operations
Because SQS guarantees **at-least-once** delivery, consumers will occasionally receive duplicate messages. Ingestion handlers enforce idempotency by:
- Deriving chunk IDs deterministically (`hash(version_id + chunk_index)`).
- Performing `UPSERT` operations for chunk and vector writes.
- Checking current `IngestionJob.checkpoint` state before re-running a stage.

### 3. Granular Stage Checkpoints
Ingestion progress is persisted to PostgreSQL after every major stage completion (`PARSING` → `CHUNKING` → `EMBEDDING` → `INDEXING`). If a worker container dies mid-execution, the next available worker skips already-completed stages.

### 4. SQS Visibility Timeout & Dead-Letter Queuing
- **Visibility Timeout**: Standard SQS visibility timeout allows workers sufficient time to finish heavy processing stages before a message is made visible to other consumers.
- **Dead-Letter Queue (DLQ)**: Messages that fail processing repeatedly across multiple retries are automatically moved to a dedicated DLQ. This prevents poison-pill messages from blocking processing.

### 5. Observability & Distributed Tracing
- **Correlation & Trace IDs**: Every document upload and chat session generates a unique `trace_id` propagated across HTTP headers, database records, outbox payloads, SQS message attributes, and log contexts.
- **Structured JSON Logging**: Logs are emitted in standard JSON format containing timestamp, `trace_id`, service name, log level, and contextual fields.

---

## Open Questions

- What maximum retry threshold should trigger DLQ migration?
- What default timeout values should be configured for model inference API requests?

---

## Related Documentation

- [[overview]]
- [[ingestion]] — Authoritative ingestion pipeline and external object streaming.
- [[../infrastructure/messaging]]
- [[../decisions/ADR-003-transactional-outbox]]
- [[../decisions/ADR-006-external-object-streaming-ingestion]] — External object streaming resilience and multipart lifecycle.
