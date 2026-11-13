import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  IRerankerProvider,
  RerankCandidate,
  RerankOptions,
  RerankResponse,
  RerankResultItem,
  TeiRerankRequest,
  TeiRerankResponseItem,
} from '../interfaces/reranker-provider.interface';
import { CircuitBreaker } from '../../ingestion/resilience/circuit-breaker';

export interface HttpTeiRerankerProviderOptions {
  baseUrl?: string;
  endpointPath?: string;
  modelName?: string;
  timeoutMs?: number;
  circuitBreaker?: CircuitBreaker;
  fetchFn?: typeof fetch;
  truncate?: boolean;
}

@Injectable()
export class HttpTeiRerankerProvider implements IRerankerProvider {
  private readonly logger = new Logger(HttpTeiRerankerProvider.name);
  private readonly baseUrl: string;
  private readonly endpointPath: string;
  private readonly modelName: string;
  private readonly timeoutMs: number;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly fetchFn: typeof fetch;
  private readonly truncate: boolean;

  constructor(
    private readonly appConfig: AppConfigService,
    @Optional() options?: HttpTeiRerankerProviderOptions,
  ) {
    this.baseUrl =
      options?.baseUrl ||
      this.appConfig.rerankerBaseUrl ||
      'http://localhost:8081';

    this.endpointPath =
      options?.endpointPath ||
      this.appConfig.rerankerEndpointPath ||
      '/rerank';

    this.modelName =
      options?.modelName ||
      this.appConfig.rerankerModelName ||
      'cross-encoder/ms-marco-MiniLM-L-6-v2';

    this.timeoutMs =
      options?.timeoutMs ||
      this.appConfig.rerankerTimeoutMs ||
      15000;

    this.circuitBreaker =
      options?.circuitBreaker ||
      new CircuitBreaker({
        name: 'HttpTeiRerankerProvider',
        failureThreshold: this.appConfig.circuitBreakerFailureThreshold || 5,
        resetTimeoutMs: this.appConfig.circuitBreakerResetTimeoutMs || 30000,
      });

    this.fetchFn = options?.fetchFn || globalThis.fetch.bind(globalThis);
    this.truncate = options?.truncate ?? true;
  }

  /**
   * Submits query and candidate chunks to Hugging Face Text Embeddings Inference /rerank endpoint.
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
        if (options.signal.aborted) {
          controller.abort(options.signal.reason);
        } else {
          options.signal.addEventListener(
            'abort',
            () => controller.abort(options.signal?.reason),
            { once: true },
          );
        }
      }

      try {
        const payload: TeiRerankRequest = {
          query,
          texts: candidates.map((c) => c.content),
          truncate: this.truncate,
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
            `TEI reranker HTTP error ${response.status} from ${endpoint}: ${errorText}`,
          );
          (err as { statusCode?: number }).statusCode = response.status;
          throw err;
        }

        const body: unknown = await response.json();
        const rawResults: unknown = Array.isArray(body)
          ? body
          : (body as { results?: unknown; data?: unknown })?.results ??
            (body as { results?: unknown; data?: unknown })?.data;

        if (!Array.isArray(rawResults)) {
          const malformedErr = new Error(
            'TEI reranker service returned malformed response: Missing results array',
          );
          (malformedErr as { code?: string }).code = 'MALFORMED_RESPONSE';
          throw malformedErr;
        }

        const seenIndices = new Set<number>();
        const mappedResults: RerankResultItem[] = [];

        for (const item of rawResults as Partial<TeiRerankResponseItem & { relevance_score?: number }>[]) {
          if (
            typeof item?.index !== 'number' ||
            !Number.isInteger(item.index) ||
            item.index < 0 ||
            item.index >= candidates.length
          ) {
            throw new Error(
              `TEI reranker returned invalid candidate index '${item?.index}'. Candidates bounds: [0, ${
                candidates.length - 1
              }]`,
            );
          }

          if (seenIndices.has(item.index)) {
            throw new Error(`TEI reranker returned duplicate candidate index '${item.index}'`);
          }
          seenIndices.add(item.index);

          const candidate = candidates[item.index];
          if (!candidate) {
            throw new Error(`Unable to locate candidate chunk at index '${item.index}'`);
          }

          const score = item.score ?? item.relevance_score;
          if (typeof score !== 'number' || !Number.isFinite(score)) {
            throw new Error(
              `Invalid relevance score '${score}' for candidate chunk '${candidate.id}'. Expected finite number.`,
            );
          }

          mappedResults.push({
            id: candidate.id,
            index: item.index,
            relevanceScore: score,
          });
        }

        // Validate that all candidates have been scored (no missing indices)
        if (seenIndices.size !== candidates.length) {
          const missing: number[] = [];
          for (let i = 0; i < candidates.length; i++) {
            if (!seenIndices.has(i)) {
              missing.push(i);
            }
          }
          throw new Error(
            `TEI reranker response missing scores for candidate indices: [${missing.join(
              ', ',
            )}]. Expected ${candidates.length} candidates, received ${seenIndices.size}`,
          );
        }

        // Deterministic sort: descending relevance score, tie-breaking by original candidate index
        mappedResults.sort((a, b) => {
          if (b.relevanceScore !== a.relevanceScore) {
            return b.relevanceScore - a.relevanceScore;
          }
          return a.index - b.index;
        });

        const durationMs = Date.now() - startTime;

        return {
          results: mappedResults,
          modelName: this.modelName,
          durationMs,
        };
      } catch (error: unknown) {
        const err = error as Error & { name?: string; code?: string };
        if (err.name === 'AbortError') {
          if (options?.signal?.aborted) {
            const cancelErr = new Error('TEI reranker request was aborted by caller');
            (cancelErr as { code?: string }).code = 'ABORTED';
            throw cancelErr;
          }

          const timeoutErr = new Error(
            `TEI reranker request to ${endpoint} timed out after ${this.timeoutMs}ms`,
          );
          (timeoutErr as { code?: string }).code = 'TIMEOUT';
          this.logger.warn(timeoutErr.message);
          throw timeoutErr;
        }

        this.logger.error(`TEI reranker invocation failed: ${err.message}`, {
          endpoint,
          modelName: this.modelName,
          candidateCount: candidates.length,
          error: err.message,
        });
        throw err;
      } finally {
        clearTimeout(timer);
      }
    });
  }
}
