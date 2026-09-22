export interface LlmStreamChunk {
  token: string;
  isComplete: boolean;
  providerSessionId?: string;
  contextState?: number[];
  metadata?: Record<string, unknown>;
}

export interface MessageHistory {
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
}

export interface LlmStreamOptions {
  signal?: AbortSignal;
  temperature?: number;
  maxTokens?: number;
  providerSessionId?: string;
  contextState?: number[];
}

/**
 * Abstract vendor-agnostic LLM provider interface for streaming generative completion responses.
 */
export interface ILlmProvider {
  /**
   * Generates a token-by-token stream for a given prompt and conversation history.
   *
   * @param {string} prompt - Assembled system prompt with context instructions
   * @param {MessageHistory[]} [history] - Prior message turns in conversation
   * @param {LlmStreamOptions} [options] - Optional signal, temperature, maxTokens
   * @returns {AsyncIterable<LlmStreamChunk>} Async iterable stream of tokens
   */
  generateStream(
    prompt: string,
    history?: MessageHistory[],
    options?: LlmStreamOptions,
  ): AsyncIterable<LlmStreamChunk>;
}

export const LLM_PROVIDER = 'LLM_PROVIDER';
