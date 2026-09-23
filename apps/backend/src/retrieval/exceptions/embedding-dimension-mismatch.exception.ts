/**
 * Exception thrown when generated embedding dimensions do not match expected system vector space dimensions.
 */
export class EmbeddingDimensionMismatchException extends Error {
  constructor(
    public readonly expectedDimensions: number,
    public readonly actualDimensions: number,
  ) {
    super(
      `Embedding dimension mismatch: expected ${expectedDimensions}, got ${actualDimensions}`,
    );
    this.name = 'EmbeddingDimensionMismatchException';
  }
}
