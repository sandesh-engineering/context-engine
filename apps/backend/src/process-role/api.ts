/**
 * Marks this process as the HTTP API. Import it first in main.ts, before anything reads config.
 *
 * @remarks
 * ConfigModule validates the environment when AppModule is imported, so the flag has to be in
 * process.env before that import. The API never runs SQS consumers or outbox pollers, even if a
 * shared env file says WORKER_ENABLED=true.
 */
process.env.WORKER_ENABLED = 'false';

export {};
