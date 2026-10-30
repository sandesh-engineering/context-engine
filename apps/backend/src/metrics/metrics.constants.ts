export const METRICS_CONSTANTS = {
  SERVICE_NAME: 'knowledge-engine-app',
  HTTP_REQUESTS_TOTAL: 'http_requests_total',
  HTTP_REQUEST_DURATION_SECONDS: 'http_request_duration_seconds',
  HTTP_ACTIVE_REQUESTS: 'http_active_requests',
  EVENT_LOOP_LAG_P95: 'nodejs_eventloop_lag_p95_seconds',
  HTTP_DURATION_BUCKETS: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  GC_DURATION_BUCKETS: [0.001, 0.01, 0.1, 1, 2],
  EVENT_LOOP_MONITORING_PRECISION_MS: 10,
  DB_POOL_TOTAL_CONNECTIONS: 'db_pool_total_connections',
  DB_POOL_IDLE_CONNECTIONS: 'db_pool_idle_connections',
  DB_POOL_WAITING_REQUESTS: 'db_pool_waiting_requests',
  DB_POOL_MAX_CONNECTIONS: 'db_pool_max_connections',
  DB_POOL_UTILIZATION_PERCENT: 'db_pool_utilization_percent',
  DB_POOL_ACQUIRE_DURATION_SECONDS: 'db_pool_connection_acquire_duration_seconds',
  DB_POOL_ACQUIRE_DURATION_BUCKETS: [
    0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5,
  ],
} as const;
