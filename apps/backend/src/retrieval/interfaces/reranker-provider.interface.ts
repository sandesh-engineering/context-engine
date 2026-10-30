/**
 * Injection token for dynamic NestJS dependency injection of the reranker provider.
 */
export const RERANKER_PROVIDER = 'RERANKER_PROVIDER';

/**
 * Normalized input candidate representation for cross-encoder reranking.
 */
export interface RerankCandidate {
  /** Unique chunk identifier to map back to database entity */
  id: string;
  /** Text content to evaluate against query */
  content: string;
}

/**
 * Individual scored candidate result.
 */
export interface RerankResultItem {
  /** Chunk identifier corresponding to the input candidate */
  id: string;
  /** Original zero-based position index in input array */
  index: number;
  /** Normalized cross-encoder relevance score (higher is more relevant) */
  relevanceScore: number;
}

/**
 * Response structure returned by IQwenRerankerProvider.
 */
export interface RerankResponse {
  /** Array of scored results */
  results: RerankResultItem[];
  /** Model name or identifier used for inference */
  modelName: string;
  /** Execution duration in milliseconds */
  durationMs: number;
}

/**
 * Execution options for reranking calls.
 */
export interface RerankOptions {
  /** Optional AbortSignal for request cancellation and timeout propagation */
  signal?: AbortSignal;
}

/**
 * Request payload for Hugging Face Text Embeddings Inference /rerank endpoint.
 */
export interface TeiRerankRequest {
  /** The search query string */
  query: string;
  /** Ordered list of candidate document texts to score against the query */
  texts: string[];
  /** Whether to truncate inputs exceeding model context length */
  truncate?: boolean;
  /** Whether to return raw scores (logits) instead of sigmoid probabilities */
  raw_scores?: boolean;
  /** Whether to include text in response */
  return_text?: boolean;
}

/**
 * Scored candidate result returned from Hugging Face Text Embeddings Inference /rerank.
 */
export interface TeiRerankResponseItem {
  /** Zero-based candidate index */
  index: number;
  /** Cross-encoder relevance score or logit */
  score: number;
  /** Optional echo text if return_text was true */
  text?: string;
}

/**
 * Contract for neural cross-encoder candidate reranking implementations.
 */
export interface IRerankerProvider {
  /**
   * Reranks candidate document chunks against the user query.
   *
   * @param {string} query - Sanitized user question
   * @param {RerankCandidate[]} candidates - Array of candidate chunks to rank
   * @param {RerankOptions} [options] - Optional execution options (signal)
   * @returns {Promise<RerankResponse>} Scored results mapped to original candidate IDs
   * @throws {Error} When inference fails, times out, or returns a malformed response
   *
   * @example
   * ```ts
   * const response = await reranker.rerank(query, candidates, { signal });
   * ```
   */
  rerank(
    query: string,
    candidates: RerankCandidate[],
    options?: RerankOptions,
  ): Promise<RerankResponse>;
}

/**
 * Backward-compatible alias for existing consumers and test fixtures.
 */
export type IQwenRerankerProvider = IRerankerProvider;

