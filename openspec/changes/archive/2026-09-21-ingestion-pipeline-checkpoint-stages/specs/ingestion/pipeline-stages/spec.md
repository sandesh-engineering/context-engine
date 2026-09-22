## Purpose

Defines the behavior contract for the ingestion pipeline stage execution, bounded temporary disk PDF storage, structure-aware chunking, local Ollama 768-dimensional vector generation with circuit breaker resilience, and durable stage checkpointing.

## ADDED Requirements

### Requirement: Streaming Temp Disk S3 Storage & Bounded Download
The system SHALL stream S3 document objects directly to local temporary disk storage (`DOCUMENT_TEMP_DIR`) without buffering the full binary payload in application memory, enforcing configurable maximum object size (`DOCUMENT_MAX_SIZE_BYTES`) and total temporary disk capacity limits (`DOCUMENT_TEMP_DISK_LIMIT_BYTES`).

#### Scenario: Successful streaming to temporary file
- **WHEN** the worker poller retrieves an S3 document object for processing
- **THEN** it creates a uniquely named local temporary file, streams bytes directly from S3, verifies byte length, and deletes the temporary file in a `finally` block upon stage completion or failure

#### Scenario: Download size limit exceeded
- **WHEN** an S3 document object stream exceeds `DOCUMENT_MAX_SIZE_BYTES` during download
- **THEN** the worker aborts the S3 stream, cleans up the temporary file, and marks the job stage as `FAILED` with a `RESOURCE_LIMIT` classification

### Requirement: Abstract Document PDF Parsing
The system SHALL parse PDF document text and extract page-level blocks using a Node.js `DocumentParser` abstraction without external Tika/Java dependencies, preserving page boundaries (`pageNumber`), blocks (`heading`, `paragraph`, `list`, `table`, `text`), and metadata while rejecting textless or corrupt PDFs as permanent failures.

#### Scenario: Successful structured PDF text extraction
- **WHEN** a valid PDF file is passed to `DocumentParser`
- **THEN** it extracts structured pages, page numbers, blocks, page count, and title metadata

#### Scenario: Textless or corrupted PDF rejection
- **WHEN** a PDF contains zero extractable text or unparseable binary structure
- **THEN** `DocumentParser` throws a classified failure and the pipeline transitions the job to `FAILED` without retrying

### Requirement: Structure-Aware Chunking & Durable Chunk Checkpoint
The system SHALL transform normalized `ParsedDocument` content into structure-aware chunks respecting semantic boundaries (`section/heading` → `paragraph` → `block` → `token/character`), preserving source location metadata (`page_start`, `page_end`, `heading_path`), and persisting `DocumentChunkEntity` records in PostgreSQL as the durable checkpoint before embedding.

#### Scenario: Chunk persistence checkpoint with page location
- **WHEN** text extraction completes and chunking generates sequential `document_chunk` records (`chunk_index = 0..N-1`)
- **THEN** the system commits `document_chunk` rows with `page_start` and `page_end` metadata to PostgreSQL and updates `IngestionJob.stage` to `CHUNKING`

#### Scenario: Idempotent re-chunking on retry
- **WHEN** a job retries at the `CHUNKING` stage
- **THEN** existing `document_chunk` records for the `versionId` are inspected and clean replacements or existing chunks are reused without creating duplicate rows

### Requirement: Ollama Local Embedding & Resilient Circuit Breaker
The system SHALL generate 768-dimensional vector embeddings for document chunks using a local Ollama `embeddinggemma` model, wrapping requests with configurable retries, backoff with jitter, and a reusable `CircuitBreaker`.

#### Scenario: Unembedded chunk batch generation
- **WHEN** the embedding stage executes
- **THEN** the worker queries chunks where vector embedding is missing, batches them up to `EMBEDDING_BATCH_SIZE`, invokes Ollama, and persists vectors to `document_chunk` rows

#### Scenario: Chunk-level retry resume
- **WHEN** job execution retries after partial embedding failure (e.g. 200 of 500 chunks embedded)
- **THEN** the worker resumes embedding only for the remaining 300 unembedded chunks without re-embedding previously persisted chunks

#### Scenario: Circuit breaker trip on unhealthy dependency
- **WHEN** Ollama API consecutive failure threshold is exceeded
- **THEN** `CircuitBreaker` opens, fast-failing subsequent requests until reset duration expires and half-open probe succeeds

### Requirement: Durable Stage Progression & Worker SQS Semantics
The system SHALL update `IngestionJob.stage` monotonically (`PARSING` → `CHUNKING` → `EMBEDDING` → `INDEXING` → `AVAILABLE/COMPLETED`) only after the stage's durable checkpoint exists in PostgreSQL, and acknowledge (delete) the SQS message ONLY after the pipeline completes successfully.

#### Scenario: Stage progression after durable checkpoint
- **WHEN** a pipeline stage finishes persisting its durable state in PostgreSQL
- **THEN** `IngestionJob.stage` updates to the next stage, providing recovery state for crash retries

#### Scenario: Worker crash recovery
- **WHEN** a worker process crashes mid-pipeline and SQS visibility timeout expires
- **THEN** a new worker receives the redriven SQS message, loads job stage and chunk state from PostgreSQL, and resumes from the exact uncompleted stage/chunk
