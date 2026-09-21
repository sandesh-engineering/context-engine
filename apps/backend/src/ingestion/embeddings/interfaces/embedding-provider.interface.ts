/**
 * Input request payload for generating dense vector embeddings.
 */
export interface EmbeddingRequest {
  /* Array of text strings to embed */
  texts: string[];
}

/**
 * Output response payload containing generated dense vector embeddings.
 */
export interface EmbeddingResponse {
  /* Matrix of vector float arrays (one vector per input text) */
  embeddings: number[][];
  /* Name of model used for embedding generation */
  modelName: string;
  /* Vector dimensionality (e.g. 768) */
  dimensions: number;
}

export interface EmbeddingOptions {
  /* Optional AbortSignal to cancel downstream HTTP request if parent request is aborted */
  signal?: AbortSignal;
}

/**
 * Abstract service boundary for vector embedding generation.
 */
export interface IEmbeddingProvider {
  /**
   * Generates dense vector embeddings for an array of input text strings.
   *
   * @param {EmbeddingRequest} request - Texts to embed
   * @param {EmbeddingOptions} [options] - Optional execution options (e.g. AbortSignal)
   * @returns {Promise<EmbeddingResponse>} Generated vector matrix and metadata
   * @throws {Error} Throws if embedding generation fails or circuit breaker is OPEN
   */
  generateEmbeddings(
    request: EmbeddingRequest,
    options?: EmbeddingOptions,
  ): Promise<EmbeddingResponse>;
}

export const EMBEDDING_PROVIDER = 'EMBEDDING_PROVIDER';
