## Purpose

Defines the behavior contract for the SQS worker poller, including long polling, atomic database job claiming, idempotent execution, message deletion, and OpenTelemetry trace context extraction.

## ADDED Requirements

### Requirement: SQS Long Polling Consumer
The system SHALL poll the configured SQS queue (`SQS_INGESTION_QUEUE_URL`) using AWS SQS long polling with configurable parameters (`WaitTimeSeconds` up to 20s, `MaxNumberOfMessages` up to 10).

#### Scenario: Successful long polling batch receipt
- **WHEN** the SQS worker poller executes a poll cycle and messages are available in the queue
- **THEN** it retrieves up to the configured batch limit of messages and extracts payload JSON and MessageAttributes

#### Scenario: Empty queue polling loop
- **WHEN** no messages are available in the SQS queue during the long polling wait duration
- **THEN** the worker poller completes the wait duration cleanly and initiates the next long poll iteration

### Requirement: Idempotent Database Job Claiming
The system SHALL inspect `IngestionJob` stage in PostgreSQL and execute an atomic update (`UPDATE ingestion_jobs SET stage = 'PROCESSING' WHERE id = :jobId AND stage = 'AVAILABLE'`) before commencing work.

#### Scenario: Claim available pending job
- **WHEN** an SQS message with a valid `jobId` in `AVAILABLE` stage is received
- **THEN** the system atomically transitions the job stage to `PROCESSING` and begins execution

#### Scenario: Skip already processed or claimed duplicate message
- **WHEN** an SQS message is received whose corresponding `IngestionJob` is already `PROCESSING`, `COMPLETED`, or beyond `AVAILABLE`
- **THEN** the system logs a duplicate message notice, skips execution, and acknowledges (deletes) the SQS message

### Requirement: Message Acknowledgment and Deletion
The system SHALL issue `DeleteMessageBatch` to SQS upon successful job processing or duplicate skip to delete acknowledged messages from the queue.

#### Scenario: Successful message deletion
- **WHEN** a batch of SQS messages completes processing or duplicate skip
- **THEN** the system issues a batch delete request to SQS with matching receipt handles

#### Scenario: Processing failure visibility timeout
- **WHEN** job execution encounters an unhandled processing error
- **THEN** the system leaves the message in SQS without deleting, allowing SQS visibility timeout to expire for automatic redrive/retry

### Requirement: Deployment Dual-Mode & Configurable Latency
The system SHALL support running embedded within the main backend process (`WORKER_ENABLED=true`) OR as a standalone process entrypoint (`pnpm start:worker`) for independent ECS task container scaling.

#### Scenario: Standalone ECS worker process execution
- **WHEN** the standalone worker entrypoint (`main-worker.ts`) is launched
- **THEN** it initializes `WorkerModule`, connects to PostgreSQL and SQS, and runs the long-polling worker loop independently of HTTP controllers

#### Scenario: Configurable polling latency and batch parameters
- **WHEN** polling parameters are overridden via environment variables (`SQS_WORKER_WAIT_TIME_SECONDS`, `SQS_WORKER_MAX_MESSAGES`)
- **THEN** the SQS worker poller applies the exact configured values for all SQS receive commands
