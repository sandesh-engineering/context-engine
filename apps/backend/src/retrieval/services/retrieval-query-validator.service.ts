import { Injectable } from '@nestjs/common';
import { InvalidQueryException } from '../exceptions/invalid-query.exception';

export interface QueryValidationOptions {
  minLength?: number;
  maxLength?: number;
}

@Injectable()
export class RetrievalQueryValidator {
  private readonly defaultMinLength = 3;
  private readonly defaultMaxLength = 2000;

  /**
   * Validates and sanitizes incoming user query text.
   *
   * @param {string} query - Natural language query string from user
   * @param {QueryValidationOptions} [options] - Optional custom bounds
   * @returns {string} Cleaned, trimmed query string
   * @throws {InvalidQueryException} Throws if query fails validation checks
   */
  public validate(query: string, options?: QueryValidationOptions): string {
    const minLength = options?.minLength ?? this.defaultMinLength;
    const maxLength = options?.maxLength ?? this.defaultMaxLength;

    if (query === undefined || query === null || typeof query !== 'string') {
      throw new InvalidQueryException(
        'User query must be a non-null string.',
        'INVALID_TYPE',
      );
    }

    const trimmed = query.trim();

    if (trimmed.length === 0) {
      throw new InvalidQueryException(
        'User query cannot be empty or whitespace only.',
        'EMPTY_QUERY',
      );
    }

    if (trimmed.length < minLength) {
      throw new InvalidQueryException(
        `User query is too short. Minimum length is ${minLength} characters.`,
        'QUERY_TOO_SHORT',
      );
    }

    if (trimmed.length > maxLength) {
      throw new InvalidQueryException(
        `User query exceeds maximum length of ${maxLength} characters.`,
        'QUERY_TOO_LONG',
      );
    }

    const words = trimmed.split(/\s+/);
    if (words.length === 1 && words[0]) {
      const word = words[0].toLowerCase();
      // Low context single-word terms or common greetings/fillers
      const lowContextSingleWords = new Set([
        'hi',
        'hello',
        'hey',
        'test',
        'help',
        'what',
        'why',
        'how',
        'code',
        'node',
        'js',
        'a',
        'the',
      ]);
      if (lowContextSingleWords.has(word) || word.length < 3) {
        throw new InvalidQueryException(
          'Single word query lacks sufficient contextual detail for vector search.',
          'INSUFFICIENT_CONTEXT',
        );
      }
    }

    if (this.isGibberish(trimmed)) {
      throw new InvalidQueryException(
        'User query appears to be gibberish or invalid text.',
        'GIBBERISH_QUERY',
      );
    }

    return trimmed;
  }

  /**
   * Heuristic evaluation for random key mash or non-lexical gibberish strings.
   */
  private isGibberish(text: string): boolean {
    const cleanText = text.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (cleanText.length < 5) {
      return false;
    }

    // Check for repetitive single character (e.g. "aaaaaaa")
    if (/^(.)\1{4,}$/.test(cleanText)) {
      return true;
    }

    // Check common keyboard mashing sequences (e.g. "asdfghjkl", "qwertyuiop", "zxcvbnm")
    const keyboardPatterns = [
      'asdfghjkl',
      'qwertyuiop',
      'zxcvbnm',
      '123456789',
      'asdfgh',
      'qwerty',
    ];
    for (const pattern of keyboardPatterns) {
      if (cleanText.includes(pattern)) {
        return true;
      }
    }

    // Check vowel ratio for purely alphabetic single long words (> 8 chars without spaces)
    if (!text.includes(' ') && cleanText.length > 8 && /^[a-z]+$/.test(cleanText)) {
      const vowels = cleanText.match(/[aeiou]/g);
      const vowelRatio = vowels ? vowels.length / cleanText.length : 0;
      if (vowelRatio < 0.1 || vowelRatio > 0.85) {
        return true;
      }
    }

    return false;
  }
}
