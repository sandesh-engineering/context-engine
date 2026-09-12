# ADR-002: AWS SQS Over Kinesis for Ingestion Work Distribution

## Status

Accepted

## Context

The Knowledge Engine ingestion pipeline requires distributing document processing tasks (parsing, chunking, embedding, indexing) asynchronously to background worker processes. We must select an appropriate messaging technology to distribute this work reliably.

## Decision

We will use **AWS SQS (Simple Queue Service)** as our primary messaging system for background work distribution instead of AWS Kinesis or Apache Kafka.

## Alternatives Considered

1. **AWS Kinesis Data Streams / Apache Kafka**:
   - *Pros*: Log-based retention, event replay capability, multiple independent consumer groups reading the same stream concurrently.
   - *Cons*: Shard management overhead, partition key routing complexity, lack of native per-message visibility timeout retry semantics, manual offset tracking needed for failed items.
2. **RabbitMQ / Redis Streams**:
   - *Pros*: Flexible routing topologies, low latency messaging.
   - *Cons*: Requires managing persistent broker clusters or memory infrastructure compared to fully managed AWS SQS.

## Rationale

The fundamental distinction between SQS and Kinesis dictates our choice:

```text
SQS:
"Please process this work."

Kinesis:
"This event happened; retain it so independent consumers
can process/replay it."
```

- **Task Distribution vs. Event Streaming**: Ingestion is a task distribution problem ("parse and index this document version"), not an event streaming problem requiring log retention or multi-consumer replay.
- **Individual Message Visibility & Retries**: SQS provides native per-message visibility timeouts, automatic retries, and dead-letter queue (DLQ) support out of the box. In Kinesis, a failing event blocks the entire stream shard unless complex custom dead-letter routing is implemented.
- **Operational Simplicity**: SQS is serverless, auto-scales infinitely, requires zero shard capacity management, and charges strictly per message request.

## Consequences

### Positive
- Straightforward point-to-point work distribution with native DLQ capabilities.
- Simple, independent worker scaling based on queue length.
- Zero infrastructure or shard management overhead.

### Negative
- SQS does not retain message history once messages are processed and deleted; events cannot be replayed from the queue.
- If multiple independent consumer applications require concurrent feeds of raw document upload events in the future, SQS alone will not support multi-fanout without pairing with SNS.

## Revisit When

Reconsider this decision only if the project develops concrete requirements for:
1. Retained log event history over time for audit or temporal replay.
2. Multiple independent consumer systems requiring stream replay or consumer-specific offsets over the same event stream.
3. Continuous real-time stream processing analytics.

## Related Documentation

- [[../architecture/ingestion]]
- [[../infrastructure/aws]]
- [[../infrastructure/messaging]]
- [[ADR-003-transactional-outbox]]
