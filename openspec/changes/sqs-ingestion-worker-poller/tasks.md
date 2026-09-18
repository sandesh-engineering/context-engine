# Tasks: SQS Ingestion Worker Poller

## 1. Environment & Configuration Setup

- [x] 1.1 Update backend config schema in `apps/backend/src/config/` to support `WORKER_ENABLED`, `SQS_POLL_WAIT_TIME_SECONDS`, `SQS_MAX_NUMBER_OF_MESSAGES`, `SQS_VISIBILITY_TIMEOUT_SECONDS`, and `SQS_POLLER_CONCURRENCY` and verify validation schemas pass.

## 2. Ingestion Worker Core Module & Services

- [x] 2.1 Create `IngestionWorkerModule` and `SqsIngestionPollerService` in `apps/backend/src/ingestion/worker/` with SQS `ReceiveMessageCommand` polling loop and lifecycle management (`OnModuleInit`, `OnModuleDestroy`) and verify unit tests mock SQS client polling loop.
- [x] 2.2 Implement atomic job claim logic using `IngestionJobsRepository` SQL queries to transition jobs from `AVAILABLE` to `PROCESSING` and test claim concurrency handling.
- [x] 2.3 Implement SQS message deletion (`DeleteMessageCommand`) upon successful job completion or when skipping duplicate messages, and verify deletion behavior with mock SQS client.

## 3. Dual-Topology Deployment Support

- [x] 3.1 Register `IngestionWorkerModule` dynamically in `AppModule` conditional on `WORKER_ENABLED` env config and verify monolith bootstrap.
- [x] 3.2 Create standalone worker entrypoint `apps/backend/src/main-worker.ts` for ECS micro-container execution and verify independent script startup.

## 4. Integration Testing & Verification

- [x] 4.1 Write integration tests in `apps/backend/src/ingestion/__tests__/sqs-worker-poller.spec.ts` testing SQS message batch ingestion, job claiming, duplicate deletion, and error/DLQ routing behavior using testcontainers / SQS mocks.
