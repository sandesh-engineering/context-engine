import { z } from 'zod';

export const envSchema = z.object({
  PORT: z.coerce.number().default(5000),
  NODE_ENV: z
    .enum(['development', 'production', 'test', 'provision'])
    .default('development'),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),

  OTEL_ATTR_SERVICE_VERSION: z
    .string()
    .optional()
    .or(z.literal(''))
    .default('1.0'),
  OTEL_ATTR_SERVICE_NAME: z
    .string()
    .optional()
    .or(z.literal(''))
    .default('Knowledge_Engine'),
  OTEL_EXPORTER_OTLP_ENDPOINT: z
    .string()
    .url()
    .optional()
    .or(z.literal(''))
    .default('http://localhost:4317'),
  OTEL_SAMPLING_RATIO: z.coerce.number().min(0).max(1).optional().default(1),

  WORKER_ENABLED: z
    .preprocess((val) => val === 'true' || val === true, z.boolean())
    .default(false),
  SQS_INGESTION_QUEUE_URL: z
    .string()
    .optional()
    .default('http://localhost:4566/000000000000/knowledge-engine-ingestion-queue'),
  SQS_EMBEDDING_QUEUE_URL: z
    .string()
    .optional()
    .default('http://localhost:4566/000000000000/knowledge-engine-embedding-queue'),
  SQS_POLL_WAIT_TIME_SECONDS: z.coerce.number().min(0).max(20).default(20),
  SQS_MAX_NUMBER_OF_MESSAGES: z.coerce.number().min(1).max(10).default(10),
  SQS_VISIBILITY_TIMEOUT_SECONDS: z.coerce.number().min(0).default(300),
  SQS_POLLER_CONCURRENCY: z.coerce.number().min(1).default(1),

  DOCUMENT_TEMP_DIR: z.string().default('./tmp/documents'),
  DOCUMENT_MAX_SIZE_BYTES: z.coerce.number().default(104857600),
  DOCUMENT_TEMP_DISK_LIMIT_BYTES: z.coerce.number().default(5368709120),

  OLLAMA_BASE_URL: z.string().default('http://localhost:11434'),
  OLLAMA_EMBEDDING_MODEL: z.string().default('embeddinggemma'),
  EMBEDDING_DIMENSIONS: z.coerce.number().default(768),
  EMBEDDING_BATCH_SIZE: z.coerce.number().default(20),

  CIRCUIT_BREAKER_FAILURE_THRESHOLD: z.coerce.number().default(5),
  CIRCUIT_BREAKER_RESET_TIMEOUT_MS: z.coerce.number().default(30000),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): Env {
  const result = envSchema.safeParse(config);

  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    throw new Error('Environment validation failed');
  }

  return result.data;
}