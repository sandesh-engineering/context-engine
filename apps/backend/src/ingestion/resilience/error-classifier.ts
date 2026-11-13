export type ErrorCategory =
  | 'TRANSIENT'
  | 'PERMANENT'
  | 'EXPIRED'
  | 'RESOURCE_LIMIT'
  | 'INTEGRITY'
  | 'UNKNOWN';

export class ErrorClassifier {
  static classify(error: unknown): ErrorCategory {
    if (!error || typeof error !== 'object') {
      return 'UNKNOWN';
    }

    const err = error as Record<string, any>;
    const statusCode: number | undefined =
      err.$metadata?.httpStatusCode ||
      err.status ||
      err.statusCode ||
      err.response?.status;
    const errorCode: string = String(
      err.code || err.Code || err.name || '',
    ).toUpperCase();
    const message: string = String(err.message || '').toUpperCase();

    // Resource limits / integrity
    if (
      errorCode.includes('PAYLOADTOOLARGE') ||
      errorCode.includes('MAX_SIZE') ||
      message.includes('PAYLOAD TOO LARGE') ||
      message.includes('LIMIT EXCEEDED') ||
      statusCode === 413
    ) {
      return 'RESOURCE_LIMIT';
    }
    if (
      errorCode.includes('CHECKSUM') ||
      errorCode.includes('INTEGRITY') ||
      errorCode.includes('MAGIC_BYTE')
    ) {
      return 'INTEGRITY';
    }

    // Expired credentials / capabilities
    if (
      errorCode.includes('EXPIRED') ||
      errorCode.includes('REQUESTEXPIRED') ||
      message.includes('TOKEN EXPIRED') ||
      message.includes('REQUEST HAS EXPIRED')
    ) {
      return 'EXPIRED';
    }

    // Transient HTTP codes & AWS throttling
    const transientStatusCodes = [429, 500, 502, 503, 504];
    if (statusCode && transientStatusCodes.includes(statusCode)) {
      return 'TRANSIENT';
    }

    const transientCodes = [
      'ETIMEDOUT',
      'ECONNRESET',
      'ECONNREFUSED',
      'EPIPE',
      'EAI_AGAIN',
      'THROTTLING',
      'THROTTLINGEXCEPTION',
      'PROVISIONEDTHROUGHPUTEXCEEDEDEXCEPTION',
      'REQUESTTIMEOUT',
      'REQUESTTIMEDOUT',
      'SLOWDOWN',
      'SERVICEUNAVAILABLE',
      'INTERNALERROR',
    ];

    if (transientCodes.some((code) => errorCode.includes(code) || message.includes(code))) {
      return 'TRANSIENT';
    }

    // Permanent errors
    const permanentStatusCodes = [400, 401, 403, 404, 405, 410, 422];
    if (statusCode && permanentStatusCodes.includes(statusCode)) {
      return 'PERMANENT';
    }

    const permanentCodes = [
      'NOSUCHBUCKET',
      'NOSUCHKEY',
      'ACCESSDENIED',
      'INVALIDACCESSKEYID',
      'SIGNATUREDOESNOTMATCH',
      'INVALIDPART',
      'INVALIDPARAMETER',
      'INVALIDBUCKETNAME',
    ];

    if (permanentCodes.some((code) => errorCode.includes(code))) {
      return 'PERMANENT';
    }

    return 'UNKNOWN';
  }

  static isRetryable(error: unknown): boolean {
    const category = this.classify(error);
    return category === 'TRANSIENT';
  }

  /**
   * True when the failure comes from the document itself (a broken or textless PDF, too many
   * pages, an oversized payload), so a queue redelivery fails the same way every time.
   *
   * @remarks
   * Environment failures (bad credentials, missing bucket, outages, unknown errors) stay
   * redeliverable: they can recover, and once in the DLQ they can be redriven after the fix.
   */
  static isUnrecoverable(error: unknown): boolean {
    const category = this.classify(error);
    return category === 'INTEGRITY' || category === 'RESOURCE_LIMIT';
  }
}
