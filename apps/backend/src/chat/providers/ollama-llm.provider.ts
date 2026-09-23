import { Injectable, Logger, Optional } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import {
  ILlmProvider,
  LlmStreamChunk,
  MessageHistory,
  LlmStreamOptions,
} from '../interfaces/llm-provider.interface';
import { CircuitBreaker } from '../../ingestion/resilience/circuit-breaker';
import { RetryPolicy } from '../../ingestion/resilience/retry-policy';

export interface OllamaLlmProviderOptions {
  baseUrl?: string;
  modelName?: string;
  circuitBreaker?: CircuitBreaker;
  retryPolicy?: RetryPolicy;
}

@Injectable()
export class OllamaLlmProvider implements ILlmProvider {
  private readonly logger = new Logger(OllamaLlmProvider.name);
  private readonly baseUrl: string;
  private readonly modelName: string;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryPolicy: RetryPolicy;

  constructor(
    private readonly appConfig: AppConfigService,
    @Optional() options?: OllamaLlmProviderOptions,
  ) {
    this.baseUrl =
      options?.baseUrl ||
      this.appConfig.ollamaBaseUrl ||
      'http://localhost:11434';

    this.modelName =
      options?.modelName ||
      this.appConfig.ollamaModel ||
      'gemma:2b';

    this.circuitBreaker =
      options?.circuitBreaker ||
      new CircuitBreaker({
        name: 'OllamaLlmProvider',
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
  }

  /**
   * Streams generative tokens from local Ollama endpoint protected by CircuitBreaker and RetryPolicy.
   *
   * @param {string} prompt - Formatted system prompt with context
   * @param {MessageHistory[]} [history] - Conversation message history turns
   * @param {LlmStreamOptions} [options] - Stream options including AbortSignal
   * @returns {AsyncIterable<LlmStreamChunk>} Async stream of token chunks
   */
  async *generateStream(
    prompt: string,
    history?: MessageHistory[],
    options?: LlmStreamOptions,
  ): AsyncIterable<LlmStreamChunk> {
    const signal = options?.signal;

    const streamFetcher = async (): Promise<ReadableStream<Uint8Array>> => {
      const url = `${this.baseUrl.replace(/\/$/, '')}/api/generate`;
      const bodyPayload: Record<string, unknown> = {
        model: this.modelName,
        prompt,
        stream: true,
        options: {
          temperature: options?.temperature ?? 0.2,
        },
      };

      if (options?.contextState && options.contextState.length > 0) {
        bodyPayload.context = options.contextState;
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
        signal,
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(`Ollama LLM API returned HTTP ${response.status}: ${errorText}`);
        (err as any).statusCode = response.status;
        throw err;
      }

      if (!response.body) {
        throw new Error('Ollama response body is empty');
      }

      return response.body as ReadableStream<Uint8Array>;
    };

    let webStream: ReadableStream<Uint8Array>;

    /* Execute HTTP connection setup inside CircuitBreaker and RetryPolicy */
    try {
      webStream = await this.circuitBreaker.execute(async () =>
        this.retryPolicy.execute(async () => streamFetcher()),
      );
    } catch (error) {
      this.logger.error('Failed initiating Ollama generative completion stream', {
        baseUrl: this.baseUrl,
        modelName: this.modelName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    /* Read NDJSON stream chunk tokens */
    const reader = webStream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        if (signal?.aborted) {
          reader.cancel('Client aborted request');
          break;
        }

        const { done, value } = await reader.read();
        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed) continue;

          try {
            const parsed = JSON.parse(trimmed) as {
              response?: string;
              done?: boolean;
              context?: number[];
              session_id?: string;
            };
            if (parsed.response) {
              yield {
                token: parsed.response,
                isComplete: false,
              };
            }
            if (parsed.done) {
              yield {
                token: '',
                isComplete: true,
                contextState: parsed.context,
                providerSessionId: parsed.session_id,
              };
              return;
            }
          } catch {
            // Ignore partial non-JSON line chunks
          }
        }
      }

      /* Process remaining buffer if any */
      if (buffer.trim()) {
        try {
          const parsed = JSON.parse(buffer.trim()) as { response?: string; done?: boolean };
          if (parsed.response) {
            yield { token: parsed.response, isComplete: false };
          }
        } catch {
          // Ignore trailing invalid JSON
        }
      }

      yield { token: '', isComplete: true };
    } finally {
      reader.releaseLock();
    }
  }
}
