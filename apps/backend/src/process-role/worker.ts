/**
 * Marks this process as the background worker. Import it first in main-worker.ts, before anything reads config.
 *
 * @remarks
 * The worker owns every background loop: ingestion/embedding SQS consumers and both outbox pollers.
 */
process.env.WORKER_ENABLED = 'true';

export {};
