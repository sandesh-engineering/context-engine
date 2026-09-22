import { RetrievalQueryValidator } from '../services/retrieval-query-validator.service';
import { InvalidQueryException } from '../exceptions/invalid-query.exception';

describe('RetrievalQueryValidator', () => {
  let validator: RetrievalQueryValidator;

  beforeEach(() => {
    validator = new RetrievalQueryValidator();
  });

  it('should accept valid natural language queries', () => {
    const query = 'How does the document ingestion pipeline process embeddings?';
    const result = validator.validate(query);
    expect(result).toBe(query);
  });

  it('should throw EMPTY_QUERY for empty or whitespace strings', () => {
    expect(() => validator.validate('')).toThrow(InvalidQueryException);
    expect(() => validator.validate('   ')).toThrow(InvalidQueryException);
    try {
      validator.validate('   ');
    } catch (err: any) {
      expect(err.reason).toBe('EMPTY_QUERY');
    }
  });

  it('should throw QUERY_TOO_SHORT for queries below minimum length', () => {
    expect(() => validator.validate('ab')).toThrow(InvalidQueryException);
    try {
      validator.validate('ab');
    } catch (err: any) {
      expect(err.reason).toBe('QUERY_TOO_SHORT');
    }
  });

  it('should throw QUERY_TOO_LONG for queries exceeding maximum length', () => {
    const longQuery = 'a'.repeat(2001);
    expect(() => validator.validate(longQuery)).toThrow(InvalidQueryException);
    try {
      validator.validate(longQuery);
    } catch (err: any) {
      expect(err.reason).toBe('QUERY_TOO_LONG');
    }
  });

  it('should throw INSUFFICIENT_CONTEXT for low context single-word queries', () => {
    expect(() => validator.validate('hello')).toThrow(InvalidQueryException);
    expect(() => validator.validate('test')).toThrow(InvalidQueryException);
    try {
      validator.validate('test');
    } catch (err: any) {
      expect(err.reason).toBe('INSUFFICIENT_CONTEXT');
    }
  });

  it('should throw GIBBERISH_QUERY for repetitive or keyboard mash text', () => {
    expect(() => validator.validate('aaaaaaa')).toThrow(InvalidQueryException);
    expect(() => validator.validate('asdfghjkl')).toThrow(InvalidQueryException);
    try {
      validator.validate('asdfghjkl');
    } catch (err: any) {
      expect(err.reason).toBe('GIBBERISH_QUERY');
    }
  });
});
