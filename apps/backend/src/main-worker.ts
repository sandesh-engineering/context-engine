import { sdk } from './instrumentation';
sdk.start();

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

/**
 * Bootstraps the standalone SQS worker entrypoint process.
 *
 * @remarks
 * - Forces `WORKER_ENABLED=true` in environment context.
 * - Creates lightweight NestJS application context (non-HTTP server).
 * - Enables shutdown hooks for graceful `SIGINT`/`SIGTERM` handling.
 *
 * @returns {Promise<void>}
 */
async function bootstrapWorker(): Promise<void> {
  const logger = new Logger('WorkerMain');

  /* Enforce WORKER_ENABLED=true for dedicated worker process entrypoint */
  process.env.WORKER_ENABLED = 'true';

  logger.log('Initializing Knowledge Engine SQS Ingestion Worker standalone process', {
    workerEnabled: true,
  });

  const app = await NestFactory.createApplicationContext(AppModule);

  app.enableShutdownHooks();

  logger.log('Standalone worker process successfully initialized and running');

  const handleShutdown = async (signal: string) => {
    logger.log('Shutting down worker application context', { signal });
    await app.close();
    logger.log('Worker application context closed cleanly', { signal });
    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

bootstrapWorker().catch((error) => {
  console.error('Fatal error initializing standalone worker entrypoint', {
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
});
