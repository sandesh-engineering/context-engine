## Why

Outbox relay messages published to AWS SQS (`knowledge-engine-ingestion-queue`) require a dedicated worker polling service to consume job notifications, enforce database domain idempotency against PostgreSQL (`IngestionJob.stage`), process background document ingestion stages, and acknowledge (delete) completed messages. To support production deployment flexibility, the worker architecture must support both embedded execution within the main NestJS process and independent containerized deployment on AWS ECS for horizontal scaling.

## What Changes

- Implement `SqsWorkerPoller` service using `@aws-sdk/client-sqs` (`ReceiveMessageCommand`, `DeleteMessageBatchCommand`) with fully configurable long polling (`SQS_WORKER_WAIT_TIME_SECONDS`, default 20s), batch size (`SQS_WORKER_MAX_MESSAGES`, default 10), visibility timeout, and poller concurrency.
- Implement `WorkerJobProcessor` to execute idempotency checks and atomic job stage transitions (`UPDATE ingestion_jobs SET stage = 'PROCESSING' WHERE id = :jobId AND stage = 'AVAILABLE'`) before invoking job handlers.
- Add standalone worker process entrypoint (`apps/backend/src/main-worker.ts`) and npm script (`pnpm start:worker`) for independent ECS task scaling, alongside optional embedded execution (`WORKER_ENABLED=true`).
- Integrate provider-agnostic worker interfaces (`ISqsWorkerPoller`, `IWorkerJobProcessor`) for clean swappability and testability.
- Instrument worker poll cycles with OpenTelemetry trace context extraction (`traceId` from MessageAttributes/payload) and structured JSON logging with PII sanitization.

## Capabilities

### New Capabilities
- `worker/sqs-consumer`: Asynchronous SQS long-polling worker, database idempotency claim, background job execution, message deletion, and OpenTelemetry trace propagation.

### Modified Capabilities
<!-- None -->

## Impact

- **Backend Architecture**: Adds worker feature module (`src/worker/`), poller service, job processor, and standalone entrypoint `src/main-worker.ts` in `apps/backend`.
- **Deployment & Scaling**: Enables containerized ECS task scaling via `pnpm start:worker` script without modifying HTTP backend image codebase.
- **Observability & Reliability**: Guarantees idempotent execution, prevents duplicate processing, and correlates OpenTelemetry traces across HTTP, Outbox Relay, and Worker services.
