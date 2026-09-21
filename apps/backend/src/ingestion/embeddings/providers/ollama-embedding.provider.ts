import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfigService } from '../../../config/app-config.service';
import {
  IEmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse,
} from '../interfaces/embedding-provider.interface';
import { RetryPolicy } from '../../resilience/retry-policy';
import { CircuitBreaker } from '../../resilience/circuit-breaker';

export interface OllamaProviderOptions {
  baseUrl?: string;
  modelName?: string;
  dimensions?: number;
  circuitBreaker?: CircuitBreaker;
  retryPolicy?: RetryPolicy;
}

@Injectable()
export class OllamaEmbeddingProvider implements IEmbeddingProvider {
  private readonly logger = new Logger(OllamaEmbeddingProvider.name);
  private readonly baseUrl: string;
  private readonly modelName: string;
  private readonly dimensions: number;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryPolicy: RetryPolicy;

  constructor(
    private readonly appConfig: AppConfigService,
    @Optional() options?: OllamaProviderOptions,
  ) {
    this.baseUrl =
      options?.baseUrl ||
      this.appConfig.ollamaBaseUrl ||
      'http://localhost:11434';

    this.modelName =
      options?.modelName ||
      this.appConfig.ollamaEmbeddingModel ||
      'embeddinggemma';

    this.dimensions =
      options?.dimensions ||
      this.appConfig.embeddingDimensions ||
      768;

    this.circuitBreaker =
      options?.circuitBreaker ||
      new CircuitBreaker({
        name: 'OllamaEmbeddingProvider',
        failureThreshold: this.appConfig.circuitBreakerFailureThreshold,
        resetTimeoutMs: this.appConfig.circuitBreakerResetTimeoutMs,
      });

    this.retryPolicy =
      options?.retryPolicy ||
      new RetryPolicy({
        maxAttempts: 3,
        initialDelayMs: 300,
        maxDelayMs: 3000,
      });
  }

  /**
   * Generates 768-dimensional vector embeddings using local Ollama model (embeddinggemma).
   *
   * @remarks
   * - Protected by `CircuitBreaker` and `RetryPolicy` for resilient failure handling.
   * - Posts array inputs to local Ollama `/api/embed` HTTP endpoint.
   *
   * @param {EmbeddingRequest} request - Array of text strings to embed
   * @returns {Promise<EmbeddingResponse>} Vector matrix and metadata
   */
  /**
   * Generates 768-dimensional vector embeddings using local Ollama model (embeddinggemma).
   *
   * @remarks
   * - Protected by `CircuitBreaker` and `RetryPolicy` for resilient failure handling.
   * - Respects `AbortSignal` to cancel HTTP request if parent execution is aborted.
   *
   * @param {EmbeddingRequest} request - Array of text strings to embed
   * @param {EmbeddingOptions} [options] - Optional execution options (e.g. AbortSignal)
   * @returns {Promise<EmbeddingResponse>} Vector matrix and metadata
   */
  async generateEmbeddings(
    request: EmbeddingRequest,
    options?: { signal?: AbortSignal },
  ): Promise<EmbeddingResponse> {
    if (!request.texts || request.texts.length === 0) {
      return {
        embeddings: [],
        modelName: this.modelName,
        dimensions: this.dimensions,
      };
    }

    return this.circuitBreaker.execute(async () =>
      this.retryPolicy.execute(async () => this.callOllamaApi(request.texts, options?.signal)),
    );
  }

  /**
   * Internal HTTP invocation sending embedding batch to local Ollama server.
   */
  private async callOllamaApi(texts: string[], signal?: AbortSignal): Promise<EmbeddingResponse> {
    const embedUrl = `${this.baseUrl.replace(/\/$/, '')}/api/embed`;

    try {
      const response = await fetch(embedUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: this.modelName,
          input: texts,
        }),
        signal,
      });

      if (!response.ok) {
        /* If /api/embed batch endpoint fails or is unsupported, fallback to single /api/embeddings loop */
        if (response.status === 404) {
          return this.fallbackSingleEmbeddings(texts, signal);
        }
        const errorText = await response.text();
        const err = new Error(
          `Ollama API returned HTTP ${response.status}: ${errorText}`,
        );
        (err as any).statusCode = response.status;
        throw err;
      }

      const body = (await response.json()) as { embeddings?: number[][] };

      if (!body.embeddings || !Array.isArray(body.embeddings)) {
        const formatErr = new Error(
          'Ollama API returned invalid response format: Missing embeddings array',
        );
        (formatErr as any).code = 'PERMANENT';
        throw formatErr;
      }

      return {
        embeddings: body.embeddings,
        modelName: this.modelName,
        dimensions: body.embeddings[0]?.length || this.dimensions,
      };
    } catch (error) {
      this.logger.error('Failed to generate embeddings from local Ollama service', {
        baseUrl: this.baseUrl,
        modelName: this.modelName,
        batchSize: texts.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Fallback implementation using single item /api/embeddings requests if batch endpoint is unavailable.
   */
  private async fallbackSingleEmbeddings(
    texts: string[],
    signal?: AbortSignal,
  ): Promise<EmbeddingResponse> {
    const singleUrl = `${this.baseUrl.replace(/\/$/, '')}/api/embeddings`;
    const embeddings: number[][] = [];

    for (const text of texts) {
      const response = await fetch(singleUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.modelName, prompt: text }),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`Ollama single embedding HTTP ${response.status}: ${errorText}`);
        (err as any).statusCode = response.status;
        throw err;
      }

      const body = (await response.json()) as { embedding?: number[] };
      if (!body.embedding) {
        throw new Error('Ollama single embedding missing vector array');
      }
      embeddings.push(body.embedding);
    }

    return {
      embeddings,
      modelName: this.modelName,
      dimensions: embeddings[0]?.length || this.dimensions,
    };
  }
}
