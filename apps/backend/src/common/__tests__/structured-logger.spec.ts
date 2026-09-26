import { StructuredLogger, LogEvents } from '../logger';
import { AppTracer } from '../telemetry';

describe('StructuredLogger', () => {
  let logger: StructuredLogger;
  let logSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    logger = new StructuredLogger('TestContext', 'test-service');
    logSpy = jest.spyOn((logger as any).nestLogger, 'log').mockImplementation(() => {});
    errorSpy = jest.spyOn((logger as any).nestLogger, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('should emit structured JSON log with event and context fields', () => {
    logger.logEvent(LogEvents.INGESTION_JOB_STARTED, {
      jobId: 'job-123',
      documentId: 'doc-456',
      attempt: 1,
    });

    expect(logSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(logSpy.mock.calls[0][0]);
    expect(parsed.level).toBe('info');
    expect(parsed.event).toBe(LogEvents.INGESTION_JOB_STARTED);
    expect(parsed.jobId).toBe('job-123');
    expect(parsed.documentId).toBe('doc-456');
    expect(parsed.attempt).toBe(1);
    expect(parsed.contextName).toBe('TestContext');
    expect(parsed.service).toBe('test-service');
    expect(parsed.timestamp).toBeDefined();
  });

  it('should automatically attach active OpenTelemetry traceId and spanId', async () => {
    await AppTracer.traceSpan('test.logging.span', {}, async (span) => {
      const spanContext = span.spanContext();

      logger.logEvent(LogEvents.DOCUMENT_PARSE_COMPLETED, {
        jobId: 'job-789',
      });

      expect(logSpy).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(logSpy.mock.calls[0][0]);
      expect(parsed.traceId).toBe(spanContext.traceId);
      expect(parsed.spanId).toBe(spanContext.spanId);
      expect(parsed.jobId).toBe('job-789');
    });
  });

  it('should classify errors into standard categories with retryable flag', () => {
    const transientError = new Error('ETIMEDOUT connection failed');
    (transientError as any).code = 'ETIMEDOUT';

    logger.logError(LogEvents.EMBEDDING_BATCH_FAILED, transientError, {
      jobId: 'job-999',
      chunkId: 'chunk-111',
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(parsed.level).toBe('error');
    expect(parsed.event).toBe(LogEvents.EMBEDDING_BATCH_FAILED);
    expect(parsed.errorType).toBe('TRANSIENT');
    expect(parsed.retryable).toBe(true);
    expect(parsed.errorMessage).toContain('ETIMEDOUT');
    expect(parsed.jobId).toBe('job-999');
    expect(parsed.chunkId).toBe('chunk-111');
  });

  it('should classify permanent errors correctly', () => {
    const permanentError = new Error('Invalid file format: Only valid PDF documents are allowed');
    (permanentError as any).status = 400;

    logger.logError(LogEvents.DOCUMENT_PARSE_FAILED, permanentError, {
      documentId: 'doc-invalid',
    });

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const parsed = JSON.parse(errorSpy.mock.calls[0][0]);
    expect(parsed.level).toBe('error');
    expect(parsed.errorType).toBe('PERMANENT');
    expect(parsed.retryable).toBe(false);
    expect(parsed.documentId).toBe('doc-invalid');
  });
});
