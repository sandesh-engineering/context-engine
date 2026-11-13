# Ingestion Module

The Ingestion Module provides secure, streaming-first document intake, multi-layer binary validation, resilient object storage staging, and atomic persistence with transactional outbox events.

---

## Architectural Principles

1. **Streaming Intake (Zero Disk / Bounded Memory)**
   - Uses `busboy` to process multipart file streams directly from HTTP requests into S3/object storage.
   - Eliminates container disk exhaustion and prevents memory-based Out-Of-Memory (OOM) failures under concurrent load.

2. **Multi-Layer Validation Pipeline**
   - **Real-Time Size Ceiling**: Enforces maximum document size using a counting transform stream (`CountingStream`).
   - **Raw Magic Byte Sniffing**: Inspects the first chunk using `MagicByteSniffer` for `%PDF-` (`0x25, 0x50, 0x44, 0x46, 0x2D`). Rejects Zip archives, Gzip streams, and PE/ELF executables.

3. **Provider-Agnostic Storage (DIP / Adapter Pattern)**
   - Core ingestion logic depends on `IObjectStorageService` port (`OBJECT_STORAGE_SERVICE` token).
   - Implementations:
     - `S3StorageAdapter`: AWS S3 & Floci local emulator.
     - `MemoryStorageAdapter`: In-memory implementation for fast unit/integration testing.

4. **Resilience & Bounded Retries**
   - Transient errors (HTTP 429, 500, 502, 503, 504, network timeouts) are retried with exponential backoff and full jitter.
   - Non-retryable errors (HTTP 400, 401, 403, 404, checksum mismatches) fail immediately without wasted retries.

5. **Atomic TypeORM Persistence & Transactional Outbox**
   - Executes inside a single `DataSource.transaction()`:
     - `DocumentEntity` (logical parent)
     - `DocumentVersionEntity` (physical version with SHA-256 digest and storage key)
     - `IngestionJobEntity` (checkpoint status `PENDING`, stage `AVAILABLE`)
     - `OutboxEventEntity` (asynchronous event for downstream workers)

6. **Inconsistency Compensation Rollback**
   - If the database transaction fails after S3 object staging succeeds, the staged raw object is immediately deleted (`compensateStorageRollback`), preventing orphaned files.

---

## Directory Structure

```text
src/ingestion/
├── __tests__/                    # Unit and integration test suites
│   ├── ingestion-pipeline.spec.ts
│   ├── storage.spec.ts
│   └── validation.spec.ts
├── common/                       # Shared enums
│   └── enums.ts                  # DocumentSourceType, IngestionJobStatus, IngestionJobStage, SagaDomain
├── database/
│   └── entities/                 # TypeORM entities with field explanations
│       ├── document.entity.ts
│       ├── document-version.entity.ts
│       ├── ingestion-job.entity.ts
│       ├── outbox-event.entity.ts
│       └── index.ts
├── resilience/                   # Error classification & retry policies
│   ├── error-classifier.ts
│   └── retry-policy.ts
├── services/                     # Business services (SRP)
│   ├── ingestion-persistence.service.ts
│   └── storage-path-builder.service.ts
├── storage/                      # Storage ports and adapters
│   ├── adapters/
│   │   ├── memory-storage.adapter.ts
│   │   └── s3-storage.adapter.ts
│   └── interfaces/
│       └── object-storage.interface.ts
├── validation/                   # Stream sniffers and transforms
│   ├── counting-stream.ts
│   ├── magic-byte-sniffer.ts
│   └── stream-validator.ts
├── ingestion.controller.ts       # Swagger-documented multipart streaming endpoint
├── ingestion.module.ts           # NestJS module definition
├── ingestion.service.ts          # Core intake orchestrator
└── README.md
```

---

## API Endpoints

### `POST /documents/upload`

**Headers:**
- `Content-Type: multipart/form-data`
- `x-trace-id: string` (optional distributed trace ID)

**Body:**
- `file`: PDF file stream
- `title`: Optional document title

**Response (`202 Accepted`):**
```json
{
  "statusCode": 202,
  "data": {
    "documentId": "doc_01J7ABC456DEF",
    "versionId": "ver_01J7ABC789GHI",
    "jobId": "job_01J7ABC123XYZ",
    "status": "PENDING",
    "stage": "AVAILABLE",
    "storageKey": "documents/doc_01J7ABC456DEF/versions/ver_01J7ABC789GHI/raw.bin",
    "sha256Digest": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    "byteSize": 1048576,
    "createdAt": "2026-09-16T00:00:00.000Z"
  }
}
```
