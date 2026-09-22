import {
  InvalidQueryException,
  EmbeddingDimensionMismatchException,
} from '../exceptions';

describe('Retrieval Exceptions', () => {
  it('should instantiate InvalidQueryException with message and reason', () => {
    const err = new InvalidQueryException('Query is empty', 'EMPTY_QUERY');
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(InvalidQueryException);
    expect(err.message).toBe('Query is empty');
    expect(err.reason).toBe('EMPTY_QUERY');
    expect(err.name).toBe('InvalidQueryException');
  });

  it('should instantiate EmbeddingDimensionMismatchException with expected and actual dimensions', () => {
    const err = new EmbeddingDimensionMismatchException(768, 384);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(EmbeddingDimensionMismatchException);
    expect(err.expectedDimensions).toBe(768);
    expect(err.actualDimensions).toBe(384);
    expect(err.message).toBe('Embedding dimension mismatch: expected 768, got 384');
    expect(err.name).toBe('EmbeddingDimensionMismatchException');
  });
});
