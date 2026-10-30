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

interface OllamaGeneratePayload {
  model?: string;
  response?: string;
  results?: RawRerankItem[];
  data?: RawRerankItem[];
  done?: boolean;
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
      '/api/generate';

    this.modelName =
      options?.modelName ||
      this.appConfig.rerankerModelName ||
      'dengcao/Qwen3-Reranker-0.6B:Q8_0';

    this.timeoutMs =
      options?.timeoutMs ||
      this.appConfig.rerankerTimeoutMs ||
      15000;

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
   * Constructs prompt instructing Ollama to score candidate relevance in structured JSON.
   */
  private buildPrompt(query: string, candidates: RerankCandidate[]): string {
    const candidateList = candidates
      .map((c, i) => `[Candidate ${i}]\n${c.content.trim()}`)
      .join('\n\n');

    return (
      `You are an expert search relevance evaluator.\n` +
      `Your task is to evaluate the semantic relevance of each candidate document to answering the search query.\n\n` +
      `Scoring Rules:\n` +
      `1. Assign a relevance score between 0.00 (completely irrelevant) and 1.00 (directly answers the query).\n` +
      `2. Evaluate semantic and factual relevance to the query, not writing quality, document length, or superficial keyword overlap alone.\n` +
      `3. You MUST score EVERY single candidate document from index 0 to ${candidates.length - 1}.\n` +
      `4. Output strictly valid JSON matching this schema with NO commentary or explanation:\n` +
      `{"results": [{"index": 0, "relevance_score": 0.95}, ...]}\n\n` +
      `QUERY:\n${query}\n\n` +
      `CANDIDATE DOCUMENTS:\n${candidateList}\n\n` +
      `JSON OUTPUT:`
    );
  }

  /**
   * Submits query and candidate chunks to Ollama /api/generate endpoint with prompt-based scoring.
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
      const endpoint = `${this.baseUrl.replace(/\/$/, '')}${this.endpointPath.startsWith('/') ? this.endpointPath : `/${this.endpointPath}`
        }`;

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);

      /* Forward external abort signal if provided */
      if (options?.signal) {
        if (options.signal.aborted) {
          controller.abort(options.signal.reason);
        } else {
          options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason), {
            once: true,
          });
        }
      }

      try {
        const prompt = this.buildPrompt(query, candidates);
        const payload: Record<string, unknown> = {
          model: this.modelName,
          system:
            'You are an expert search relevance evaluator. Output only a valid JSON object matching the requested schema with no surrounding text.',
          prompt,
          stream: false,
          options: {
            temperature: 0,
          },
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

        const body = (await response.json()) as OllamaGeneratePayload;
        let rawResults: RawRerankItem[] | undefined;

        // Support both direct results/data arrays and Ollama /api/generate stringified response
        if (Array.isArray(body?.results) || Array.isArray(body?.data)) {
          rawResults = body.results || body.data;
        } else if (typeof body?.response === 'string') {
          let responseText = body.response.trim();

          // Robust JSON extraction: slice between first '{' and last '}'
          const firstBrace = responseText.indexOf('{');
          const lastBrace = responseText.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
            responseText = responseText.substring(firstBrace, lastBrace + 1);
          } else {
            // Also handle if model returned array directly: '[{...}]'
            const firstBracket = responseText.indexOf('[');
            const lastBracket = responseText.lastIndexOf(']');
            if (firstBracket !== -1 && lastBracket !== -1 && lastBracket > firstBracket) {
              responseText = responseText.substring(firstBracket, lastBracket + 1);
            }
          }

          let parsedJson: any;
          try {
            parsedJson = JSON.parse(responseText);
          } catch (jsonErr: any) {
            throw new Error(
              `Reranker model output is not valid JSON: ${jsonErr.message}. Raw output: ${body.response.slice(0, 200)}`,
            );
          }

          rawResults = Array.isArray(parsedJson)
            ? parsedJson
            : (parsedJson?.results || parsedJson?.data);
        }

        if (!rawResults || !Array.isArray(rawResults)) {
          const malformedErr = new Error(
            'Reranker service returned malformed response: Missing results array',
          );
          (malformedErr as any).code = 'MALFORMED_RESPONSE';
          throw malformedErr;
        }

        const seenIndices = new Set<number>();
        const mappedResults: RerankResultItem[] = [];

        for (const item of rawResults) {
          if (
            typeof item.index !== 'number' ||
            !Number.isInteger(item.index) ||
            item.index < 0 ||
            item.index >= candidates.length
          ) {
            throw new Error(
              `Reranker returned invalid candidate index '${item.index}'. Candidates bounds: [0, ${candidates.length - 1
              }]`,
            );
          }

          if (seenIndices.has(item.index)) {
            throw new Error(`Reranker returned duplicate candidate index '${item.index}'`);
          }
          seenIndices.add(item.index);

          const candidate = candidates[item.index];
          if (!candidate) {
            throw new Error(`Unable to locate candidate chunk at index '${item.index}'`);
          }

          const score = item.relevance_score ?? item.score;
          if (
            typeof score !== 'number' ||
            !Number.isFinite(score) ||
            score < 0 ||
            score > 1
          ) {
            throw new Error(
              `Invalid relevance score '${score}' for candidate chunk '${candidate.id}'. Expected finite number in [0.0, 1.0]`,
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
            `Reranker response missing scores for candidate indices: [${missing.join(', ')}]. Expected ${candidates.length} candidates, received ${seenIndices.size}`,
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
      } catch (error: any) {
        if (error.name === 'AbortError') {
          if (options?.signal?.aborted) {
            const cancelErr = new Error('Reranker request was aborted by caller');
            (cancelErr as any).code = 'ABORTED';
            throw cancelErr;
          }

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
