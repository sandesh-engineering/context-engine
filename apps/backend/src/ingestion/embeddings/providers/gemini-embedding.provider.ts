import { Injectable, Logger, Optional } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { AppConfigService } from '../../../config/app-config.service';
import {
  IEmbeddingProvider,
  EmbeddingRequest,
  EmbeddingResponse,
  EmbeddingOptions,
} from '../interfaces/embedding-provider.interface';
import { CircuitBreaker } from '../../resilience/circuit-breaker';
import { RetryPolicy } from '../../resilience/retry-policy';

export interface GeminiEmbeddingProviderOptions {
  apiKey?: string;
  modelName?: string;
  dimensions?: number;
  circuitBreaker?: CircuitBreaker;
  retryPolicy?: RetryPolicy;
  genAiClient?: GoogleGenAI;
}

@Injectable()
export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  private readonly logger = new Logger(GeminiEmbeddingProvider.name);
  private readonly apiKey?: string;
  private readonly modelName: string;
  private readonly dimensions: number;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryPolicy: RetryPolicy;
  private readonly aiClient: GoogleGenAI;

  constructor(
    private readonly appConfig: AppConfigService,
    @Optional() options?: GeminiEmbeddingProviderOptions,
  ) {
    this.apiKey = options?.apiKey || this.appConfig.geminiApiKey || process.env.GEMINI_API_KEY;
    this.modelName =
      options?.modelName ||
      this.appConfig.geminiEmbeddingModel ||
      'text-embedding-004';

    this.dimensions =
      options?.dimensions ||
      this.appConfig.embeddingDimensions ||
      768;

    this.circuitBreaker =
      options?.circuitBreaker ||
      new CircuitBreaker({
        name: 'GeminiEmbeddingProvider',
        failureThreshold: this.appConfig.circuitBreakerFailureThreshold || 5,
        resetTimeoutMs: this.appConfig.circuitBreakerResetTimeoutMs || 30000,
      });

    this.retryPolicy =
      options?.retryPolicy ||
      new RetryPolicy({
        maxAttempts: 3,
        initialDelayMs: 300,
        maxDelayMs: 3000,
      });

    this.aiClient =
      options?.genAiClient ||
      new GoogleGenAI(this.apiKey ? { apiKey: this.apiKey } : {});
  }

  /**
   * Generates dense vector embeddings using Google Gemini GenAI SDK models (e.g. text-embedding-004).
   *
   * @param {EmbeddingRequest} request - Texts to embed
   * @param {EmbeddingOptions} [options] - Optional execution options (e.g. AbortSignal)
   * @returns {Promise<EmbeddingResponse>} Generated vector matrix and metadata
   */
  async generateEmbeddings(
    request: EmbeddingRequest,
    options?: EmbeddingOptions,
  ): Promise<EmbeddingResponse> {
    if (!request.texts || request.texts.length === 0) {
      return {
        embeddings: [],
        modelName: this.modelName,
        dimensions: this.dimensions,
      };
    }

    if (options?.signal?.aborted) {
      throw new Error('Embedding generation request aborted');
    }

    return this.circuitBreaker.execute(async () =>
      this.retryPolicy.execute(async () => this.callGeminiEmbedApi(request.texts)),
    );
  }

  private async callGeminiEmbedApi(texts: string[]): Promise<EmbeddingResponse> {
    try {
      const response = await this.aiClient.models.embedContent({
        model: this.modelName,
        contents: texts,
      });

      let vectorMatrix: number[][] = [];

      if (response && Array.isArray((response as any).embeddings)) {
        vectorMatrix = (response as any).embeddings.map((item: any) =>
          Array.isArray(item) ? item : item?.values || [],
        );
      } else if (response && (response as any).embedding) {
        const single = (response as any).embedding?.values || (response as any).embedding;
        vectorMatrix = [single];
      }

      const dimensions = vectorMatrix[0]?.length || this.dimensions;

      return {
        embeddings: vectorMatrix,
        modelName: this.modelName,
        dimensions,
      };
    } catch (error) {
      this.logger.error('Failed to generate embeddings from Google Gemini API', {
        modelName: this.modelName,
        batchSize: texts.length,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
