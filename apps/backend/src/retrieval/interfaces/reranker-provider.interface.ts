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
 * Contract for neural cross-encoder candidate reranking implementations.
 */
export interface IQwenRerankerProvider {
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
