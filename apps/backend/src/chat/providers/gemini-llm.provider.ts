import { Injectable, Logger, Optional } from '@nestjs/common';
import { GoogleGenAI } from '@google/genai';
import { AppConfigService } from '../../config/app-config.service';
import {
  ILlmProvider,
  LlmStreamChunk,
  MessageHistory,
  LlmStreamOptions,
} from '../interfaces/llm-provider.interface';
import { CircuitBreaker } from '../../ingestion/resilience/circuit-breaker';
import { RetryPolicy } from '../../ingestion/resilience/retry-policy';

export interface GeminiLlmProviderOptions {
  apiKey?: string;
  modelName?: string;
  circuitBreaker?: CircuitBreaker;
  retryPolicy?: RetryPolicy;
  genAiClient?: GoogleGenAI;
}

@Injectable()
export class GeminiLlmProvider implements ILlmProvider {
  private readonly logger = new Logger(GeminiLlmProvider.name);
  private readonly apiKey?: string;
  private readonly modelName: string;
  private readonly circuitBreaker: CircuitBreaker;
  private readonly retryPolicy: RetryPolicy;
  private readonly aiClient: GoogleGenAI;

  constructor(
    private readonly appConfig: AppConfigService,
    @Optional() options?: GeminiLlmProviderOptions,
  ) {
    this.apiKey = options?.apiKey || this.appConfig.geminiApiKey || process.env.GEMINI_API_KEY;
    this.modelName =
      options?.modelName ||
      this.appConfig.geminiChatModel ||
      'gemini-2.5-flash';

    this.circuitBreaker =
      options?.circuitBreaker ||
      new CircuitBreaker({
        name: 'GeminiLlmProvider',
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
   * Generates a streaming completion token-by-token using Google Gemini GenAI SDK.
   */
  async *generateStream(
    prompt: string,
    history?: MessageHistory[],
    options?: LlmStreamOptions,
  ): AsyncIterable<LlmStreamChunk> {
    const signal = options?.signal;

    const formattedHistory = (history || [])
      .filter((h) => h.role === 'USER' || h.role === 'ASSISTANT')
      .map((h) => ({
        role: h.role === 'USER' ? 'user' : 'model',
        parts: [{ text: h.content }],
      }));

    const systemInstructions = (history || [])
      .filter((h) => h.role === 'SYSTEM')
      .map((h) => h.content)
      .join('\n\n');

    const config: Record<string, unknown> = {
      temperature: options?.temperature ?? 0.2,
    };

    if (options?.maxTokens) {
      config.maxOutputTokens = options.maxTokens;
    }

    if (systemInstructions) {
      config.systemInstruction = systemInstructions;
    }

    /* Lets the SDK cancel the in-flight HTTP request when the client disconnects */
    if (signal) {
      config.abortSignal = signal;
    }

    const streamFetcher = async () => {
      if (signal?.aborted) {
        throw new Error('Request aborted prior to Gemini API call');
      }

      if (formattedHistory.length > 0) {
        const chat = this.aiClient.chats.create({
          model: this.modelName,
          history: formattedHistory,
          config,
        });
        return chat.sendMessageStream({ message: prompt });
      }

      return this.aiClient.models.generateContentStream({
        model: this.modelName,
        contents: [prompt],
        config,
      });
    };

    let responseStream: any;

    try {
      responseStream = await this.circuitBreaker.execute(async () =>
        this.retryPolicy.execute(async () => streamFetcher()),
      );
    } catch (error) {
      this.logger.error('Failed initiating Google Gemini streaming generation', {
        modelName: this.modelName,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }

    try {
      for await (const chunk of responseStream) {
        if (signal?.aborted) {
          this.logger.debug('Client aborted Gemini stream');
          break;
        }

        const text = typeof chunk?.text === 'function' ? chunk.text() : chunk?.text || '';
        if (text) {
          yield {
            token: text,
            isComplete: false,
          };
        }
      }

      yield {
        token: '',
        isComplete: true,
      };
    } catch (streamErr) {
      if (signal?.aborted) {
        yield { token: '', isComplete: true };
        return;
      }
      this.logger.error('Error during Gemini stream consumption', {
        modelName: this.modelName,
        error: streamErr instanceof Error ? streamErr.message : String(streamErr),
      });
      throw streamErr;
    }
  }
}
