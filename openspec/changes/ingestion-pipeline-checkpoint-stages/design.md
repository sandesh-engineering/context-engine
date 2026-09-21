# Design: Ingestion Pipeline Checkpoint Stages & Resilience

## Context

The Knowledge Engine ingestion pipeline processes documents uploaded or imported into object storage. To ensure system reliability and scalability, pipeline processing is decomposed into independent, idempotent stages backed by durable database checkpoints.

System Core Principle:
> **Streaming solves memory usage. Durable stage boundaries solve retry ambiguity.**
> **Temporary disk solves parser seekability and memory pressure. Persisted artifacts solve retry and recovery.**
> **Preserve structure during extraction where reliably available; let the chunker exploit that structure; don't introduce a heavyweight parser solely to obtain Markdown.**

## Architecture & Flow

```
                                  +-------------------------------------+
                                  |  AWS SQS / SqsIngestionPollerService |
                                  +------------------+------------------+
                                                     |
                                                     v
                                  +------------------+------------------+
                                  |   IngestionPipelineExecutor        |
                                  +------------------+------------------+
                                                     |
            +----------------------------------------+----------------------------------------+
            |                                        |                                        |
            v                                        v                                        v
+-----------+-----------+                +-----------+-----------+                +-----------+-----------+
|    1. PARSING Stage   |                |   2. CHUNKING Stage   |                |   3. EMBEDDING Stage  |
|                       |                |                       |                |                       |
| - Stream S3 to Temp   |                | - Structure-aware     |                | - Select unembedded   |
|   Disk File           |                |   hierarchy           |                |   chunks              |
| - PdfParserAdapter    |                | - Normalize           |                | - Ollama HTTP API     |
| - ParsedDocument      |                | - Persist             |                |   (embeddinggemma)    |
|   (pages, blocks)     |                |   document_chunks     |                | - CircuitBreaker      |
| - Cleanup Temp File   |                |   (page_start/end)    |                | - Persist 768 vectors |
| - Checkpoint Database |                | - Checkpoint Database |                | - Checkpoint Database |
+-----------------------+                +-----------------------+                +-----------+-----------+
                                                                                              |
                                                                                              v
                                                                                  +-----------+-----------+
                                                                                  |   4. INDEXING Stage   |
                                                                                  |                       |
                                                                                  | - Confirm vectors     |
                                                                                  | - Mark COMPLETED      |
                                                                                  | - Delete SQS Message  |
                                                                                  +-----------------------+
```

## Detailed Component Design

### 1. Temporary Disk Storage (`TempStorageManager`)
- Streams S3 `GetObject` responses directly to local disk (`DOCUMENT_TEMP_DIR`).
- Generates unique temporary filenames (`pdf_<jobId>_<uuid>.tmp`).
- Enforces `DOCUMENT_MAX_SIZE_BYTES` during stream pipe and checks overall `DOCUMENT_TEMP_DISK_LIMIT_BYTES`.
- Guarantees file deletion in `finally` block.

### 2. Document Parser Abstraction & Normalized Model (`DocumentParser`)
```ts
export interface ParsedBlock {
  type: 'heading' | 'paragraph' | 'list' | 'table' | 'text';
  content: string;
}

export interface ParsedPage {
  pageNumber: number;
  blocks: ParsedBlock[];
}

export interface ParsedDocument {
  metadata: {
    pageCount?: number;
    title?: string;
    author?: string;
  };
  pages: ParsedPage[];
}

export interface DocumentParser {
  parse(input: { filePath: string; contentType?: string }): Promise<ParsedDocument>;
}
```
- Implementation: `PdfParserAdapter` wrapping Node.js `pdf-parse`.
- Extracts structured page blocks (page boundaries preserved; content normalized).
- Rejects zero-length text or corrupt PDFs as permanent `INTEGRITY` failures.
- Future connectors (Notion / Confluence) populate `ParsedDocument` directly without PDF parsing.

### 3. Durable Chunk Checkpoint (`DocumentChunkEntity` & `DocumentChunksRepository`)
- Schema (`document_chunks` table):
  - `id`: UUID (Primary Key)
  - `version_id`: UUID (Foreign Key -> `document_versions`)
  - `chunk_index`: Integer (`0..N-1`)
  - `content`: Text
  - `heading_path`: String (Nullable)
  - `page_start`: Integer (Nullable)
  - `page_end`: Integer (Nullable)
  - `token_count`: Integer
  - `start_char_offset`: Integer
  - `end_char_offset`: Integer
  - `embedding`: Vector (`vector(768)`)
  - `metadata_json`: JSONB
  - `created_at`: Timestamp
- Chunker Hierarchy: `section/heading` → `paragraph` → `block` → `token/character boundary`.
- Idempotency: `version_id` + `chunk_index` uniquely identifies chunk. Retries inspect existing chunks before insertion.

### 4. Local Ollama Provider & Circuit Breaker
- `OllamaEmbeddingProvider` implements `IEmbeddingProvider`:
  - Connects to local Ollama server (`http://localhost:11434/api/embeddings` or `/api/embed`).
  - Model: `embeddinggemma` (768 dimensions).
- `CircuitBreaker` Class:
  - States: `CLOSED`, `OPEN`, `HALF_OPEN`.
  - Configurable parameters: `failureThreshold`, `resetTimeoutMs`, `halfOpenMaxProbes`.
  - Reusable across `IEmbeddingProvider` and future `ILlmProvider`.

### 5. Resilient Stage Progression
- SQS message is ONLY deleted when `IngestionJob.stage` reaches `COMPLETED`.
- On retry, `IngestionPipelineExecutor` checks `job.stage`:
  - If `PARSING`: downloads S3 object to temp disk, parses text into `ParsedDocument`, advances stage to `CHUNKING`.
  - If `CHUNKING`: generates structure-aware chunks from `ParsedDocument`, commits `document_chunks` with page range metadata (`page_start`, `page_end`), advances stage to `EMBEDDING`.
  - If `EMBEDDING`: selects chunks where `embedding IS NULL`, processes in batches via Ollama, updates chunk embeddings, advances stage to `INDEXING`.
  - If `INDEXING`: confirms vector index availability, updates job status to `COMPLETED`, deletes SQS message.

## Risks & Trade-offs

| Risk | Mitigation |
| :--- | :--- |
| PDF parser returns un-segmented plain text | `PdfParserAdapter` falls back gracefully to single page/block structures without failing; chunker handles fallback. |
| Worker crashes mid-chunking | Stage remains `PARSING`; retry re-runs chunking idempotently by clearing or replacing incomplete chunks for the `versionId`. |
| Ollama API timeout / local GPU overload | `CircuitBreaker` opens to prevent worker pool exhaustion; `RetryPolicy` applies exponential backoff with full jitter for transient 5xx/timeouts. |
| Temporary disk fill up during concurrent downloads | `TempStorageManager` verifies total disk usage against `DOCUMENT_TEMP_DISK_LIMIT_BYTES` before creating new temporary streams. |
