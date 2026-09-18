/* Document source origin type */
export enum DocumentSourceType {
  DIRECT_UPLOAD = 'direct_upload',
  EXTERNAL_URL = 'external_url',
  S3_DIRECT = 's3_direct',
}

/* Ingestion job life-cycle status */
export enum IngestionJobStatus {
  PENDING = 'PENDING',
  PROCESSING = 'PROCESSING',
  COMPLETED = 'COMPLETED',
  FAILED = 'FAILED',
}

/* Granular pipeline processing stages */
export enum IngestionJobStage {
  DOWNLOADING = 'DOWNLOADING',
  UPLOADING = 'UPLOADING',
  VERIFYING = 'VERIFYING',
  AVAILABLE = 'AVAILABLE',
  PARSING = 'PARSING',
  CHUNKING = 'CHUNKING',
  EMBEDDING = 'EMBEDDING',
  INDEXING = 'INDEXING',
}

/* Domain context for events */
export enum Domain {
  DOCUMENT = 'DOCUMENT',
  INGESTION = 'INGESTION',
}
