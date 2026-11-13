import {
  Injectable,
  OnModuleInit,
  OnApplicationBootstrap,
  Optional,
} from '@nestjs/common';
import {
  register,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
  Registry,
} from '@prometheus-io/client';
import * as perfHooks from 'node:perf_hooks';
import { DataSource } from 'typeorm';
import { METRICS_CONSTANTS } from './metrics.constants';
import { DatabasePoolMetricsAdapter } from './database-pool-metrics.adapter';

@Injectable()
export class MetricsService implements OnModuleInit, OnApplicationBootstrap {
  private readonly registry: Registry = register;
  private isInitialized = false;

  public readonly httpRequestDuration: Histogram<string>;
  public readonly httpRequestsTotal: Counter<string>;
  public readonly httpActiveRequests: Gauge<string>;
  public readonly eventLoopLagP95?: Gauge<string>;

  /* ResLab Canonical DB Pool Metrics */
  public readonly nodejsDbPoolTotalConnections: Gauge<string>;
  public readonly nodejsDbPoolActiveConnections: Gauge<string>;
  public readonly nodejsDbPoolIdleConnections: Gauge<string>;
  public readonly nodejsDbPoolWaitingRequests: Gauge<string>;
  public readonly nodejsDbPoolMaxConnections: Gauge<string>;

  /* Auxiliary & Legacy DB Pool Metrics */
  public readonly dbPoolTotalConnections: Gauge<string>;
  public readonly dbPoolIdleConnections: Gauge<string>;
  public readonly dbPoolWaitingRequests: Gauge<string>;
  public readonly dbPoolMaxConnections: Gauge<string>;
  public readonly dbPoolUtilizationPercent: Gauge<string>;
  public readonly dbPoolAcquireDuration: Histogram<string>;

  private eventLoopDelayHistogram?: perfHooks.IntervalHistogram;

  constructor(
    @Optional() private readonly poolAdapter?: DatabasePoolMetricsAdapter,
    @Optional() private readonly dataSource?: DataSource,
  ) {
    // 1. Set default labels matching ResLab service name
    try {
      this.registry.setDefaultLabels({
        service: METRICS_CONSTANTS.SERVICE_NAME,
        app: METRICS_CONSTANTS.SERVICE_NAME,
      });
    } catch {
      // Labels already set
    }

    // 2. HTTP Request Duration Histogram
    this.httpRequestDuration =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.HTTP_REQUEST_DURATION_SECONDS,
      ) as Histogram<string>) ||
      new Histogram({
        name: METRICS_CONSTANTS.HTTP_REQUEST_DURATION_SECONDS,
        help: 'Duration of HTTP requests in seconds',
        labelNames: ['method', 'route', 'status'],
        buckets: [...METRICS_CONSTANTS.HTTP_DURATION_BUCKETS],
        registers: [this.registry],
      });

    // 3. HTTP Requests Total Counter
    this.httpRequestsTotal =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.HTTP_REQUESTS_TOTAL,
      ) as Counter<string>) ||
      new Counter({
        name: METRICS_CONSTANTS.HTTP_REQUESTS_TOTAL,
        help: 'Total number of HTTP requests processed',
        labelNames: ['method', 'route', 'status'],
        registers: [this.registry],
      });

    // 4. In-flight active HTTP requests Gauge
    this.httpActiveRequests =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.HTTP_ACTIVE_REQUESTS,
      ) as Gauge<string>) ||
      new Gauge({
        name: METRICS_CONSTANTS.HTTP_ACTIVE_REQUESTS,
        help: 'Current number of active in-flight HTTP requests',
        labelNames: ['method'],
        registers: [this.registry],
      });

    // 5. P95 Event Loop Delay gauge for Dashboard P95 panel
    if (perfHooks && typeof perfHooks.monitorEventLoopDelay === 'function') {
      try {
        this.eventLoopDelayHistogram = perfHooks.monitorEventLoopDelay({
          resolution: METRICS_CONSTANTS.EVENT_LOOP_MONITORING_PRECISION_MS,
        });
        this.eventLoopDelayHistogram.enable();

        this.eventLoopLagP95 =
          (this.registry.getSingleMetric(
            METRICS_CONSTANTS.EVENT_LOOP_LAG_P95,
          ) as Gauge<string>) ||
          new Gauge({
            name: METRICS_CONSTANTS.EVENT_LOOP_LAG_P95,
            help: 'The 95th percentile of the recorded event loop delays in seconds',
            registers: [this.registry],
            collect: () => {
              if (this.eventLoopDelayHistogram) {
                const p95Seconds =
                  this.eventLoopDelayHistogram.percentile(95) / 1e9;
                this.eventLoopLagP95?.set(p95Seconds);
              }
            },
          });
      } catch {
        // Event loop delay monitoring not supported in current runtime
      }
    }

    const poolLabel = { pool: 'master' };

    // 6. ResLab Canonical Database Connection Pool Metrics (with label { pool: 'master' })
    this.nodejsDbPoolTotalConnections =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.NODEJS_DB_POOL_TOTAL_CONNECTIONS,
      ) as Gauge<string>) ||
      new Gauge({
        name: METRICS_CONSTANTS.NODEJS_DB_POOL_TOTAL_CONNECTIONS,
        help: 'Total number of open database client connections in the application pool',
        labelNames: ['pool'],
        registers: [this.registry],
        collect: () => {
          if (this.poolAdapter?.isAvailable()) {
            this.nodejsDbPoolTotalConnections.set(poolLabel, this.poolAdapter.getTotalConnections());
          }
        },
      });

    this.nodejsDbPoolActiveConnections =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.NODEJS_DB_POOL_ACTIVE_CONNECTIONS,
      ) as Gauge<string>) ||
      new Gauge({
        name: METRICS_CONSTANTS.NODEJS_DB_POOL_ACTIVE_CONNECTIONS,
        help: 'Number of database connections currently active executing queries',
        labelNames: ['pool'],
        registers: [this.registry],
        collect: () => {
          if (this.poolAdapter?.isAvailable()) {
            this.nodejsDbPoolActiveConnections.set(poolLabel, this.poolAdapter.getActiveConnections());
          }
        },
      });

    this.nodejsDbPoolIdleConnections =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.NODEJS_DB_POOL_IDLE_CONNECTIONS,
      ) as Gauge<string>) ||
      new Gauge({
        name: METRICS_CONSTANTS.NODEJS_DB_POOL_IDLE_CONNECTIONS,
        help: 'Number of idle database connections waiting in the application pool',
        labelNames: ['pool'],
        registers: [this.registry],
        collect: () => {
          if (this.poolAdapter?.isAvailable()) {
            this.nodejsDbPoolIdleConnections.set(poolLabel, this.poolAdapter.getIdleConnections());
          }
        },
      });

    this.nodejsDbPoolWaitingRequests =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.NODEJS_DB_POOL_WAITING_REQUESTS,
      ) as Gauge<string>) ||
      new Gauge({
        name: METRICS_CONSTANTS.NODEJS_DB_POOL_WAITING_REQUESTS,
        help: 'Number of asynchronous operations queued waiting for an available database client',
        labelNames: ['pool'],
        registers: [this.registry],
        collect: () => {
          if (this.poolAdapter?.isAvailable()) {
            this.nodejsDbPoolWaitingRequests.set(poolLabel, this.poolAdapter.getWaitingRequests());
          }
        },
      });

    this.nodejsDbPoolMaxConnections =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.NODEJS_DB_POOL_MAX_CONNECTIONS,
      ) as Gauge<string>) ||
      new Gauge({
        name: METRICS_CONSTANTS.NODEJS_DB_POOL_MAX_CONNECTIONS,
        help: 'Configured maximum database client connection pool limit',
        labelNames: ['pool'],
        registers: [this.registry],
        collect: () => {
          if (this.poolAdapter?.isAvailable()) {
            this.nodejsDbPoolMaxConnections.set(poolLabel, this.poolAdapter.getMaxConnections());
          }
        },
      });

    // 7. Legacy Database Pool Metrics (for existing test suites and backward compatibility)
    this.dbPoolTotalConnections =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.DB_POOL_TOTAL_CONNECTIONS,
      ) as Gauge<string>) ||
      new Gauge({
        name: METRICS_CONSTANTS.DB_POOL_TOTAL_CONNECTIONS,
        help: 'Current total number of allocated connections in the PostgreSQL connection pool',
        registers: [this.registry],
        collect: () => {
          if (this.poolAdapter?.isAvailable()) {
            this.dbPoolTotalConnections.set(this.poolAdapter.getTotalConnections());
          }
        },
      });

    this.dbPoolIdleConnections =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.DB_POOL_IDLE_CONNECTIONS,
      ) as Gauge<string>) ||
      new Gauge({
        name: METRICS_CONSTANTS.DB_POOL_IDLE_CONNECTIONS,
        help: 'Available idle connections ready for checkout in the PostgreSQL pool',
        registers: [this.registry],
        collect: () => {
          if (this.poolAdapter?.isAvailable()) {
            this.dbPoolIdleConnections.set(this.poolAdapter.getIdleConnections());
          }
        },
      });

    this.dbPoolWaitingRequests =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.DB_POOL_WAITING_REQUESTS,
      ) as Gauge<string>) ||
      new Gauge({
        name: METRICS_CONSTANTS.DB_POOL_WAITING_REQUESTS,
        help: 'Number of callers waiting for an available PostgreSQL connection in the queue',
        registers: [this.registry],
        collect: () => {
          if (this.poolAdapter?.isAvailable()) {
            this.dbPoolWaitingRequests.set(this.poolAdapter.getWaitingRequests());
          }
        },
      });

    this.dbPoolMaxConnections =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.DB_POOL_MAX_CONNECTIONS,
      ) as Gauge<string>) ||
      new Gauge({
        name: METRICS_CONSTANTS.DB_POOL_MAX_CONNECTIONS,
        help: 'Configured maximum connection pool size',
        registers: [this.registry],
        collect: () => {
          if (this.poolAdapter?.isAvailable()) {
            this.dbPoolMaxConnections.set(this.poolAdapter.getMaxConnections());
          }
        },
      });

    this.dbPoolUtilizationPercent =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.DB_POOL_UTILIZATION_PERCENT,
      ) as Gauge<string>) ||
      new Gauge({
        name: METRICS_CONSTANTS.DB_POOL_UTILIZATION_PERCENT,
        help: 'Current connection pool utilization percentage ((Total - Idle) / Max * 100)',
        registers: [this.registry],
        collect: () => {
          if (this.poolAdapter?.isAvailable()) {
            this.dbPoolUtilizationPercent.set(this.poolAdapter.getUtilizationPercent());
          }
        },
      });

    this.dbPoolAcquireDuration =
      (this.registry.getSingleMetric(
        METRICS_CONSTANTS.DB_POOL_ACQUIRE_DURATION_SECONDS,
      ) as Histogram<string>) ||
      new Histogram({
        name: METRICS_CONSTANTS.DB_POOL_ACQUIRE_DURATION_SECONDS,
        help: 'Time spent acquiring a PostgreSQL connection from the pool in seconds',
        buckets: [...METRICS_CONSTANTS.DB_POOL_ACQUIRE_DURATION_BUCKETS],
        registers: [this.registry],
      });
  }

  onModuleInit(): void {
    if (!this.isInitialized) {
      // Collect default V8, process CPU, memory, GC and handle metrics
      try {
        collectDefaultMetrics({
          register: this.registry,
          prefix: '',
          gcDurationBuckets: [...METRICS_CONSTANTS.GC_DURATION_BUCKETS],
          eventLoopMonitoringPrecision:
            METRICS_CONSTANTS.EVENT_LOOP_MONITORING_PRECISION_MS,
        });
      } catch {
        // Default metrics already initialized
      }
      this.isInitialized = true;
    }

    this.tryBindPool();
  }

  onApplicationBootstrap(): void {
    this.tryBindPool();
  }

  private tryBindPool(): void {
    if (this.poolAdapter && this.dataSource && !this.poolAdapter.isAvailable()) {
      const bound = this.poolAdapter.bindDataSource(this.dataSource);
      if (bound) {
        this.poolAdapter.instrumentAcquisition((durationSeconds) => {
          this.dbPoolAcquireDuration.observe(durationSeconds);
        });
      }
    }
  }

  /**
   * Manually attaches a DataSource (useful in test harnesses or dynamic setups)
   */
  public attachDataSource(dataSource: DataSource): boolean {
    if (this.poolAdapter) {
      const bound = this.poolAdapter.bindDataSource(dataSource);
      if (bound) {
        this.poolAdapter.instrumentAcquisition((durationSeconds) => {
          this.dbPoolAcquireDuration.observe(durationSeconds);
        });
      }
      return bound;
    }
    return false;
  }

  /**
   * Records completed HTTP request duration and increment total counter
   */
  recordHttpRequest(
    method: string,
    route: string,
    status: string,
    durationSeconds: number,
  ): void {
    const labels = { method, route, status };
    this.httpRequestsTotal.inc(labels);
    this.httpRequestDuration.observe(labels, durationSeconds);
  }

  /**
   * Tracks active request entering server
   */
  incrementActiveRequests(method: string): void {
    this.httpActiveRequests.inc({ method });
  }

  /**
   * Decrements active request when response finishes
   */
  decrementActiveRequests(method: string): void {
    this.httpActiveRequests.dec({ method });
  }

  /**
   * Serializes all metrics in Prometheus text format
   */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  /**
   * Content type string for response header
   */
  getContentType(): string {
    return this.registry.contentType;
  }

  /**
   * Expose registry for advanced usage
   */
  getRegistry(): Registry {
    return this.registry;
  }
}
