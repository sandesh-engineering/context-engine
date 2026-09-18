# Design: SQS Ingestion Worker Poller

## Overview
Worker poller system consuming `ingestion.jobs` events from AWS SQS queue (`knowledge-engine-ingestion-queue`). Designed as modular NestJS module (`IngestionWorkerModule`) to run either inside monolith backend (`apps/backend`) or as standalone micro-container entrypoint (`src/main-worker.ts`) for horizontal scaling on AWS ECS.

## System Architecture

```
                                    +------------------------------+
                                    |  AWS SQS Ingestion Queue     |
                                    +--------------+---------------+
                                                   |
                                         ReceiveMessageCommand
                                                   |
                                                   v
+--------------------------------------------------+--------------------------------------------------+
| IngestionWorkerModule (SqsIngestionPollerService)                                                   |
|                                                                                                     |
|  +-----------------------+   Claim Job    +-------------------------+  Process  +--------------------+
|  | SQS Message Consumer  | -------------> | IngestionJobsRepository | --------> | IngestionProcessor |
|  +-----------+-----------+ (Atomic SQL)   +------------+------------+           +---------+----------+
|              |                                         |                                  |
|              | Delete (Completed/Duplicate)             | Already Processing               | Complete/Fail
|              v                                         v                                  v
|  +-----------+-----------+                +------------+------------+           +---------+----------+
|  |   SQS DeleteMessage   |                |   Delete Duplicate Msg   |           | Update IngestionJob|
|  +-----------------------+                +-------------------------+           +--------------------+
+-----------------------------------------------------------------------------------------------------+
```

### Entrypoint Dual Topology
1. **In-Process Monolith Mode**: Activated when `WORKER_ENABLED=true` in `AppModule`. Poller starts as background service managed by NestJS lifecycle.
2. **Dedicated Worker Container Mode**: Executed via `src/main-worker.ts`. Instantiates lightweight NestJS application context with `IngestionWorkerModule` and database/AWS modules only. Docker container can be scaled independently on AWS ECS.

## Detailed Design

### 1. Configuration Schema (`ConfigService`)
Key SQS and worker runtime configurations (mapped from environment variables supplied by Terraform/ECS Task Definitions):
- `WORKER_ENABLED` (boolean, default: `false`) - Toggle worker poller lifecycle.
- `SQS_INGESTION_QUEUE_URL` (string, required if worker enabled) - Target SQS Queue URL.
- `SQS_POLL_WAIT_TIME_SECONDS` (number, default: `20`) - Long-polling duration (0 to 20s).
- `SQS_MAX_NUMBER_OF_MESSAGES` (number, default: `10`) - Max messages fetched per batch (1 to 10).
- `SQS_VISIBILITY_TIMEOUT_SECONDS` (number, default: `300`) - In-flight message lock duration.
- `SQS_POLLER_CONCURRENCY` (number, default: `1`) - Parallel polling loops per instance.

### 2. Poller Lifecycle & SQS Client (`SqsIngestionPollerService`)
- Implements NestJS `OnModuleInit` and `OnModuleDestroy`.
- Infinite poll loop (`while (this.isRunning)`) using `@aws-sdk/client-sqs` `ReceiveMessageCommand`.
- Graceful shutdown signal (`SIGTERM`/`SIGINT`) sets `isRunning = false` and waits for active batch processing promises to settle before closing SQS client.

### 3. Idempotency & Database Claim Contract
To ensure exactly-once processing semantics across horizontally scaled workers:
- Worker receives SQS message payload `{ jobId: string, documentId: string, traceId: string }`.
- Executes atomic SQL update:
  ```sql
  UPDATE ingestion_jobs 
  SET stage = 'PROCESSING', updated_at = NOW() 
  WHERE id = :jobId AND stage = 'AVAILABLE' 
  RETURNING *;
  ```
- **Claim Succeeded**: Worker processes job. Upon completion, updates `ingestion_jobs` status to `COMPLETED` and deletes SQS message via `DeleteMessageCommand`.
- **Claim Failed (0 rows updated)**: Worker queries job status:
  - If stage is `PROCESSING` or `COMPLETED`: message is duplicate/re-delivery. Delete message from SQS queue immediately.
  - If stage is `FAILED`: evaluate failure state; if terminal, delete from SQS.

## Failure Modes & Error Handling

| Scenario | Behavior / Recovery |
| :--- | :--- |
| Temporary DB / Network Failure | SQS message visibility timeout (`SQS_VISIBILITY_TIMEOUT_SECONDS`) expires; message becomes visible again in SQS for retry. |
| Processing Failure (Transient) | Log error, update `ingestion_jobs` error context. Allow SQS visibility timeout to expire or re-queue. |
| Processing Failure (Terminal / Max Retries) | After AWS SQS `maxReceiveCount` (configured in Terraform SQS Redrive Policy), AWS automatically routes message to SQS DLQ (`knowledge-engine-ingestion-dlq`). |
| Process Shutdown (`SIGTERM`) | Poller stops receiving new messages, awaits completion of active batch up to graceful timeout, then exits. |

## Security & Operational Considerations
- **AWS IAM**: SQS client uses AWS SDK v3 default credential provider chain (IAM Roles for ECS Tasks).
- **Graceful Shutdown**: Essential for ECS blue/green deployment and auto-scaling events to avoid terminating active ingestion pipelines mid-execution.
- **Structured Logging**: Log `jobId`, `documentId`, `traceId`, `sqsReceiptHandle`, and processing duration for distributed tracing.
