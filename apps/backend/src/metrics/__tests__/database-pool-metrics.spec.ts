import { Test, TestingModule } from '@nestjs/testing';
import { DatabasePoolMetricsAdapter } from '../database-pool-metrics.adapter';
import { MetricsService } from '../metrics.service';
import { METRICS_CONSTANTS } from '../metrics.constants';

describe('DatabasePoolMetricsAdapter & Metrics Integration', () => {
  let adapter: DatabasePoolMetricsAdapter;
  let metricsService: MetricsService;
  let mockPool: any;
  let mockDataSource: any;

  beforeEach(async () => {
    mockPool = {
      totalCount: 8,
      idleCount: 3,
      waitingCount: 5,
      options: { max: 10 },
      connect: jest.fn((cb) => {
        if (typeof cb === 'function') {
          return cb(null, { id: 'mock-client' }, jest.fn());
        }
        return Promise.resolve({ id: 'mock-client' });
      }),
    };

    mockDataSource = {
      isInitialized: true,
      driver: {
        master: mockPool,
        pool: mockPool,
      },
    };

    adapter = new DatabasePoolMetricsAdapter();
    adapter.bindDataSource(mockDataSource as any);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MetricsService,
        { provide: DatabasePoolMetricsAdapter, useValue: adapter },
      ],
    }).compile();

    metricsService = module.get<MetricsService>(MetricsService);
    metricsService.onModuleInit();
  });

  describe('Pool Metrics Extraction', () => {
    it('should extract correct connection counts and calculate active/utilization', () => {
      const stats = adapter.getStats();

      expect(stats.totalConnections).toBe(8);
      expect(stats.idleConnections).toBe(3);
      expect(stats.activeConnections).toBe(5); // 8 - 3
      expect(stats.waitingRequests).toBe(5);
      expect(stats.maxConnections).toBe(10);
      expect(stats.utilizationPercent).toBe(50); // (5 / 10) * 100
    });

    it('should gracefully handle uninitialized or missing DataSource', () => {
      const emptyAdapter = new DatabasePoolMetricsAdapter();
      expect(emptyAdapter.isAvailable()).toBe(false);
      expect(emptyAdapter.getTotalConnections()).toBe(0);
      expect(emptyAdapter.getIdleConnections()).toBe(0);
      expect(emptyAdapter.getActiveConnections()).toBe(0);
      expect(emptyAdapter.getWaitingRequests()).toBe(0);
      expect(emptyAdapter.getMaxConnections()).toBe(10);
      expect(emptyAdapter.getUtilizationPercent()).toBe(0);
    });
  });

  describe('Connection Acquisition Latency Instrumentation', () => {
    it('should instrument pool.connect and record acquisition duration with callback style', (done) => {
      const recordedDurations: number[] = [];
      adapter.instrumentAcquisition((dur) => {
        recordedDurations.push(dur);
      });

      mockPool.connect((err: any, client: any) => {
        expect(err).toBeNull();
        expect(client.id).toBe('mock-client');
        expect(recordedDurations.length).toBe(1);
        expect(recordedDurations[0]).toBeGreaterThanOrEqual(0);
        done();
      });
    });

    it('should instrument pool.connect and record acquisition duration with Promise style', async () => {
      const recordedDurations: number[] = [];
      adapter.instrumentAcquisition((dur) => {
        recordedDurations.push(dur);
      });

      mockPool.connect = jest.fn(() => Promise.resolve({ id: 'promise-client' }));
      // Re-instrument to wrap new mock
      adapter['isInstrumented'] = false;
      adapter.instrumentAcquisition((dur) => {
        recordedDurations.push(dur);
      });

      const client = await mockPool.connect();
      expect(client.id).toBe('promise-client');
      expect(recordedDurations.length).toBe(1);
      expect(recordedDurations[0]).toBeGreaterThanOrEqual(0);
    });

    it('should not wrap pool.connect multiple times (idempotent)', () => {
      expect(adapter.instrumentAcquisition(jest.fn())).toBe(true);
      const originalInstrumented = mockPool.connect;
      expect(adapter.instrumentAcquisition(jest.fn())).toBe(true);
      expect(mockPool.connect).toBe(originalInstrumented);
    });
  });

  describe('Prometheus Metrics Serialization', () => {
    it('should serialize db_pool metrics in Prometheus text format', async () => {
      metricsService.attachDataSource(mockDataSource as any);

      const metrics = await metricsService.getMetrics();

      expect(metrics).toContain(METRICS_CONSTANTS.DB_POOL_TOTAL_CONNECTIONS);
      expect(metrics).toContain(METRICS_CONSTANTS.DB_POOL_IDLE_CONNECTIONS);
      expect(metrics).toContain(METRICS_CONSTANTS.DB_POOL_WAITING_REQUESTS);
      expect(metrics).toContain(METRICS_CONSTANTS.DB_POOL_MAX_CONNECTIONS);
      expect(metrics).toContain(METRICS_CONSTANTS.DB_POOL_UTILIZATION_PERCENT);
      expect(metrics).toContain(METRICS_CONSTANTS.DB_POOL_ACQUIRE_DURATION_SECONDS);

      // ResLab Canonical Metrics
      expect(metrics).toContain(METRICS_CONSTANTS.NODEJS_DB_POOL_TOTAL_CONNECTIONS);
      expect(metrics).toContain(METRICS_CONSTANTS.NODEJS_DB_POOL_ACTIVE_CONNECTIONS);
      expect(metrics).toContain(METRICS_CONSTANTS.NODEJS_DB_POOL_IDLE_CONNECTIONS);
      expect(metrics).toContain(METRICS_CONSTANTS.NODEJS_DB_POOL_WAITING_REQUESTS);
      expect(metrics).toContain(METRICS_CONSTANTS.NODEJS_DB_POOL_MAX_CONNECTIONS);

      expect(metrics).toMatch(/nodejs_db_pool_total_connections\{[^}]*pool="master"[^}]*\}\s+8/);
      expect(metrics).toMatch(/nodejs_db_pool_active_connections\{[^}]*pool="master"[^}]*\}\s+5/);
      expect(metrics).toMatch(/nodejs_db_pool_idle_connections\{[^}]*pool="master"[^}]*\}\s+3/);
      expect(metrics).toMatch(/nodejs_db_pool_waiting_requests\{[^}]*pool="master"[^}]*\}\s+5/);
      expect(metrics).toMatch(/nodejs_db_pool_max_connections\{[^}]*pool="master"[^}]*\}\s+10/);

      expect(metrics).toMatch(/db_pool_total_connections(\{[^}]*\})?\s+8/);
      expect(metrics).toMatch(/db_pool_idle_connections(\{[^}]*\})?\s+3/);
      expect(metrics).toMatch(/db_pool_waiting_requests(\{[^}]*\})?\s+5/);
      expect(metrics).toMatch(/db_pool_max_connections(\{[^}]*\})?\s+10/);
      expect(metrics).toMatch(/db_pool_utilization_percent(\{[^}]*\})?\s+50/);
    });
  });
});
