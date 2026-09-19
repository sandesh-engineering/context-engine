import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from './env.validation';

/**
 * Typed wrapper around NestJS ConfigService.
 * Inject this instead of raw ConfigService to get full type safety.
 *
 * @example
 * constructor(private readonly appConfig: AppConfigService) {}
 * const port = this.appConfig.port; // number — no casting needed
 */
@Injectable()
export class AppConfigService {
  constructor(private readonly config: ConfigService<Env, true>) { }

  get port(): number {
    return this.config.get('PORT', { infer: true });
  }

  get nodeEnv(): Env['NODE_ENV'] {
    return this.config.get('NODE_ENV', { infer: true });
  }

  get corsOrigin(): string {
    return this.config.get('CORS_ORIGIN', { infer: true });
  }

  get isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  get isDevelopment(): boolean {
    return this.nodeEnv === 'development';
  }

  get otelServiceName(): string {
    return this.config.get('OTEL_ATTR_SERVICE_NAME', { infer: true }) ?? 'Knowledge_Engine';
  }

  get otelServiceVersion(): string {
    return this.config.get('OTEL_ATTR_SERVICE_VERSION', { infer: true }) ?? '1.0';
  }

  get otelExporterEndpoint(): string {
    return this.config.get('OTEL_EXPORTER_OTLP_ENDPOINT', { infer: true }) ?? 'http://localhost:4317';
  }

  get otelSamplingRatio(): number {
    return this.config.get('OTEL_SAMPLING_RATIO', { infer: true }) ?? 1;
  }

  get workerEnabled(): boolean {
    return this.config.get('WORKER_ENABLED', { infer: true }) ?? false;
  }

  get sqsIngestionQueueUrl(): string {
    return (
      this.config.get('SQS_INGESTION_QUEUE_URL', { infer: true }) ??
      'http://localhost:4566/000000000000/knowledge-engine-ingestion-queue'
    );
  }

  get sqsEmbeddingQueueUrl(): string {
    return (
      this.config.get('SQS_EMBEDDING_QUEUE_URL', { infer: true }) ??
      'http://localhost:4566/000000000000/knowledge-engine-embedding-queue'
    );
  }

  get sqsPollWaitTimeSeconds(): number {
    return this.config.get('SQS_POLL_WAIT_TIME_SECONDS', { infer: true }) ?? 20;
  }

  get sqsMaxNumberOfMessages(): number {
    return this.config.get('SQS_MAX_NUMBER_OF_MESSAGES', { infer: true }) ?? 10;
  }

  get sqsVisibilityTimeoutSeconds(): number {
    return this.config.get('SQS_VISIBILITY_TIMEOUT_SECONDS', { infer: true }) ?? 300;
  }

  get sqsPollerConcurrency(): number {
    return this.config.get('SQS_POLLER_CONCURRENCY', { infer: true }) ?? 1;
  }

  get documentTempDir(): string {
    return this.config.get('DOCUMENT_TEMP_DIR', { infer: true }) ?? './tmp/documents';
  }

  get documentMaxSizeBytes(): number {
    return this.config.get('DOCUMENT_MAX_SIZE_BYTES', { infer: true }) ?? 104857600;
  }

  get documentTempDiskLimitBytes(): number {
    return this.config.get('DOCUMENT_TEMP_DISK_LIMIT_BYTES', { infer: true }) ?? 5368709120;
  }

  get ollamaBaseUrl(): string {
    return this.config.get('OLLAMA_BASE_URL', { infer: true }) ?? 'http://localhost:11434';
  }

  get ollamaEmbeddingModel(): string {
    return this.config.get('OLLAMA_EMBEDDING_MODEL', { infer: true }) ?? 'embeddinggemma';
  }

  get embeddingDimensions(): number {
    return this.config.get('EMBEDDING_DIMENSIONS', { infer: true }) ?? 768;
  }

  get embeddingBatchSize(): number {
    return this.config.get('EMBEDDING_BATCH_SIZE', { infer: true }) ?? 20;
  }

  get circuitBreakerFailureThreshold(): number {
    return this.config.get('CIRCUIT_BREAKER_FAILURE_THRESHOLD', { infer: true }) ?? 5;
  }

  get circuitBreakerResetTimeoutMs(): number {
    return this.config.get('CIRCUIT_BREAKER_RESET_TIMEOUT_MS', { infer: true }) ?? 30000;
  }
}
