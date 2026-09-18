## Context

The backend skeleton lives in `apps/backend` (NestJS). The architecture document `docs/architecture/ingestion.md` mandates an asynchronous streaming intake model that avoids local disk or unbounded memory spooling. This design establishes single direct document upload intake, raw buffer stream validation, provider-agnostic storage staging, and atomic persistence with transactional outbox events using TypeORM in `apps/backend`.

## Goals / Non-Goals

**Goals:**
- Provide direct single-file upload endpoint (`POST /documents/upload`) using Busboy for streaming.
- Implement extensible pipe-and-filter stream validation with a lightweight raw buffer `MagicByteSniffer` (checking `%PDF-`, rejecting zip/gzip and PE/ELF executables without heavyweight third-party libraries).
- Implement a provider-agnostic storage port (`IObjectStorageService`) and adapter (`S3StorageAdapter` / Floci-compatible) with bounded memory buffers (5–8 MB part chunks), running SHA-256 calculation, and deterministic multipart cleanup on failure.
- Implement retry mechanism with error classification (transient 429/5xx vs permanent 400/403) and exponential backoff with full jitter.
- Implement transactional persistence using TypeORM entities (`DocumentEntity`, `DocumentVersionEntity`, `IngestionJobEntity`, `OutboxEventEntity`) and `DataSource` query runner / transaction manager.
- Implement compensating rollback: delete staged raw storage object if TypeORM transaction fails after upload.
- Integrate OpenTelemetry span context and structured logging with sensitive header/credential redaction.
- Create a comprehensive custom skill `.agents/skills/design-patterns/SKILL.md` consolidating SOLID principles and RefactoringGuru GoF design patterns (Adapter, Strategy, Factory, Pipeline, Unit of Work) tailored for NestJS & TypeScript.

**Non-Goals:**
- External URL ingestion or S3-to-S3 direct copy (deferred to subsequent changes).
- Downstream AI pipeline workers (text parsing, chunking, pgvector embeddings).
- Live AWS cloud provisioning (local emulation via Floci or unit/integration mocks).

## Decisions

### 1. Storage Provider Agnostic Abstraction (Adapter Pattern & DIP)
- **Decision**: Define an abstract storage port interface `IObjectStorageService` using NestJS injection token `OBJECT_STORAGE_SERVICE`:
  ```typescript
  export interface IObjectStorageService {
    createMultipartUpload(key: string, metadata?: Record<string, string>): Promise<string>;
    uploadPart(uploadId: string, key: string, partNumber: number, buffer: Buffer): Promise<{ eTag: string }>;
    completeMultipartUpload(uploadId: string, key: string, parts: Array<{ partNumber: number; eTag: string }>): Promise<UploadResult>;
    abortMultipartUpload(uploadId: string, key: string): Promise<void>;
    deleteObject(key: string): Promise<void>;
  }
  ```
- **Rationale**: Keeps the core ingestion pipeline decoupled from AWS SDK specifics. Supports AWS S3, Floci local emulator, MinIO, or mock storage without altering domain logic (Dependency Inversion Principle).
- **Alternative**: Direct SDK coupling in services (rejected due to violation of DIP and testing rigidity).

### 2. Stream Validation: Lightweight Raw Buffer Sniffing (Single Responsibility)
- **Decision**: Implement a pure TypeScript `MagicByteSniffer` utility using `Buffer.compare` / slice inspection directly on the first chunk:
  - Valid PDF signature: `Buffer.from('%PDF-')` (`[0x25, 0x50, 0x44, 0x46, 0x2D]`).
  - Zip / Office XML: `[0x50, 0x4B, 0x03, 0x04]`.
  - Gzip: `[0x1F, 0x8B]`.
  - Windows PE: `Buffer.from('MZ')` (`[0x4D, 0x5A]`).
  - Linux ELF: `[0x7F, 0x45, 0x4C, 0x46]`.
- **Rationale**: Sniffing known document headers takes fewer than 40 lines of clear, zero-dependency code, avoiding bulky third-party libraries.

### 3. Database Persistence: TypeORM Entities & Transaction Manager
- **Decision**: Implement TypeORM entities with a dedicated repository/service leveraging `DataSource.transaction()`:
  - `DocumentEntity` (`id`, `tenantId`, `title`, `sourceType`, `createdAt`)
  - `DocumentVersionEntity` (`id`, `documentId`, `versionNumber`, `storageKey`, `sha256Digest`, `byteSize`, `mimeType`)
  - `IngestionJobEntity` (`id`, `versionId`, `status`, `stage`, `attemptCount`)
  - `OutboxEventEntity` (`id`, `topic`, `payload`, `status`, `publishedAt`)
- **Rationale**: Native NestJS integration via `@nestjs/typeorm` and explicit transactional query runners for ACID safety.

### 4. Bounded Retry Engine with Error Classifier
- **Decision**: Encapsulate retry logic in a generic `RetryPolicy` supporting:
  - Classification: Retryable (HTTP 429, 500, 502, 503, 504, `NetworkingError`, `TimeoutError`) vs Permanent (HTTP 400, 401, 403, 404, `InvalidChecksum`, `PayloadTooLarge`).
  - Exponential backoff with full jitter: $T_{\text{sleep}} = \text{random}(0, \min(T_{\max}, T_{\text{base}} \cdot 2^{\text{attempt}}))$.

### 5. Atomic Persistence & Consistency Compensation
- **Decision**: Execute database persistence within a single TypeORM transaction.
- **Compensation**: If TypeORM transaction fails after storage upload succeeds, catch the exception, execute `storageService.deleteObject(key)`, log an alert, and respond with HTTP 500.

### 6. Design Patterns as Custom Reusable Skill
- **Decision**: Create `.agents/skills/design-patterns/SKILL.md` consolidating:
  - SOLID Principles: SRP, OCP, LSP, ISP, DIP with NestJS examples.
  - GoF Creational Patterns: Factory Method, Abstract Factory, Builder.
  - GoF Structural Patterns: Adapter, Decorator, Facade, Composite.
  - GoF Behavioral Patterns: Strategy, Pipeline / Chain of Responsibility, Observer / Outbox, Template Method.

## Risks / Trade-offs

- **[Risk] Client disconnects midway through multipart stream** → **[Mitigation]** The stream uploader registers `'close'` and `'error'` listeners to trigger immediate `abortMultipartUpload`.
- **[Risk] TypeORM connection or transaction failure after storage staging** → **[Mitigation]** Explicit compensating call to `deleteObject` purges orphaned storage binaries.
- **[Risk] High concurrent upload memory consumption** → **[Mitigation]** Each active upload stream buffer is bounded to 5–8 MB. Concurrency limits and backpressure prevent process OOM.
