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
}
