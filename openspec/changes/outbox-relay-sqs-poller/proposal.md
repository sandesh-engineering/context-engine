## Why

The Knowledge Engine direct document upload intake atomically records document metadata and pending outbox events in PostgreSQL (`outbox_events` table). To achieve guaranteed at-least-once message delivery to downstream ingestion background workers without dual-write race conditions, an asynchronous outbox relay poller service and dedicated repository are required to batch-query pending events, publish them to AWS SQS with error classification and retry policies, handle terminal failure rerouting to Dead-Letter Queues (DLQ), and mark events as processed using database-native timestamps.

## What Changes

- Create dedicated `OutboxRepository` in `apps/backend/src/ingestion/database/repositories/` isolating outbox database queries (`fetchPendingOutboxEvents`, `markEventsProcessed`, `markEventsFailedDlq`) with database-native `CURRENT_TIMESTAMP` to prevent clock drift.
- Implement concrete `OutboxPollerService` in NestJS to periodically poll pending outbox events via `OutboxRepository` in configurable batches (default 10, configurable via `ConfigService` / `OUTBOX_POLL_BATCH_SIZE`).
- Implement `SqsMessagePublisher` implementing `IMessagePublisher` using `@aws-sdk/client-sqs` to batch-publish messages to SQS (`SQS_INGESTION_QUEUE_URL`) and reroute terminal failure messages to DLQ (`SQS_INGESTION_DLQ_URL`).
- Apply `ErrorClassifier` and `RetryPolicy` for controlled retries on transient queue errors (e.g. rate limits, 5xx SQS errors).
- Reroute messages with terminal errors or exceeded retry limits to DLQ and update outbox event state in PostgreSQL to prevent infinite poller loops.
- Add `@aws-sdk/client-sqs` dependency to `apps/backend/package.json`.
- Instrument poller and publishing with OpenTelemetry trace propagation (`traceId` embedded in payload and span attributes), comprehensive TSDocs, and structured JSON logging with strict PII redaction.

## Capabilities

### New Capabilities
- `messaging/outbox-relay`: Asynchronous polling of transactional outbox events, batch publishing to SQS, error classification, retry, DLQ rerouting, and state updating.

### Modified Capabilities
<!-- None -->

## Impact

- **Backend Architecture**: Introduces outbox relay poller, dedicated outbox repository layer, publisher port/adapters, and SQS integration in `apps/backend`.
- **Dependencies**: Adds `@aws-sdk/client-sqs`.
- **Observability & Quality**: Integrates OpenTelemetry spans, comprehensive TSDoc annotations, and structured logging into polling and message publishing loops.
- **Reliability & Security**: Guarantees at-least-once message delivery to SQS, eliminates clock drift inconsistencies using native DB timestamps, prevents deadlocks, and enforces PII sanitization in logs.
