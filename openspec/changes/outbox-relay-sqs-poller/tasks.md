## 1. Dependencies & Core Messaging Interfaces

- [x] 1.1 Add `@aws-sdk/client-sqs` dependency to `apps/backend/package.json` and verify package installation succeeds.
- [x] 1.2 Define `IMessagePublisher` interface and injection token (`MESSAGE_PUBLISHER`) in `apps/backend/src/ingestion/messaging/interfaces/`.

## 2. Message Publisher Implementation (AWS SQS Adapter)

- [x] 2.1 Implement `SqsMessagePublisher` implementing `IMessagePublisher` using `@aws-sdk/client-sqs` with `SendMessageBatchCommand` for primary queue and DLQ rerouting in `apps/backend/src/ingestion/messaging/publishers/`.
- [x] 2.2 Add unit tests for `SqsMessagePublisher` covering successful batch publish, transient error retries, and DLQ routing in `apps/backend/src/ingestion/__tests__/sqs-publisher.spec.ts`.

## 3. Dedicated Outbox Repository Layer & Queries

- [x] 3.1 Create dedicated `OutboxRepository` in `apps/backend/src/ingestion/database/repositories/` to query pending outbox events and mark event status (`PROCESSED`, `FAILED_DLQ`) using database-native `CURRENT_TIMESTAMP` to prevent clock drift.
- [x] 3.2 Write unit tests for `OutboxRepository` batch querying and status update operations in `apps/backend/src/ingestion/__tests__/outbox-repository.spec.ts`.

## 4. Outbox Poller Service, TSDocs & Module Integration

- [x] 4.1 Implement `OutboxPollerService` with configurable batch size (default 10), poll interval, concurrency lock (`isPolling`), and error classification/retry orchestration in `apps/backend/src/ingestion/messaging/services/`.
- [x] 4.2 Integrate OpenTelemetry trace context propagation (`traceId` attributes), rich TSDoc annotations, and structured JSON logging with PII sanitization in `OutboxPollerService`.
- [x] 4.3 Register `IMessagePublisher`, `SqsMessagePublisher`, `OutboxRepository`, and `OutboxPollerService` in `IngestionModule`.
- [x] 4.4 Write unit tests for `OutboxPollerService` covering batch poll-and-publish execution, transient error retries, DLQ rerouting on terminal failure, and concurrency lock handling.

## 5. Comprehensive Verification

- [x] 5.1 Run typecheck (`pnpm --filter backend check-types`) to verify zero TypeScript compilation errors.
- [x] 5.2 Run backend unit test suite (`pnpm --filter backend test`) to verify outbox poller and messaging tests execute cleanly.
