/* Must stay first: sets WORKER_ENABLED=true before config is loaded */
import './process-role/worker';
import { sdk } from './instrumentation';
sdk.start();

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';
import { registerGracefulShutdown } from './common/shutdown';

/**
 * Bootstraps the standalone worker process.
 *
 * @remarks
 * - Runs every background loop: ingestion and embedding SQS consumers plus both outbox pollers.
 * - Creates a NestJS application context without an HTTP server.
 * - On SIGINT/SIGTERM, stops the loops (OnModuleDestroy) and then flushes tracing.
 *
 * @returns {Promise<void>}
 */
async function bootstrapWorker(): Promise<void> {
  const logger = new Logger('WorkerMain');

  logger.log('Initializing Knowledge Engine worker process');

  const app = await NestFactory.createApplicationContext(AppModule);
  registerGracefulShutdown(app, 'WorkerMain');

  logger.log('Worker process initialized and running');
}

bootstrapWorker().catch((error) => {
  console.error('Fatal error initializing standalone worker entrypoint', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
