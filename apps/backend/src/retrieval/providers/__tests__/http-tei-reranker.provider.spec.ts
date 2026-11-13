import { HttpTeiRerankerProvider } from '../http-tei-reranker.provider';
import { AppConfigService } from '../../../config/app-config.service';
import { RerankCandidate } from '../../interfaces/reranker-provider.interface';
import { CircuitBreaker } from '../../../ingestion/resilience/circuit-breaker';

describe('HttpTeiRerankerProvider', () => {
  let mockAppConfig: Partial<AppConfigService>;
  let mockFetch: jest.Mock;
  let testCircuitBreaker: CircuitBreaker;
  let provider: HttpTeiRerankerProvider;

  const sampleCandidates: RerankCandidate[] = [
    { id: 'chunk-1', content: 'PostgreSQL pgvector cosine index details' },
    { id: 'chunk-2', content: 'Relational database ACID transaction isolation' },
    { id: 'chunk-3', content: 'Baking chocolate chip cookies recipe' },
  ];

  beforeEach(() => {
    mockAppConfig = {
      rerankerBaseUrl: 'http://localhost:8081',
      rerankerEndpointPath: '/rerank',
      rerankerModelName: 'cross-encoder/ms-marco-MiniLM-L-6-v2',
      rerankerTimeoutMs: 1000,
      circuitBreakerFailureThreshold: 3,
      circuitBreakerResetTimeoutMs: 5000,
    };

    mockFetch = jest.fn();
    testCircuitBreaker = new CircuitBreaker({
      name: 'TestTeiCircuitBreaker',
      failureThreshold: 3,
      resetTimeoutMs: 5000,
    });

    provider = new HttpTeiRerankerProvider(mockAppConfig as AppConfigService, {
      fetchFn: mockFetch,
      circuitBreaker: testCircuitBreaker,
    });
  });

  it('should return empty results without making HTTP call when candidates array is empty', async () => {
    const result = await provider.rerank('test query', []);
    expect(result.results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should format payload for TEI POST /rerank and parse array response', async () => {
    const mockResponseBody = [
      { index: 0, score: 0.942 },
      { index: 1, score: 0.412 },
      { index: 2, score: 0.015 },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponseBody,
    });

    const response = await provider.rerank('vector search question', sampleCandidates);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('http://localhost:8081/rerank');
    expect(calledInit.method).toBe('POST');
    expect(calledInit.headers).toEqual({ 'Content-Type': 'application/json' });

    const sentBody = JSON.parse(calledInit.body);
    expect(sentBody.query).toBe('vector search question');
    expect(sentBody.texts).toEqual([
      'PostgreSQL pgvector cosine index details',
      'Relational database ACID transaction isolation',
      'Baking chocolate chip cookies recipe',
    ]);
    expect(sentBody.truncate).toBe(true);

    expect(response.results).toHaveLength(3);
    expect(response.results[0]).toEqual({
      id: 'chunk-1',
      index: 0,
      relevanceScore: 0.942,
    });
    expect(response.results[1]).toEqual({
      id: 'chunk-2',
      index: 1,
      relevanceScore: 0.412,
    });
    expect(response.results[2]).toEqual({
      id: 'chunk-3',
      index: 2,
      relevanceScore: 0.015,
    });
  });

  it('should support wrapped results object from TEI', async () => {
    const mockResponseBody = {
      results: [
        { index: 0, score: 0.8 },
        { index: 1, score: 0.5 },
        { index: 2, score: 0.2 },
      ],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponseBody,
    });

    const response = await provider.rerank('query', sampleCandidates);
    expect(response.results).toHaveLength(3);
    expect(response.results[0]?.id).toBe('chunk-1');
  });

  it('should correctly sort results descending and tie-break by original candidate index', async () => {
    // Model returns chunk 2 with 0.88, chunk 0 with 0.88, chunk 1 with 0.12
    const mockResponseBody = [
      { index: 2, score: 0.88 },
      { index: 0, score: 0.88 },
      { index: 1, score: 0.12 },
    ];

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponseBody,
    });

    const response = await provider.rerank('query', sampleCandidates);

    // chunk-1 (index 0) and chunk-3 (index 2) have score 0.88; index 0 comes before index 2
    expect(response.results[0]?.id).toBe('chunk-1');
    expect(response.results[0]?.relevanceScore).toBe(0.88);
    expect(response.results[1]?.id).toBe('chunk-3');
    expect(response.results[1]?.relevanceScore).toBe(0.88);
    expect(response.results[2]?.id).toBe('chunk-2');
    expect(response.results[2]?.relevanceScore).toBe(0.12);
  });

  it('should forward caller AbortSignal', async () => {
    mockFetch.mockImplementationOnce((_url, init) => {
      if (init?.signal?.aborted) {
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        return Promise.reject(err);
      }
      return Promise.resolve({ ok: true, json: async () => [] });
    });

    const abortController = new AbortController();
    abortController.abort();

    await expect(
      provider.rerank('query', sampleCandidates, { signal: abortController.signal }),
    ).rejects.toThrow('TEI reranker request was aborted by caller');
  });

  it('should throw with TIMEOUT on request abort timeout', async () => {
    mockFetch.mockImplementationOnce((_url, init) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        }
      });
    });

    const fastTimeoutProvider = new HttpTeiRerankerProvider(mockAppConfig as AppConfigService, {
      fetchFn: mockFetch,
      circuitBreaker: testCircuitBreaker,
      timeoutMs: 50,
    });

    await expect(fastTimeoutProvider.rerank('query', sampleCandidates)).rejects.toThrow(
      /timed out after 50ms/,
    );
  });

  it('should throw on HTTP error responses with status code attached', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable',
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /TEI reranker HTTP error 503/,
    );
  });

  it('should throw on malformed non-array response', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ invalid: 'no array' }),
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /Missing results array/,
    );
  });

  it('should throw on invalid candidate index', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { index: 99, score: 0.9 },
        { index: 1, score: 0.5 },
        { index: 2, score: 0.1 },
      ],
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /invalid candidate index '99'/,
    );
  });

  it('should throw on duplicate candidate index', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { index: 0, score: 0.9 },
        { index: 0, score: 0.8 },
        { index: 2, score: 0.1 },
      ],
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /duplicate candidate index '0'/,
    );
  });

  it('should throw when scores for some candidates are missing', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { index: 0, score: 0.9 },
        { index: 1, score: 0.5 },
      ],
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /missing scores for candidate indices: \[2\]/,
    );
  });

  it('should throw when relevance score is not a finite number', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { index: 0, score: NaN },
        { index: 1, score: 0.5 },
        { index: 2, score: 0.1 },
      ],
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /Invalid relevance score 'NaN'/,
    );
  });

  it('should trip circuit breaker after threshold failures', async () => {
    const connErr = new Error('connect ECONNREFUSED 127.0.0.1:8081');
    mockFetch.mockRejectedValue(connErr);

    for (let i = 0; i < 3; i++) {
      await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
        'connect ECONNREFUSED',
      );
    }

    // 4th call should fail immediately via circuit breaker
    expect(testCircuitBreaker.getState()).toBe('OPEN');
    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /is OPEN - fast failing/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
