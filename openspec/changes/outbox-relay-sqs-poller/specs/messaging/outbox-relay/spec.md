## Purpose

Provides a reliable, decoupled outbox relay service that periodically queries unpublished transactional outbox events from PostgreSQL in configurable batches, publishes them to AWS SQS, classifies delivery errors, applies controlled retries, reroutes unprocessable messages to a Dead-Letter Queue (DLQ), and updates database event state safely.

## ADDED Requirements

### Requirement: Batch Outbox Polling
The system SHALL query pending outbox events from the database in configurable batch sizes (default 10 items per batch, configurable via environment/config service) through a swappable poller abstraction.

#### Scenario: Successful outbox batch query
- **WHEN** the outbox relay poller executes a poll cycle
- **THEN** it retrieves up to the configured maximum batch size of pending outbox events ordered by creation timestamp

#### Scenario: No pending events
- **WHEN** the outbox relay poller queries for pending events and none exist
- **THEN** it completes the polling cycle gracefully without error and waits for the next scheduled interval

### Requirement: Provider-Agnostic Message Batch Publishing
The system SHALL publish outbox event batches to AWS SQS via a provider-agnostic publisher interface (`IMessagePublisher`), conforming strictly to the standardized SQS JSON payload schema.

#### Scenario: Successful batch publication to standard SQS queue
- **WHEN** outbox events are formatted into message payloads and published to the configured SQS queue URL
- **THEN** the message publisher sends the batch successfully and returns message IDs for all published events

### Requirement: Error Classification and Controlled Retries
The system SHALL classify message publication failures into transient versus permanent errors, applying controlled exponential backoff with full jitter for transient failures up to a configurable maximum retry count.

#### Scenario: Transient queue error retry
- **WHEN** message publishing fails due to a transient error (e.g. HTTP 429 throttling, 500/503 SQS service error, network timeout)
- **THEN** the system executes retries using exponential backoff with full jitter up to the configured maximum retry limit

#### Scenario: Terminal error or max retries exceeded
- **WHEN** message publishing encounters a non-retryable error (e.g. invalid queue URL configuration or schema corruption) OR exceeds maximum retry attempts
- **THEN** the system halts retrying for the batch and marks the affected messages for DLQ rerouting

### Requirement: Dead-Letter Queue Rerouting
The system SHALL reroute terminal failure messages or events that exceed maximum retry attempts to the configured Dead-Letter Queue (DLQ) and update the outbox event record in PostgreSQL to prevent infinite polling loops.

#### Scenario: Rerouting terminal failure to DLQ
- **WHEN** an outbox message fails terminally or exceeds max retries
- **THEN** the system publishes the message payload with failure metadata to the DLQ SQS queue URL and marks the outbox event as processed/failed in PostgreSQL

#### Scenario: Outbox status update after successful publish
- **WHEN** an outbox message is successfully published to the primary SQS queue
- **THEN** the system updates the outbox event status in PostgreSQL to indicate publication completion

### Requirement: Observability, Tracing, and Privacy
The system SHALL propagate OpenTelemetry trace identifiers across outbox messages, create telemetry spans for poller cycles and queue dispatches, and produce structured JSON log entries without recording PII.

#### Scenario: OpenTelemetry trace propagation and log sanitization
- **WHEN** outbox events are polled and published
- **THEN** the system attaches `traceId` to SQS message attributes and JSON payloads, creates OpenTelemetry spans for publishing operations, and redacts any user PII or sensitive tokens from log outputs
