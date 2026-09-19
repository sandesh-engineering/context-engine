## 1. Custom Skills & Design Patterns Foundation

- [x] 1.1 Create custom skill `.agents/skills/design-patterns/SKILL.md` consolidating SOLID principles, GoF patterns (Adapter, Strategy, Factory, Builder, Chain/Pipeline, Unit of Work).

## 2. Dependencies & Core Abstractions in Backend

- [x] 2.1 Add necessary runtime dependencies (`busboy`, `@types/busboy`, `typeorm`, `@nestjs/typeorm`, `pg`, `@aws-sdk/client-s3`) to `apps/backend/package.json` and verify installation succeeds.
- [x] 2.2 Create storage port `IObjectStorageService` interface and injection tokens in `apps/backend/src/ingestion/storage/interfaces/`.
- [x] 2.3 Implement the `RetryPolicy` and `ErrorClassifier` with configurable bounded retries and exponential backoff with full jitter in `apps/backend/src/ingestion/resilience/`.

## 3. Stream Validation Pipeline

- [x] 3.1 Implement zero-dependency raw buffer `MagicByteSniffer` (verifying `%PDF-` signature; rejecting zip/gzip, PE `MZ`, and ELF) and `StreamValidator` in `apps/backend/src/ingestion/validation/`.
- [x] 3.2 Implement `CountingStream` transform to track byte volume in real-time and enforce `MAX_FILE_SIZE` hard ceiling.
- [x] 3.3 Write unit tests for `MagicByteSniffer` and `CountingStream` covering valid PDFs, invalid magic bytes, spoofed MIME types, zip/archive files, and oversized streams.

## 4. Provider-Agnostic Storage & Multipart Cleanup

- [x] 4.1 Implement `S3StorageAdapter` implementing `IObjectStorageService` with bounded chunk streaming, incremental SHA-256 calculation, and deterministic `abortMultipartUpload` on error in `apps/backend/src/ingestion/storage/adapters/`.
- [x] 4.2 Add retry policy integration into `S3StorageAdapter` for handling transient network errors and rate throttling.
- [x] 4.3 Implement compensating storage deletion logic (`deleteObject`) for rolling back staged objects upon downstream failures.
- [x] 4.4 Write unit tests for `S3StorageAdapter` and mock storage adapters covering upload pass, midway upload failure with abort cleanup, transient retry with backoff, and non-retryable 403 failure.

## 5. TypeORM Persistence & Atomic Ingestion Pipeline

- [x] 5.1 Define TypeORM entities (`DocumentEntity`, `DocumentVersionEntity`, `IngestionJobEntity`, `OutboxEventEntity`) in `apps/backend/src/ingestion/database/entities/`.
- [x] 5.2 Implement `IngestionRepository` / `IngestionPersistenceService` wrapping the creation of document, version, job, and outbox records in an atomic TypeORM transaction via `DataSource`.
- [x] 5.3 Implement `IngestionService` coordinating stream validation, storage upload via `IObjectStorageService`, atomic TypeORM persistence, and compensation rollback if the DB transaction fails.
- [x] 5.4 Implement `IngestionController` with Busboy streaming handler (`POST /documents/upload`), OpenTelemetry tracing, and structured logging.

## 6. Comprehensive Testing & Verification

- [x] 6.1 Implement integration tests for happy path: valid PDF stream upload -> verified storage staging -> atomic TypeORM DB & outbox persistence -> 202 Accepted response.
- [x] 6.2 Implement tests for validation failures: oversized file, invalid MIME/magic bytes, and archive/zip bomb rejection.
- [x] 6.3 Implement test for external store unavailable during upload.
- [x] 6.4 Implement test for upload timeout and bounded retries.
- [x] 6.5 Implement test for inconsistency handling: storage upload succeeds but TypeORM transaction fails (verifying storage object cleanup and transaction rollback).
- [x] 6.6 Implement test for midway stream termination (verifying in-flight multipart upload is aborted).
- [x] 6.7 Run test suite (`npm run test`) and typecheck (`npm run check-types`) in `apps/backend` to verify all tests pass and no type errors exist.
