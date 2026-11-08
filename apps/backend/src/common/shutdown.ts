import type { INestApplicationContext } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { sdk } from '../instrumentation';

/**
 * Closes the Nest application (running OnModuleDestroy hooks such as poller stops) and then
 * flushes OpenTelemetry, once, on SIGINT/SIGTERM.
 *
 * @remarks
 * Use this instead of `app.enableShutdownHooks()` so the trace flush happens after the app has
 * finished its in-flight work, not in a racing signal handler.
 */
export function registerGracefulShutdown(app: INestApplicationContext, name: string): void {
  const logger = new Logger(name);
  let shuttingDown = false;

  const shutdown = async (signal: NodeJS.Signals): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.log(`Received ${signal}, shutting down`);

    let exitCode = 0;
    try {
      await app.close();
    } catch (error) {
      exitCode = 1;
      logger.error('Application close failed', error instanceof Error ? error.stack : String(error));
    }
    await sdk.shutdown().catch((error: unknown) => {
      logger.warn(`Tracing shutdown failed: ${error instanceof Error ? error.message : String(error)}`);
    });
    process.exit(exitCode);
  };

  process.once('SIGINT', (signal) => void shutdown(signal));
  process.once('SIGTERM', (signal) => void shutdown(signal));
}
