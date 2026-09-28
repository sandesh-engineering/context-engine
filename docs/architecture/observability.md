# Distributed Tracing & Structured Logging Architecture

This document describes the observability model of Knowledge Engine across synchronous HTTP requests and asynchronous event-driven pipelines (SQS + Outbox + Workers).

---

## 1. Core Principles

1. **Standard OpenTelemetry / W3C Trace Context**: Tracing context is passed across network and queue boundaries using standard `traceparent` (`00-{traceId}-{spanId}-{flags}`) and `tracestate`.
2. **Separation of Concerns**: Tracing metadata is transported in SQS `MessageAttributes` or Outbox `metadata` JSONB fields—never polluting the business domain payload.
3. **Noisy Operation Suppression**: Routine empty polling cycles and high-frequency poll ticks are silenced; only meaningful business transitions, batch publications, stage handoffs, and classified errors are logged.
4. **Data Privacy & Minimal Payloads**: Raw document binaries, full parsed text, vector embedding floats, raw prompts, secrets, and authorization headers are **never** logged or attached as span attributes. Only durable identifiers, counts, timings, and classifications are emitted.
5. **Human-Readable + Queryable JSON**: Every log line contains a clear human-readable description alongside structured key-value pairs (`event`, `jobId`, `traceId`, `spanId`, `errorType`, `retryable`).

---

## 2. Distributed Trace Propagation Flow

```text
HTTP Client
  │
  ▼
[API: IngestionService] (Span: document.create)
  │
  ├─► PostgreSQL: document_versions & ingestion_jobs
  │
  └─► PostgreSQL: ingestion_outbox (carrier metadata: traceparent, tracestate, traceId)
        │
        ▼ (Asynchronous DB Poll)
[IngestionOutboxPollerService]
        │
        ▼ (Span: queue.publish)
      AWS SQS (MessageAttributes: traceparent, tracestate, traceId)
        │
        ▼ (Asynchronous SQS Receive)
[SqsIngestionPollerService] (Span: ingestion.worker - Consumer)
  │
  ├── Span: document.download (S3 object streaming)
  ├── Span: document.parse (PDF / text parsing)
  ├── Span: document.chunk (Structural token chunking)
  │
  └─► PostgreSQL: document_chunks & embedding_outbox (carrier metadata: traceparent)
        │
        ▼ (Asynchronous DB Poll)
[EmbeddingOutboxPollerService]
        │
        ▼ (Span: queue.publish)
      AWS SQS Embedding Queue (MessageAttributes: traceparent, tracestate, traceId)
        │
        ▼ (Asynchronous SQS Receive)
[SqsEmbeddingPollerService] (Span: embedding.worker - Consumer)
  │
  ├── Span: embedding.ollama (Batch vector embeddings)
  ├── Span: embedding.persist (pgvector updates)
  │
  └─► Mark Job Completed & SQS ACK (DeleteMessage)
```

---

## 3. Identifier Semantics

| Identifier | Scope & Purpose | Example |
| :--- | :--- | :--- |
| `traceId` | Global end-to-end distributed operation across all services and async queues. | `4bf92f3577b34da6a3ce929d0e0e4736` |
| `spanId` | Specific unit of work or sub-operation within a trace. | `00f067aa0ba902b7` |
| `requestId` | Inbound HTTP request identifier (if assigned by gateway / middleware). | `req-9a8b7c` |
| `jobId` | Durable business ingestion job ID in PostgreSQL (`ingestion_jobs.id`). | `job_01J8ABC123` |
| `documentId`| Parent document record ID (`documents.id`). | `doc_01J8XYZ789` |
| `versionId` | Immutable document version ID (`document_versions.id`). | `ver_01J8VER456` |
| `eventId` | Unique outbox record ID (`ingestion_outbox.event_id`). | `evt_01J8EVT001` |
| `messageId`| Transport-level queue delivery ID assigned by AWS SQS. | `sqs-msg-12345-abc` |

---

## 4. Structured Logging Convention

All log entries emitted via `StructuredLogger` follow the standard format:

```json
{
  "timestamp": "2026-09-26T12:45:00.000Z",
  "level": "info",
  "service": "knowledge-engine",
  "contextName": "SqsIngestionPollerService",
  "event": "ingestion.job.completed",
  "message": "Ingestion job successfully completed",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "00f067aa0ba902b7",
  "jobId": "job_01J8ABC123",
  "documentId": "doc_01J8XYZ789",
  "versionId": "ver_01J8VER456",
  "durationMs": 425
}
```

### Error Logging Structure

```json
{
  "timestamp": "2026-09-26T12:45:05.120Z",
  "level": "error",
  "service": "knowledge-engine",
  "contextName": "SqsEmbeddingPollerService",
  "event": "embedding.job.failed",
  "message": "Embedding batch generation failed",
  "traceId": "4bf92f3577b34da6a3ce929d0e0e4736",
  "spanId": "5c2e08e8b23f1234",
  "jobId": "job_01J8ABC123",
  "versionId": "ver_01J8VER456",
  "errorType": "TRANSIENT",
  "errorMessage": "connect ECONNREFUSED 127.0.0.1:11434",
  "retryable": true
}
```

---

## 5. What Must NEVER Be Logged

To protect security, confidentiality, and system stability, the following are strictly prohibited from log statements and span attributes:

- **Raw File Contents / Document Bodies**: No PDF binaries, HTML dumps, or extracted page text blocks.
- **Vector Embedding Floats**: No arrays of float embeddings (`[0.012, -0.045, ...]`).
- **Full LLM Prompts & Completions**: Only model names, token counts, and durations are logged; prompts and completions are omitted by default.
- **Secrets & Credentials**: AWS secret keys, database connection strings, JWTs, and presigned URL query parameters are excluded.

---

## 6. Local Inspection

- **Jaeger UI**: Open `http://localhost:16686` to inspect full distributed traces crossing HTTP API, Outbox poller, SQS queues, Ingestion workers, and Embedding workers.
- **Docker Logs**: Inspect structured JSON logs using:
  ```bash
  docker logs -f knowledge-engine-backend | jq .
  ```
