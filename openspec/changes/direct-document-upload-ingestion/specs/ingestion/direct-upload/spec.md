## Purpose

Provides a secure, streaming-first intake and validation capability for direct document uploads, persisting raw files to object storage through a provider-agnostic interface with bounded retries and registering records in PostgreSQL via TypeORM with transactional outbox events.

## ADDED Requirements

### Requirement: Direct File Streaming Intake
The system SHALL process incoming single-document multipart/form-data uploads via streaming using Busboy without buffering the entire payload into server memory or writing intermediate files to disk.

#### Scenario: Successful file stream initialization
- **WHEN** a client sends a valid multipart request with a single document file
- **THEN** the system streams file bytes incrementally into the processing pipeline and counts transmitted bytes in real-time

#### Scenario: File size exceeds maximum limit
- **WHEN** the incoming stream exceeds the configured maximum document size limit during transmission
- **THEN** the system immediately terminates the stream, aborts any in-flight storage upload, and returns an HTTP 413 or 400 Bad Request error indicating payload size exceeded

### Requirement: Magic Byte and MIME Validation
The system SHALL inspect the initial byte header (magic bytes) of the uploaded stream via raw buffer inspection to verify true file format and reject any content that is not a valid PDF file regardless of declared MIME type or file extension.

#### Scenario: Valid PDF magic bytes
- **WHEN** the uploaded stream starts with the `%PDF-` file signature (`0x25, 0x50, 0x44, 0x46, 0x2D`) and matches PDF MIME type
- **THEN** the validation pipeline allows the stream to proceed to storage staging

#### Scenario: Spoofed MIME type with invalid magic bytes
- **WHEN** the request headers declare `application/pdf` but the initial bytes do not match `%PDF-` signature
- **THEN** the system rejects the upload immediately, aborts downstream processing, and returns an HTTP 400 Bad Request indicating invalid file format

### Requirement: Archive and Malicious Content Protection
The system SHALL inspect uploaded binaries for zip/archive signatures (`PK\x03\x04`, gzip `\x1f\x8b`) and known malicious executable patterns (PE `MZ`, ELF `\x7fELF`), rejecting archive bombs or executable payloads disguised as documents.

#### Scenario: Compressed archive or zip payload detected
- **WHEN** the file stream contains zip headers (`PK\x03\x04`) or gzip compressed stream signatures when a PDF was expected
- **THEN** the system rejects the upload, halts streaming, and flags the transaction as an invalid/prohibited format

#### Scenario: Dangerous executable signature detected
- **WHEN** the file stream contains executable headers (e.g. PE `MZ`, ELF)
- **THEN** the system aborts the upload immediately and logs a security violation event

### Requirement: Provider-Agnostic Resilient Storage with Bounded Retries
The system SHALL stream raw document bytes to object storage via an abstract storage interface (`IObjectStorageService`), calculating incremental SHA-256 digests, and applying error classification with exponential backoff and jitter for transient storage errors.

#### Scenario: Successful storage multipart upload and metadata collection
- **WHEN** stream validation succeeds and all parts are uploaded to destination storage
- **THEN** storage multipart upload completes, returning object ETag, key, and computed SHA-256 digest

#### Scenario: Transient storage network glitch or throttling
- **WHEN** an individual storage `UploadPart` fails due to a transient error or rate limit (HTTP 429/500/503)
- **THEN** the system executes bounded retries with exponential backoff and full jitter before deciding to abort

#### Scenario: Permanent storage access error
- **WHEN** a storage call fails with a non-retryable error (e.g. HTTP 403 Access Denied or bucket not found)
- **THEN** the system aborts the upload immediately without retrying and marks the ingestion job failed

### Requirement: Storage Multipart Failure Cleanup
The system SHALL deterministically abort any in-flight multipart upload if the streaming transfer fails midway or encounters a timeout, preventing orphaned multipart fragments in storage.

#### Scenario: Stream disconnected midway
- **WHEN** client connection drops or an unrecoverable error occurs during streaming
- **THEN** the system invokes storage multipart abort for the current upload ID and cleans up allocated memory buffers

### Requirement: Transactional Database Persistence via TypeORM and Outbox Event
The system SHALL execute an atomic TypeORM PostgreSQL transaction after successful storage staging to insert Document, DocumentVersion, IngestionJob (status `PENDING`), and Transactional Outbox records.

#### Scenario: Successful atomic persistence
- **WHEN** storage upload completes successfully
- **THEN** the TypeORM transaction commits the Document, Version, IngestionJob, and Outbox event atomically and returns HTTP 202 Accepted with job metadata

#### Scenario: Database transaction failure after storage upload
- **WHEN** storage upload succeeds but the subsequent TypeORM database transaction fails or times out
- **THEN** the database transaction is rolled back, the staged storage object is safely deleted/purged to preserve consistency, and an error response is returned to client

### Requirement: Observability and Telemetry Propagation
The system SHALL instrument the upload pipeline with OpenTelemetry spans, trace IDs, and structured JSON logs without leaking raw auth credentials or sensitive request headers.

#### Scenario: Telemetry context propagation across pipeline stages
- **WHEN** an upload request is processed
- **THEN** all logs, metrics, and downstream outbox payloads contain the correlated `traceId`, `tenantId`, and `documentId`
