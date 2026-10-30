import { HttpQwenRerankerProvider } from '../http-qwen-reranker.provider';
import { AppConfigService } from '../../../config/app-config.service';
import { RerankCandidate } from '../../interfaces/reranker-provider.interface';
import { CircuitBreaker } from '../../../ingestion/resilience/circuit-breaker';

describe('HttpQwenRerankerProvider', () => {
  let mockAppConfig: Partial<AppConfigService>;
  let mockFetch: jest.Mock;
  let testCircuitBreaker: CircuitBreaker;
  let provider: HttpQwenRerankerProvider;

  const sampleCandidates: RerankCandidate[] = [
    { id: 'chunk-1', content: 'PostgreSQL pgvector cosine index details' },
    { id: 'chunk-2', content: 'Relational database ACID transaction isolation' },
    { id: 'chunk-3', content: 'Baking chocolate chip cookies recipe' },
  ];

  beforeEach(() => {
    mockAppConfig = {
      rerankerBaseUrl: 'http://localhost:11434',
      rerankerEndpointPath: '/api/generate',
      rerankerModelName: 'qwen3-reranker',
      rerankerTimeoutMs: 1000,
      circuitBreakerFailureThreshold: 3,
      circuitBreakerResetTimeoutMs: 5000,
    };

    mockFetch = jest.fn();
    testCircuitBreaker = new CircuitBreaker({
      name: 'TestRerankerCircuitBreaker',
      failureThreshold: 3,
      resetTimeoutMs: 5000,
    });

    provider = new HttpQwenRerankerProvider(mockAppConfig as AppConfigService, {
      fetchFn: mockFetch,
      circuitBreaker: testCircuitBreaker,
    });
  });

  it('should return empty results without making HTTP call when candidates array is empty', async () => {
    const result = await provider.rerank('test query', []);
    expect(result.results).toEqual([]);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should format payload for Ollama /api/generate and parse stringified JSON response', async () => {
    const mockResponseBody = {
      model: 'qwen3-reranker',
      response: JSON.stringify({
        results: [
          { index: 0, relevance_score: 0.942 },
          { index: 1, relevance_score: 0.412 },
          { index: 2, relevance_score: 0.015 },
        ],
      }),
      done: true,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponseBody,
    });

    const response = await provider.rerank('vector search question', sampleCandidates);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = mockFetch.mock.calls[0];
    expect(calledUrl).toBe('http://localhost:11434/api/generate');
    const sentBody = JSON.parse(calledInit.body);
    expect(sentBody.model).toBe('qwen3-reranker');
    expect(sentBody.system).toContain('You are an expert search relevance evaluator');
    expect(sentBody.stream).toBe(false);
    expect(sentBody.options).toEqual({ temperature: 0 });
    expect(sentBody.prompt).toContain('vector search question');
    expect(sentBody.prompt).toContain('[Candidate 0]');
    expect(sentBody.prompt).toContain('PostgreSQL pgvector cosine index details');

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

  it('should correctly sort results descending and tie-break by original index', async () => {
    // Model returns chunk at index 2 with 0.88, index 0 with 0.88, index 1 with 0.12
    const mockResponseBody = {
      model: 'qwen3-reranker',
      response: JSON.stringify({
        results: [
          { index: 2, score: 0.88 },
          { index: 0, score: 0.88 },
          { index: 1, score: 0.12 },
        ],
      }),
      done: true,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponseBody,
    });

    const response = await provider.rerank('test query', sampleCandidates);

    // Index 0 and 2 tie at 0.88, so index 0 comes first (deterministic tie-breaking)
    expect(response.results[0]!.id).toBe('chunk-1');
    expect(response.results[0]!.index).toBe(0);
    expect(response.results[0]!.relevanceScore).toBe(0.88);

    expect(response.results[1]!.id).toBe('chunk-3');
    expect(response.results[1]!.index).toBe(2);
    expect(response.results[1]!.relevanceScore).toBe(0.88);

    expect(response.results[2]!.id).toBe('chunk-2');
    expect(response.results[2]!.index).toBe(1);
    expect(response.results[2]!.relevanceScore).toBe(0.12);
  });

  it('should reject response with missing candidate indices', async () => {
    const mockResponseBody = {
      response: JSON.stringify({
        results: [
          { index: 0, relevance_score: 0.9 },
          { index: 1, relevance_score: 0.5 },
          // index 2 is missing
        ],
      }),
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponseBody,
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /missing scores for candidate indices: \[2\]/,
    );
  });

  it('should reject response with duplicate candidate indices', async () => {
    const mockResponseBody = {
      response: JSON.stringify({
        results: [
          { index: 0, relevance_score: 0.9 },
          { index: 0, relevance_score: 0.7 },
          { index: 1, relevance_score: 0.5 },
        ],
      }),
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponseBody,
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /duplicate candidate index '0'/,
    );
  });

  it('should reject response with out-of-range candidate indices', async () => {
    const mockResponseBody = {
      response: JSON.stringify({
        results: [
          { index: 99, relevance_score: 0.9 },
          { index: 1, relevance_score: 0.5 },
          { index: 2, relevance_score: 0.1 },
        ],
      }),
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponseBody,
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /invalid candidate index '99'/,
    );
  });

  it('should reject response with invalid or out-of-range scores', async () => {
    const mockResponseBody = {
      response: JSON.stringify({
        results: [
          { index: 0, relevance_score: 1.5 }, // Score > 1.0
          { index: 1, relevance_score: 0.5 },
          { index: 2, relevance_score: 0.1 },
        ],
      }),
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponseBody,
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /Invalid relevance score '1.5'.*Expected finite number in \[0.0, 1.0\]/,
    );
  });

  it('should reject response when model output is not valid JSON without silent fallback', async () => {
    const mockResponseBody = {
      response: 'I am an AI and cannot evaluate these documents.',
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponseBody,
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /Reranker model output is not valid JSON/,
    );
  });

  it('should handle HTTP error status and throw descriptive error', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      text: async () => 'Service Unavailable: GPU out of memory',
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /Reranker HTTP error 503.*GPU out of memory/,
    );
  });

  it('should handle network timeout gracefully', async () => {
    mockFetch.mockImplementationOnce(() => {
      const abortErr = new Error('The operation was aborted');
      abortErr.name = 'AbortError';
      return Promise.reject(abortErr);
    });

    await expect(provider.rerank('query', sampleCandidates)).rejects.toThrow(
      /timed out after 1000ms/,
    );
  });

  it('should trip circuit breaker after consecutive threshold failures', async () => {
    const connErr = new Error('connect ECONNREFUSED 127.0.0.1:11434');
    (connErr as any).code = 'ECONNREFUSED';
    mockFetch.mockRejectedValue(connErr);

    // 3 consecutive failures to hit threshold
    await expect(provider.rerank('q', sampleCandidates)).rejects.toThrow('ECONNREFUSED');
    await expect(provider.rerank('q', sampleCandidates)).rejects.toThrow('ECONNREFUSED');
    await expect(provider.rerank('q', sampleCandidates)).rejects.toThrow('ECONNREFUSED');

    // 4th call must fast-fail via CircuitBreaker OPEN state without calling fetch
    expect(testCircuitBreaker.getState()).toBe('OPEN');
    await expect(provider.rerank('q', sampleCandidates)).rejects.toThrow(
      /is OPEN - fast failing/,
    );
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
