## Why

The Knowledge Engine requires a resilient, secure, and production-ready backend pipeline for direct single-document uploads. Direct uploads must stream safely without memory exhaustion, validate file integrity and format early (MIME, raw magic bytes, archive/malicious heuristics), stage into object storage through a provider-agnostic interface with bounded retries and exponential backoff, and atomically persist document records, ingestion jobs, and transactional outbox events via TypeORM to PostgreSQL.

## What Changes

- Implement streaming multipart file upload processing using Busboy in NestJS backend (`apps/backend`).
- Add a multi-layer stream validation pipeline:
  - Strict size enforcement with authoritative byte counting during stream consumption.
  - Raw magic byte sniffer (verifying `%PDF-` signature; rejecting zip/gzip, PE `MZ`, and ELF binaries) without redundant heavy external dependencies.
- Implement provider-agnostic storage abstraction (`IObjectStorageService` / Adapter pattern) with AWS S3 / Floci implementation, bounded retries, error classification (transient vs permanent), exponential backoff with full jitter, and deterministic multipart cleanup on abort.
- Implement transactional persistence layer using TypeORM and PostgreSQL to atomically record:
  - Document & DocumentVersion entities
  - IngestionJob (status `PENDING`, stage tracking)
  - Transactional Outbox event for downstream asynchronous worker consumption.
- Implement failure recovery and consistency handling: ensure orphaned multipart uploads are aborted and staged storage artifacts are compensated (deleted) if the TypeORM transaction fails.
- Add OpenTelemetry tracing, structured JSON logging with context propagation, and error redaction.
- Create a reusable custom skill `.agents/skills/design-patterns/SKILL.md` consolidating SOLID principles and RefactoringGuru GoF design patterns tailored for NestJS & TypeScript.

## Capabilities

### New Capabilities
- `ingestion/direct-upload`: Direct single document file upload intake, stream validation, provider-agnostic storage staging, atomic TypeORM outbox persistence, and error recovery in the backend.

### Modified Capabilities
<!-- None -->

## Impact

- **Backend Architecture**: Introduces ingestion module, storage port/adapters, stream validation pipeline, and TypeORM transactional outbox infrastructure in `apps/backend`.
- **Dependencies**: Adds `busboy`, `@types/busboy`, `typeorm`, `@nestjs/typeorm`, `pg`, and AWS S3 SDK (`@aws-sdk/client-s3`).
- **Observability**: Integrates OpenTelemetry spans and structured logging into file intake paths.
- **Reliability & Security**: Adheres to SOLID principles, isolates storage vendor specifics, and eliminates OOM, archive bombs, and DB/storage inconsistencies.
