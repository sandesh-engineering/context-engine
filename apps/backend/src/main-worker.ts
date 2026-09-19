import { sdk } from './instrumentation';
sdk.start();

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrapWorker() {
  const logger = new Logger('WorkerMain');

  // Enforce WORKER_ENABLED=true for dedicated worker process entrypoint
  process.env.WORKER_ENABLED = 'true';

  logger.log('Initializing Knowledge Engine SQS Ingestion Worker standalone process...');

  const app = await NestFactory.createApplicationContext(AppModule);

  app.enableShutdownHooks();

  logger.log('Standalone worker process successfully initialized and running');

  const handleShutdown = async (signal: string) => {
    logger.log(`Received signal ${signal}. Shutting down worker application context...`);
    await app.close();
    logger.log('Worker application context closed. Exiting process.');
    process.exit(0);
  };

  process.on('SIGINT', () => handleShutdown('SIGINT'));
  process.on('SIGTERM', () => handleShutdown('SIGTERM'));
}

bootstrapWorker().catch((error) => {
  console.error('Fatal error initializing standalone worker entrypoint:', error);
  process.exit(1);
});
