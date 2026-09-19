# Tasks: Ingestion Pipeline Checkpoint Stages & Resilience

## 1. Environment & Configuration Setup

- [x] 1.1 Update `env.validation.ts` and `AppConfigService` in `apps/backend/src/config/` to support PDF temp disk settings (`DOCUMENT_TEMP_DIR`, `DOCUMENT_MAX_SIZE_BYTES`, `DOCUMENT_TEMP_DISK_LIMIT_BYTES`), Ollama embedding config (`OLLAMA_BASE_URL`, `OLLAMA_EMBEDDING_MODEL`, `EMBEDDING_DIMENSIONS`, `EMBEDDING_BATCH_SIZE`), and Circuit Breaker thresholds, and verify validation schemas pass.
- [x] 1.2 Add `pdf-parse` dependency to `apps/backend/package.json` and verify package installation succeeds.

## 2. Temporary Storage & Document Parser Abstraction

- [x] 2.1 Implement `TempStorageManager` in `apps/backend/src/ingestion/services/temp-storage-manager.service.ts` to stream S3 objects into temporary disk files with size limits and `finally` cleanup block, and verify unit tests mock file creation/deletion.
- [x] 2.2 Implement `DocumentParser` interface and `PdfParserAdapter` using `pdf-parse` in `apps/backend/src/ingestion/parsing/` returning structured `ParsedDocument` (pages, blocks, metadata) and verify unit tests parse sample text and reject empty PDFs.

## 3. Durable Chunk Checkpoint & Repository Layer

- [x] 3.1 Create `DocumentChunkEntity` in `apps/backend/src/ingestion/database/entities/document-chunk.entity.ts` with `page_start` and `page_end` columns, and update TypeORM exports and database module configuration.
- [x] 3.2 Implement `DocumentChunksRepository` in `apps/backend/src/ingestion/database/repositories/document-chunks.repository.ts` with batch chunk insertion, idempotency checks, and unembedded chunk query methods.
- [x] 3.3 Implement `StructureAwareChunker` in `apps/backend/src/ingestion/chunking/` consuming `ParsedDocument` (`heading` → `paragraph` → `block` → `token/character`) conforming to `docs/domain/chunking.md` and verify unit tests for page range metadata, heading boundaries, and token limits.

## 4. Resilience Primitives & Ollama Embedding Provider

- [x] 4.1 Implement reusable `CircuitBreaker` in `apps/backend/src/ingestion/resilience/circuit-breaker.ts` supporting `CLOSED`, `OPEN`, `HALF_OPEN` states with configurable thresholds, and verify unit tests for failure tripping and half-open probing.
- [x] 4.2 Implement `IEmbeddingProvider` interface and `OllamaEmbeddingProvider` in `apps/backend/src/ingestion/embeddings/` targeting `embeddinggemma` (768 dimensions) with `RetryPolicy` and `CircuitBreaker` resilience.

## 5. Pipeline Stage Executor & SQS Worker Integration

- [x] 5.1 Implement `IngestionPipelineExecutor` in `apps/backend/src/ingestion/pipeline/` executing monotonic stage progression (`PARSING` → `CHUNKING` → `EMBEDDING` → `INDEXING` → `COMPLETED`) with stage checkpoints and chunk-level retry resumption.
- [x] 5.2 Integrate `IngestionPipelineExecutor` with `SqsIngestionPollerService` in `apps/backend/src/ingestion/worker/` ensuring SQS message deletion occurs ONLY after pipeline completion.

## 6. Testing & Verification

- [x] 6.1 Write unit tests in `apps/backend/src/ingestion/__tests__/pipeline-stages.spec.ts` testing S3 streaming temp storage, structured PDF parsing, chunk persistence with page range metadata, Ollama embedding retries, circuit breaker tripping, and stage crash recovery.
