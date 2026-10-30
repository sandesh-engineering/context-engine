/**
 * Stable event names for structured logging across the Knowledge Engine pipeline.
 */
export const LogEvents = {
  // Ingestion HTTP & Intake
  INGESTION_INTAKE_STARTED: 'ingestion.intake.started',
  INGESTION_INTAKE_COMPLETED: 'ingestion.intake.completed',
  INGESTION_INTAKE_FAILED: 'ingestion.intake.failed',

  // Outbox Polling & Relay
  OUTBOX_POLL_STARTED: 'outbox.poll.started',
  OUTBOX_POLL_EMPTY: 'outbox.poll.empty',
  OUTBOX_PUBLISH_STARTED: 'outbox.publish.started',
  OUTBOX_PUBLISH_COMPLETED: 'outbox.publish.completed',
  OUTBOX_PUBLISH_FAILED: 'outbox.publish.failed',
  OUTBOX_RETRY_SCHEDULED: 'outbox.retry.scheduled',
  OUTBOX_DLQ_ROUTED: 'outbox.dlq.routed',

  // SQS Queue Operations
  QUEUE_MESSAGE_RECEIVED: 'queue.message.received',
  QUEUE_MESSAGE_ACKNOWLEDGED: 'queue.message.acknowledged',
  QUEUE_MESSAGE_FAILED: 'queue.message.failed',
  QUEUE_DUPLICATE_SKIPPED: 'queue.duplicate.skipped',

  // Ingestion Worker Stages
  INGESTION_JOB_STARTED: 'ingestion.job.started',
  INGESTION_JOB_CLAIMED: 'ingestion.job.claimed',
  INGESTION_JOB_COMPLETED: 'ingestion.job.completed',
  INGESTION_JOB_FAILED: 'ingestion.job.failed',

  DOCUMENT_DOWNLOAD_STARTED: 'document.download.started',
  DOCUMENT_DOWNLOAD_COMPLETED: 'document.download.completed',
  DOCUMENT_DOWNLOAD_FAILED: 'document.download.failed',

  DOCUMENT_PARSE_STARTED: 'document.parse.started',
  DOCUMENT_PARSE_COMPLETED: 'document.parse.completed',
  DOCUMENT_PARSE_FAILED: 'document.parse.failed',

  DOCUMENT_CHUNK_STARTED: 'document.chunk.started',
  DOCUMENT_CHUNK_COMPLETED: 'document.chunk.completed',
  DOCUMENT_CHUNK_FAILED: 'document.chunk.failed',

  // Embedding Worker Stages
  EMBEDDING_JOB_STARTED: 'embedding.job.started',
  EMBEDDING_BATCH_STARTED: 'embedding.batch.started',
  EMBEDDING_BATCH_COMPLETED: 'embedding.batch.completed',
  EMBEDDING_BATCH_FAILED: 'embedding.batch.failed',
  EMBEDDING_PERSIST_COMPLETED: 'embedding.persist.completed',
  EMBEDDING_JOB_COMPLETED: 'embedding.job.completed',
  EMBEDDING_JOB_FAILED: 'embedding.job.failed',

  // RAG & Retrieval
  RETRIEVAL_STARTED: 'retrieval.started',
  RETRIEVAL_QUERY_EMBEDDED: 'retrieval.query_embedded',
  RETRIEVAL_CANDIDATES_FOUND: 'retrieval.candidates.found',
  RETRIEVAL_NO_EVIDENCE: 'retrieval.no_evidence',
  RETRIEVAL_FAILED: 'retrieval.failed',
  RETRIEVAL_RERANK_STARTED: 'retrieval.rerank.started',
  RETRIEVAL_RERANK_COMPLETED: 'retrieval.rerank.completed',
  RETRIEVAL_RERANK_FALLBACK: 'retrieval.rerank.fallback',
  RETRIEVAL_HYBRID_STARTED: 'retrieval.hybrid.started',
  RETRIEVAL_KEYWORD_SEARCHED: 'retrieval.keyword.searched',
  RETRIEVAL_RRF_FUSED: 'retrieval.rrf.fused',
  RETRIEVAL_KEYWORD_FALLBACK: 'retrieval.keyword.fallback',

  // Chat
  CHAT_SESSION_CREATED: 'chat.session.created',
  CHAT_REQUEST_STARTED: 'chat.request.started',
  CHAT_CONTEXT_ASSEMBLED: 'chat.context.assembled',
  CHAT_LLM_STREAM_STARTED: 'chat.llm.stream_started',
  CHAT_LLM_COMPLETED: 'chat.llm.completed',
  CHAT_REQUEST_COMPLETED: 'chat.request.completed',
  CHAT_REQUEST_FAILED: 'chat.request.failed',
} as const;

export type LogEvent = (typeof LogEvents)[keyof typeof LogEvents] | string;
