# ADR-003: Transactional Outbox for Reliable Database-to-Message Publication

## Status

Accepted

## Context

When an API client uploads a document, Knowledge Engine must update its relational database state (creating `Document`, `DocumentVersion`, and `IngestionJob` records) and send a work message to SQS to trigger background ingestion. 

Performing dual-writes (updating PostgreSQL and publishing directly to SQS inside the HTTP request handler) leads to serious race conditions:
1. If the DB commit succeeds but the SQS network call fails, the document remains stuck in `PENDING` state forever without an ingestion worker picking it up.
2. If the SQS message is published but the DB transaction rolls back, a background worker attempts to process a non-existent document version, causing runtime errors.

## Decision

We will implement the **Transactional Outbox Pattern**. All message dispatch intentions will be written to an `outbox_messages` table in PostgreSQL within the exact same database transaction that updates application domain records. A dedicated asynchronous outbox relay process will poll/stream published outbox records and enqueue them into SQS.

## Alternatives Considered

1. **Direct Dual-Write (API Handler pushes directly to SQS after DB commit)**:
   - *Pros*: Simple to code initially.
   - *Cons*: Prone to silent message drops, network failure orphan records, and lack of transaction boundary safety.
2. **Two-Phase Commit (2PC) / Distributed Transactions**:
   - *Pros*: Synchronous atomic guarantees across DB and queue.
   - *Cons*: Extremely complex, poor performance latency, not supported natively by AWS SQS.
3. **Change Data Capture (CDC) via Debezium**:
   - *Pros*: Tail database write-ahead log (WAL) directly without outbox table queries.
   - *Cons*: High operational infrastructure complexity for a single monorepo stack.

## Rationale

- **Guaranteed Atomicity**: Inserting an outbox record inside the relational SQL transaction guarantees that an SQS message will *only* be scheduled if the business data is durably committed to PostgreSQL.
- **At-Least-Once Dispatch**: The outbox relay process polls unpublished messages and retries SQS pushes until successfully acknowledged, guaranteeing at-least-once delivery to SQS.
- **Simplicity**: Implemented natively in SQL without requiring extra CDC infrastructure like Kafka Connect or Debezium in V1.

## Consequences

### Positive
- Completely eliminates ghost jobs (SQS message sent but DB transaction rolled back) and zombie jobs (DB record created but SQS message lost).
- Decouples HTTP request response times from SQS availability and network latency.

### Negative
- Requires maintaining an `outbox_messages` table and an outbox relay polling background worker.
- Introduces slight propagation latency (typically sub-second) between HTTP commit and SQS enqueueing.

## Revisit When

Reconsider this decision if:
1. High-throughput database write benchmarks indicate that polling/updating `outbox_messages` creates unacceptable database lock contention, justifying a zero-table WAL-based CDC tool (e.g., Debezium).

## Related Documentation

- [[../architecture/ingestion]]
- [[../infrastructure/database]]
- [[../infrastructure/messaging]]
- [[ADR-001-postgresql-pgvector]]
- [[ADR-002-sqs-over-kinesis]]
