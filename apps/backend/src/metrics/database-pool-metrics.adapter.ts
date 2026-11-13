import { Injectable, Logger } from '@nestjs/common';
import type { DataSource } from 'typeorm';

export interface PoolStats {
  totalConnections: number;
  idleConnections: number;
  activeConnections: number;
  waitingRequests: number;
  maxConnections: number;
  utilizationPercent: number;
}

export interface UnderlyingPgPool {
  totalCount: number;
  idleCount: number;
  waitingCount: number;
  options: {
    max?: number;
    [key: string]: unknown;
  };
  connect: {
    (cb?: (err: Error, client: unknown, done: () => void) => void): unknown;
    __metrics_instrumented?: boolean;
  };
  on?: (event: string, listener: (...args: unknown[]) => void) => void;
}

/**
 * DatabasePoolMetricsAdapter
 *
 * Provides a clean, isolated bridge between TypeORM's internal PostgresDriver
 * and application metrics collection.
 *
 * Compatibility Notes:
 * - TypeORM (0.3.x): The underlying pg-pool instance is stored on `dataSource.driver.master`
 *   (and referenced by `dataSource.driver.pool`) within PostgresDriver.
 * - Underlying `pg.Pool` properties:
 *     - `totalCount`: Total allocated client connections (active + idle).
 *     - `idleCount`: Available idle connections ready for immediate checkout.
 *     - `waitingCount`: Queued callers waiting in `pool.connect()` when pool is exhausted.
 *     - `options.max`: Configured upper limit for pool connections.
 * - This adapter reads these synchronous getters directly at scrape time,
 *   introducing zero polling loops, zero background timers, and minimal overhead.
 */
@Injectable()
export class DatabasePoolMetricsAdapter {
  private readonly logger = new Logger(DatabasePoolMetricsAdapter.name);
  private pool: UnderlyingPgPool | null = null;
  private isInstrumented = false;

  /**
   * Binds a TypeORM DataSource and extracts the underlying pg.Pool instance.
   */
  bindDataSource(dataSource?: DataSource): boolean {
    if (!dataSource) {
      return false;
    }

    try {
      const driver = dataSource.driver as any;
      if (!driver) {
        this.logger.debug('No driver found on DataSource.');
        return false;
      }

      // In TypeORM PostgresDriver, driver.master holds the primary pg.Pool instance
      const rawPool = driver.master || driver.pool;
      if (!rawPool || typeof rawPool.totalCount !== 'number') {
        this.logger.debug('Driver does not appear to be a PostgresDriver with an active pg.Pool.');
        return false;
      }

      this.pool = rawPool as UnderlyingPgPool;
      this.logger.log(
        `Successfully attached to PostgreSQL pool (max: ${this.getMaxConnections()}).`,
      );
      return true;
    } catch (err) {
      this.logger.warn(`Failed to extract PostgreSQL pool from DataSource: ${err}`);
      return false;
    }
  }

  isAvailable(): boolean {
    return this.pool !== null;
  }

  getTotalConnections(): number {
    return this.pool ? this.pool.totalCount : 0;
  }

  getIdleConnections(): number {
    return this.pool ? this.pool.idleCount : 0;
  }

  getActiveConnections(): number {
    if (!this.pool) return 0;
    return Math.max(0, this.pool.totalCount - this.pool.idleCount);
  }

  getWaitingRequests(): number {
    return this.pool ? this.pool.waitingCount : 0;
  }

  getMaxConnections(): number {
    if (!this.pool || !this.pool.options) return 10;
    return typeof this.pool.options.max === 'number' && this.pool.options.max > 0
      ? this.pool.options.max
      : 10;
  }

  getUtilizationPercent(): number {
    const max = this.getMaxConnections();
    if (max <= 0) return 0;
    const active = this.getActiveConnections();
    return Number(((active / max) * 100).toFixed(2));
  }

  getStats(): PoolStats {
    return {
      totalConnections: this.getTotalConnections(),
      idleConnections: this.getIdleConnections(),
      activeConnections: this.getActiveConnections(),
      waitingRequests: this.getWaitingRequests(),
      maxConnections: this.getMaxConnections(),
      utilizationPercent: this.getUtilizationPercent(),
    };
  }

  /**
   * Instruments connection acquisition duration on pool.connect.
   *
   * TypeORM's PostgresDriver calls `this.master.connect((err, client, release) => ...)`
   * for every query runner acquisition.
   *
   * By intercepting pool.connect at the pool instance level:
   * - Preserves both callback and Promise-style execution.
   * - Accurately records time spent in wait queue + socket handshake.
   * - Prevents duplicate wrapping via an idempotent flag.
   */
  instrumentAcquisition(onAcquire: (durationSeconds: number) => void): boolean {
    if (!this.pool) {
      return false;
    }

    if (this.isInstrumented || this.pool.connect.__metrics_instrumented) {
      return true;
    }

    const pool = this.pool;
    const originalConnect = pool.connect.bind(pool);

    const instrumentedConnect = function (
      cb?: (err: Error, client: unknown, done: () => void) => void,
    ): unknown {
      const startTime = performance.now();

      // Callback style (used by TypeORM PostgresDriver obtainMasterConnection)
      if (typeof cb === 'function') {
        return originalConnect((err: Error, client: unknown, done: () => void) => {
          const durationSeconds = (performance.now() - startTime) / 1000;
          onAcquire(durationSeconds);
          cb(err, client, done);
        });
      }

      // Promise style (used by direct pool.connect() callers)
      const promise = originalConnect() as Promise<unknown>;
      if (promise && typeof promise.then === 'function') {
        return promise.then(
          (client) => {
            const durationSeconds = (performance.now() - startTime) / 1000;
            onAcquire(durationSeconds);
            return client;
          },
          (err) => {
            const durationSeconds = (performance.now() - startTime) / 1000;
            onAcquire(durationSeconds);
            throw err;
          },
        );
      }

      return promise;
    };

    instrumentedConnect.__metrics_instrumented = true;
    pool.connect = instrumentedConnect;
    this.isInstrumented = true;

    this.logger.log('PostgreSQL connection acquisition latency instrumentation enabled.');
    return true;
  }
}
