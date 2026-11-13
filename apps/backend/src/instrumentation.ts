import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-grpc';
import {
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';

import { loadEnvFiles } from './config/env-loader';
import { envSchema } from './config/env.validation';

/**
 * instrumentation.ts is intentionally standalone — it must initialise the
 * OpenTelemetry SDK *before* NestJS boots, so the DI container does not exist
 * yet. loadEnvFiles() + envSchema.parse() gives us the same validated, typed values
 * that AppConfigService would provide inside the app.
 */
loadEnvFiles();

const env = envSchema.parse(process.env);

export const sdk = new NodeSDK({
  resource: resourceFromAttributes({
    [ATTR_SERVICE_NAME]: env.OTEL_ATTR_SERVICE_NAME,
    [ATTR_SERVICE_VERSION]: env.OTEL_ATTR_SERVICE_VERSION,
  }),

  traceExporter: new OTLPTraceExporter({
    url: env.OTEL_EXPORTER_OTLP_ENDPOINT,
  }),

  sampler: new ParentBasedSampler({
    root: new TraceIdRatioBasedSampler(env.OTEL_SAMPLING_RATIO),
  }),

  instrumentations: [getNodeAutoInstrumentations()],
});

/* Shutdown (sdk.shutdown) is driven by registerGracefulShutdown in common/shutdown.ts */
