## Context

See `proposal.md` for background and motivation. The backend ingestion pipeline in `apps/backend` writes document intake metadata and outbox records atomically into PostgreSQL. This design establishes an asynchronous outbox relay service and dedicated repository layer that polls pending outbox events, batch-publishes payloads to AWS SQS using `@aws-sdk/client-sqs`, classifies publishing errors, retries transient failures, reroutes terminal failures to a Dead-Letter Queue (DLQ), and updates database event state safely using database-native timestamps.

## Goals / Non-Goals

**Goals:**
- Implement dedicated `OutboxRepository` in `apps/backend/src/ingestion/database/repositories/` to isolate outbox database queries, using database-native `CURRENT_TIMESTAMP` to prevent application-to-database clock drift.
- Implement concrete `OutboxPollerService` to poll pending outbox events via `OutboxRepository` in configurable batch sizes (default 10, configurable via `OUTBOX_POLL_BATCH_SIZE`).
- Implement provider-agnostic `IMessagePublisher` interface and `SqsMessagePublisher` using `@aws-sdk/client-sqs` to publish payload batches to standard SQS (`SQS_INGESTION_QUEUE_URL`) and DLQ (`SQS_INGESTION_DLQ_URL`).
- Apply `ErrorClassifier` and `RetryPolicy` for controlled retries on transient queue errors with exponential backoff and full jitter.
- Reroute terminal failure messages or events exceeding retry limits to DLQ and update outbox status in PostgreSQL to prevent infinite poller loops.
- Enforce clean interface abstractions for messaging (`IMessagePublisher`) so queue publishers are swappable with alternative message brokers (SNS/Kafka/RabbitMQ).
- Propagate OpenTelemetry trace context (`traceId`), include rich TSDocs across all methods, and enforce structured JSON logging with strict PII sanitization.

**Non-Goals:**
- Creating or managing AWS SQS/DLQ infrastructure resources (queue creation and IAM policies are managed out-of-band via Terraform).
- Application-level CDC swappability for the poller (CDC is infrastructure-driven at the database WAL layer via Debezium/Kafka Connect, not swapped in NestJS application code).
- Worker consumption logic (worker processing SQS messages is handled in a separate change/module).

## Decisions

### 1. Dedicated Outbox Repository & Clock Drift Elimination
- **Decision**: Create a dedicated `OutboxRepository` class encapsulating outbox entity queries and status updates:
  ```typescript
  @Injectable()
  export class OutboxRepository {
    async fetchPendingOutboxEvents(batchSize?: number): Promise<OutboxEventEntity[]>;
    async markEventsProcessed(eventIds: string[]): Promise<void>;
    async markEventsFailedDlq(eventIds: string[]): Promise<void>;
  }
  ```
  - `markEventsProcessed` and `markEventsFailedDlq` set `processed_at` / `failed_at` using database-native `CURRENT_TIMESTAMP` expressions instead of Node.js `new Date()`.
- **Rationale**: Isolates database queries from polling/messaging logic. Prevents clock drift inconsistencies between NestJS application servers and PostgreSQL database servers.

### 2. Message Publisher Abstraction (Adapter Pattern & DIP)
- **Decision**: Define a clean interface abstraction for message transport with NestJS injection token:
  ```typescript
  export interface IMessagePublisher {
    publishBatch(messages: OutboxMessagePayload[]): Promise<PublishBatchResult>;
    publishToDlq(messages: OutboxMessagePayload[], errorReason: string): Promise<PublishBatchResult>;
  }
  export const MESSAGE_PUBLISHER = 'MESSAGE_PUBLISHER';
  ```
- **Rationale**: Keeps the outbox poller decoupled from AWS SQS specifics. Supports SQS, local emulator, SNS, or Kafka without altering poller or domain logic (Dependency Inversion Principle).

### 3. SQS Batch Publishing & AWS SDK Adapter
- **Decision**: Implement `SqsMessagePublisher` implementing `IMessagePublisher` using `@aws-sdk/client-sqs` (`SendMessageBatchCommand`):
  - Injects `ConfigService` to retrieve `SQS_INGESTION_QUEUE_URL` and `SQS_INGESTION_DLQ_URL`.
  - Formats messages according to `docs/infrastructure/messaging.md` JSON schema (`eventId`, `eventType`, `timestamp`, `traceId`, `payload`).
  - Passes OpenTelemetry `traceId` as an SQS MessageAttribute for cross-service trace propagation.

### 4. Concrete NestJS Poller Lifecycle Management
- **Decision**: Implement `OutboxPollerService` directly (no application-level poller interface, as CDC is infra-driven):
  - Injects `OutboxRepository` and `@Inject(MESSAGE_PUBLISHER) messagePublisher: IMessagePublisher`.
  - Uses NestJS lifecycle hooks (`OnModuleInit`, `OnModuleDestroy`) with configurable interval (`OUTBOX_POLL_INTERVAL_MS`, default 1000ms).
  - Uses an in-memory boolean flag `isPolling` to prevent overlapping poll iterations.

### 5. TSDoc Standards & PII Redaction
- **Decision**: Annotate all public methods with comprehensive TSDoc comments (`@remarks`, `@param`, `@returns`, `@throws`, `@example`).
- **Observability**: Embed `traceId` in log context and SQS message attributes. Sanitize all log outputs so no PII or raw credentials are exposed.

## Risks / Trade-offs

- **[Risk] High poller concurrency creating duplicate queue messages** → **[Mitigation]** `OutboxPollerService` uses an in-memory lock flag (`isPolling`) to prevent overlapping poll cycles within the same instance, and consumers execute idempotently based on `eventId`/`versionId`.
- **[Risk] Database outbox table bloat over time** → **[Mitigation]** Outbox records updated to `PROCESSED` or `FAILED_DLQ` will be targeted by a separate background cleanup/retention task.
- **[Risk] Unhandled SQS SDK exceptions causing poller crash** → **[Mitigation]** Outer try-catch in `OutboxPollerService` catches all unhandled exceptions, logs structured error details without crashing the NestJS application loop.
