/**
 * Exception thrown when user query validation fails due to invalid formatting, gibberish, low context, or length limits.
 */
export class InvalidQueryException extends Error {
  constructor(
    message: string,
    public readonly reason: string,
  ) {
    super(message);
    this.name = 'InvalidQueryException';
  }
}
