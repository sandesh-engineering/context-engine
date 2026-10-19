import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  IQwenRerankerProvider,
  RerankCandidate,
  RerankOptions,
  RerankResponse,
  RerankResultItem,
} from '../interfaces/reranker-provider.interface';
import { CircuitBreaker } from '../../ingestion/resilience/circuit-breaker';

export interface HttpQwenRerankerProviderOptions {
  baseUrl?: string;
  endpointPath?: string;
  modelName?: string;
  timeoutMs?: number;
  circuitBreaker?: CircuitBreaker;
  fetchFn?: typeof fetch;
}

interface RawRerankItem {
  index: number;
  relevance_score?: number;
  score?: number;
}

interface RawRerankPayload {
  results?: RawRerankItem[];
  data?: RawRerankItem[];
}

@Injectable()
export class HttpQwenRerankerProvider implements IQwenRerankerProvider {
  private readonly logger = new Logger(HttpQwenRerankerProvider.name);
  private readonly baseUrl: string;
  private readonly endpointPath: string;
  private readonly modelName: string;
  private readonly timeoutMs: number;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly fetchFn: typeof fetch;

  constructor(
    private readonly appConfig: AppConfigService,
    @Optional() options?: HttpQwenRerankerProviderOptions,
  ) {
    this.baseUrl =
      options?.baseUrl ||
      this.appConfig.rerankerBaseUrl ||
      'http://localhost:11434';

    this.endpointPath =
      options?.endpointPath ||
      this.appConfig.rerankerEndpointPath ||
      '/api/rerank';

    this.modelName =
      options?.modelName ||
      this.appConfig.rerankerModelName ||
      'qwen3-reranker';

    this.timeoutMs =
      options?.timeoutMs ||
      this.appConfig.rerankerTimeoutMs ||
      5000;

    this.circuitBreaker =
      options?.circuitBreaker ||
      new CircuitBreaker({
        name: 'HttpQwenRerankerProvider',
        failureThreshold: this.appConfig.circuitBreakerFailureThreshold || 5,
        resetTimeoutMs: this.appConfig.circuitBreakerResetTimeoutMs || 30000,
      });

    this.fetchFn = options?.fetchFn || globalThis.fetch.bind(globalThis);
  }

  /**
   * Submits query and candidate chunk passages to neural cross-encoder model service.
   *
   * @param {string} query - User input question
   * @param {RerankCandidate[]} candidates - Unranked candidate document passages
   * @param {RerankOptions} [options] - Execution options including cancellation signal
   * @returns {Promise<RerankResponse>} Scored results mapped back to chunk entity IDs
   */
  async rerank(
    query: string,
    candidates: RerankCandidate[],
    options?: RerankOptions,
  ): Promise<RerankResponse> {
    if (!candidates || candidates.length === 0) {
      return {
        results: [],
        modelName: this.modelName,
        durationMs: 0,
      };
    }

    return this.circuitBreaker.execute(async () => {
      const startTime = Date.now();
      const endpoint = `${this.baseUrl.replace(/\/$/, '')}${
        this.endpointPath.startsWith('/') ? this.endpointPath : `/${this.endpointPath}`
      }`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      /* Forward external abort signal if provided */
      if (options?.signal) {
        options.signal.addEventListener('abort', () => controller.abort(), { once: true });
      }

      try {
        const payload = {
          model: this.modelName,
          query,
          documents: candidates.map((c) => c.content),
        };

        const response = await this.fetchFn(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        if (!response.ok) {
          const errorText = await response.text();
          const err = new Error(
            `Reranker HTTP error ${response.status} from ${endpoint}: ${errorText}`,
          );
          (err as any).statusCode = response.status;
          throw err;
        }

        const body = (await response.json()) as RawRerankPayload;
        const rawResults = body?.results || body?.data;

        if (!rawResults || !Array.isArray(rawResults)) {
          const malformedErr = new Error(
            'Reranker service returned malformed response: Missing results array',
          );
          (malformedErr as any).code = 'MALFORMED_RESPONSE';
          throw malformedErr;
        }

        const mappedResults: RerankResultItem[] = rawResults.map((item) => {
          if (
            typeof item.index !== 'number' ||
            item.index < 0 ||
            item.index >= candidates.length
          ) {
            throw new Error(
              `Reranker returned invalid candidate index '${item.index}'. Candidates bounds: [0, ${
                candidates.length - 1
              }]`,
            );
          }

          const candidate = candidates[item.index];
          if (!candidate) {
            throw new Error(`Unable to locate candidate chunk at index '${item.index}'`);
          }

          const score = item.relevance_score ?? item.score;
          if (typeof score !== 'number' || isNaN(score)) {
            throw new Error(`Invalid relevance score for candidate chunk '${candidate.id}'`);
          }

          return {
            id: candidate.id,
            index: item.index,
            relevanceScore: score,
          };
        });

        const durationMs = Date.now() - startTime;

        return {
          results: mappedResults,
          modelName: this.modelName,
          durationMs,
        };
      } catch (error: any) {
        if (error.name === 'AbortError') {
          const timeoutErr = new Error(
            `Reranker request to ${endpoint} timed out after ${this.timeoutMs}ms`,
          );
          (timeoutErr as any).code = 'TIMEOUT';
          this.logger.warn(timeoutErr.message);
          throw timeoutErr;
        }

        this.logger.error(`Reranker invocation failed: ${error.message}`, {
          endpoint,
          modelName: this.modelName,
          candidateCount: candidates.length,
          error: error.message,
        });
        throw error;
      } finally {
        clearTimeout(timer);
      }
    });
  }
}
