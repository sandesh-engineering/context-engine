import { GeminiEmbeddingProvider } from '../embeddings/providers/gemini-embedding.provider';
import { AppConfigService } from '../../config/app-config.service';
import { CircuitBreaker } from '../resilience/circuit-breaker';
import { RetryPolicy } from '../resilience/retry-policy';

describe('GeminiEmbeddingProvider', () => {
  let mockConfig: Partial<AppConfigService>;
  let mockGenAiClient: any;
  let mockModels: any;

  beforeEach(() => {
    mockConfig = {
      geminiApiKey: 'test-api-key',
      geminiEmbeddingModel: 'text-embedding-004',
      embeddingDimensions: 768,
      circuitBreakerFailureThreshold: 3,
      circuitBreakerResetTimeoutMs: 10000,
    };

    mockModels = {
      embedContent: jest.fn().mockResolvedValue({
        embeddings: [
          { values: [0.1, 0.2, 0.3] },
          { values: [0.4, 0.5, 0.6] },
        ],
      }),
    };

    mockGenAiClient = {
      models: mockModels,
    };
  });

  it('should generate embeddings for input texts successfully', async () => {
    const provider = new GeminiEmbeddingProvider(mockConfig as AppConfigService, {
      genAiClient: mockGenAiClient,
    });

    const result = await provider.generateEmbeddings({
      texts: ['First chunk of text', 'Second chunk of text'],
    });

    expect(mockModels.embedContent).toHaveBeenCalledWith({
      model: 'text-embedding-004',
      contents: ['First chunk of text', 'Second chunk of text'],
    });

    expect(result.embeddings).toEqual([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
    ]);
    expect(result.modelName).toBe('text-embedding-004');
    expect(result.dimensions).toBe(3);
  });

  it('should return empty embeddings immediately when input array is empty', async () => {
    const provider = new GeminiEmbeddingProvider(mockConfig as AppConfigService, {
      genAiClient: mockGenAiClient,
    });

    const result = await provider.generateEmbeddings({ texts: [] });

    expect(result.embeddings).toEqual([]);
    expect(mockModels.embedContent).not.toHaveBeenCalled();
  });

  it('should throw immediately if signal is already aborted', async () => {
    const provider = new GeminiEmbeddingProvider(mockConfig as AppConfigService, {
      genAiClient: mockGenAiClient,
    });

    const controller = new AbortController();
    controller.abort();

    await expect(
      provider.generateEmbeddings(
        { texts: ['Some text'] },
        { signal: controller.signal },
      ),
    ).rejects.toThrow('Embedding generation request aborted');

    expect(mockModels.embedContent).not.toHaveBeenCalled();
  });

  it('should retry transient errors and trip circuit breaker after reaching failure threshold', async () => {
    const breaker = new CircuitBreaker({
      name: 'TestGeminiEmbedBreaker',
      failureThreshold: 2,
      resetTimeoutMs: 5000,
    });
    const retryPolicy = new RetryPolicy({
      maxAttempts: 2,
      initialDelayMs: 10,
    });

    const transientErr = new Error('Connection reset by peer');
    (transientErr as any).code = 'ECONNRESET';
    mockModels.embedContent.mockRejectedValue(transientErr);

    const provider = new GeminiEmbeddingProvider(mockConfig as AppConfigService, {
      genAiClient: mockGenAiClient,
      circuitBreaker: breaker,
      retryPolicy,
    });

    // First failed execution
    await expect(
      provider.generateEmbeddings({ texts: ['Text 1'] }),
    ).rejects.toThrow('Connection reset by peer');

    // Second failed execution trips the breaker
    await expect(
      provider.generateEmbeddings({ texts: ['Text 2'] }),
    ).rejects.toThrow('Connection reset by peer');

    expect(breaker.getState()).toBe('OPEN');
  });
});
