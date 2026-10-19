import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RetrievalService } from '../services/retrieval.service';
import { RetrievalQueryValidator } from '../services/retrieval-query-validator.service';
import {
  VectorSearchRepository,
  CandidateChunk,
} from '../repositories/vector-search.repository';
import { EMBEDDING_PROVIDER } from '../../ingestion/embeddings/interfaces/embedding-provider.interface';
import { AppConfigService } from '../../config/app-config.service';
import {
  IQwenRerankerProvider,
  RERANKER_PROVIDER,
  RerankResponse,
} from '../interfaces/reranker-provider.interface';
import { LogEvents } from '../../common/logger';

describe('RetrievalService - Qwen Reranker Integration', () => {
  let service: RetrievalService;
  let vectorSearchRepository: jest.Mocked<VectorSearchRepository>;
  let embeddingProvider: any;
  let rerankerProvider: jest.Mocked<IQwenRerankerProvider>;
  let appConfigService: Partial<AppConfigService>;

  const mockQueryVector = new Array(768).fill(0.05);

  const createCandidates = (count: number): CandidateChunk[] => {
    return Array.from({ length: count }, (_, i) => ({
      id: `chunk-${i + 1}`,
      versionId: `ver-1`,
      chunkIndex: i,
      content: `Content for chunk ${i + 1} with domain context...`,
      similarity: 0.9 - i * 0.02,
    }));
  };

  const setupTestModule = async (rerankEnabled: boolean) => {
    const mockVectorRepository = {
      searchSimilarChunks: jest.fn(),
    };

    const mockEmbeddingProvider = {
      generateEmbeddings: jest.fn().mockResolvedValue({
        embeddings: [mockQueryVector],
        modelName: 'embeddinggemma',
        dimensions: 768,
      }),
    };

    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'EMBEDDING_DIMENSIONS') return 768;
        return undefined;
      }),
    };

    appConfigService = {
      rerankingEnabled: rerankEnabled,
      rerankerBaseUrl: 'http://localhost:11434',
      rerankerEndpointPath: '/api/rerank',
      rerankerModelName: 'qwen3-reranker:4b',
      rerankerTimeoutMs: 5000,
      rerankerCandidatesTopK: 30,
      rerankerFinalTopK: 5,
    };

    const mockReranker: jest.Mocked<IQwenRerankerProvider> = {
      rerank: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RetrievalService,
        RetrievalQueryValidator,
        {
          provide: VectorSearchRepository,
          useValue: mockVectorRepository,
        },
        {
          provide: EMBEDDING_PROVIDER,
          useValue: mockEmbeddingProvider,
        },
        {
          provide: ConfigService,
          useValue: mockConfig,
        },
        {
          provide: AppConfigService,
          useValue: appConfigService,
        },
        {
          provide: RERANKER_PROVIDER,
          useValue: mockReranker,
        },
      ],
    }).compile();

    service = module.get<RetrievalService>(RetrievalService);
    vectorSearchRepository = module.get(VectorSearchRepository);
    embeddingProvider = module.get(EMBEDDING_PROVIDER);
    rerankerProvider = module.get(RERANKER_PROVIDER);
  };

  describe('Feature Flag Disabled Baseline', () => {
    beforeEach(async () => {
      await setupTestModule(false);
    });

    it('should query vector search repository with original topK and never invoke reranker', async () => {
      const candidates = createCandidates(5);
      vectorSearchRepository.searchSimilarChunks.mockResolvedValue(candidates);

      const result = await service.retrieveCandidates({
        query: 'What is the authentication strategy?',
        topK: 5,
        similarityThreshold: 0.5,
      });

      expect(vectorSearchRepository.searchSimilarChunks).toHaveBeenCalledWith(
        mockQueryVector,
        { topK: 5, similarityThreshold: 0.5 },
      );
      expect(rerankerProvider.rerank).not.toHaveBeenCalled();
      expect(result.candidates).toHaveLength(5);
      expect(result.candidates[0]!.id).toBe('chunk-1');
      expect(result.candidates[0]!.similarity).toBe(0.9);
    });
  });

  describe('Feature Flag Enabled - Successful Reranking', () => {
    beforeEach(async () => {
      await setupTestModule(true);
    });

    it('should expand candidate pool to rerankerCandidatesTopK, invoke reranker, reorder candidates, and slice to finalTopK', async () => {
      const candidates = createCandidates(10);
      vectorSearchRepository.searchSimilarChunks.mockResolvedValue(candidates);

      // Suppose chunk-3 (initially 3rd) and chunk-5 (initially 5th) are most relevant
      const rerankResponse: RerankResponse = {
        results: [
          { index: 2, id: 'chunk-3', relevanceScore: 0.98 },
          { index: 4, id: 'chunk-5', relevanceScore: 0.92 },
          { index: 0, id: 'chunk-1', relevanceScore: 0.85 },
          { index: 1, id: 'chunk-2', relevanceScore: 0.70 },
          { index: 3, id: 'chunk-4', relevanceScore: 0.65 },
          { index: 5, id: 'chunk-6', relevanceScore: 0.50 },
          { index: 6, id: 'chunk-7', relevanceScore: 0.40 },
          { index: 7, id: 'chunk-8', relevanceScore: 0.30 },
          { index: 8, id: 'chunk-9', relevanceScore: 0.20 },
          { index: 9, id: 'chunk-10', relevanceScore: 0.10 },
        ],
        modelName: 'qwen3-reranker:4b',
        durationMs: 45,
      };

      rerankerProvider.rerank.mockResolvedValue(rerankResponse);

      const result = await service.retrieveCandidates({
        query: 'How does authentication work?',
        topK: 5,
        similarityThreshold: 0.4,
        traceId: 'trace-test-1',
      });

      // Verify expanded candidate pool queried
      expect(vectorSearchRepository.searchSimilarChunks).toHaveBeenCalledWith(
        mockQueryVector,
        { topK: 30, similarityThreshold: 0.4 },
      );

      // Verify reranker received all candidates
      expect(rerankerProvider.rerank).toHaveBeenCalledWith(
        'How does authentication work?',
        candidates.map((c) => ({ id: c.id, content: c.content })),
      );

      // Sliced to requested topK (5)
      expect(result.candidates).toHaveLength(5);
      expect(result.candidates[0]!.id).toBe('chunk-3');
      expect(result.candidates[0]!.similarity).toBe(0.98);
      expect(result.candidates[1]!.id).toBe('chunk-5');
      expect(result.candidates[1]!.similarity).toBe(0.92);
      expect(result.candidates[2]!.id).toBe('chunk-1');
      expect(result.candidates[2]!.similarity).toBe(0.85);
      expect(result.highestSimilarityScore).toBe(0.98);
    });

    it('should perform stable tie-breaking preserving original vector similarity order when scores match', async () => {
      const candidates = createCandidates(4);
      vectorSearchRepository.searchSimilarChunks.mockResolvedValue(candidates);

      // chunk-1 and chunk-2 both get relevanceScore 0.88; chunk-3 and chunk-4 both get 0.50
      const rerankResponse: RerankResponse = {
        results: [
          { index: 1, id: 'chunk-2', relevanceScore: 0.88 },
          { index: 0, id: 'chunk-1', relevanceScore: 0.88 },
          { index: 3, id: 'chunk-4', relevanceScore: 0.50 },
          { index: 2, id: 'chunk-3', relevanceScore: 0.50 },
        ],
        modelName: 'qwen3-reranker:4b',
        durationMs: 25,
      };

      rerankerProvider.rerank.mockResolvedValue(rerankResponse);

      const result = await service.retrieveCandidates({
        query: 'Tie-break test query',
        topK: 4,
      });

      expect(result.candidates).toHaveLength(4);
      // chunk-1 had higher initial vector similarity (index 0) than chunk-2 (index 1)
      expect(result.candidates[0]!.id).toBe('chunk-1');
      expect(result.candidates[1]!.id).toBe('chunk-2');
      // chunk-3 had higher initial vector similarity (index 2) than chunk-4 (index 3)
      expect(result.candidates[2]!.id).toBe('chunk-3');
      expect(result.candidates[3]!.id).toBe('chunk-4');
    });

    it('should bypass reranking when vector search returns zero candidates', async () => {
      vectorSearchRepository.searchSimilarChunks.mockResolvedValue([]);

      const result = await service.retrieveCandidates({
        query: 'Query with no matching documents in database',
        topK: 5,
        similarityThreshold: 0.95,
      });

      expect(result.totalRetrieved).toBe(0);
      expect(result.candidates).toEqual([]);
      expect(rerankerProvider.rerank).not.toHaveBeenCalled();
    });
  });

  describe('Resilient Fallback on Reranker Failure', () => {
    beforeEach(async () => {
      await setupTestModule(true);
    });

    it('should gracefully fall back to original vector search order when reranker throws network or timeout error', async () => {
      const candidates = createCandidates(10);
      vectorSearchRepository.searchSimilarChunks.mockResolvedValue(candidates);

      rerankerProvider.rerank.mockRejectedValue(
        new Error('Reranker service request timed out after 5000ms'),
      );

      const result = await service.retrieveCandidates({
        query: 'Query during reranker outage',
        topK: 5,
      });

      // Pipeline should NOT fail
      expect(result.candidates).toHaveLength(5);
      // Fallback returns top 5 in original vector similarity order
      expect(result.candidates[0]!.id).toBe('chunk-1');
      expect(result.candidates[0]!.similarity).toBe(0.9);
      expect(result.candidates[1]!.id).toBe('chunk-2');
      expect(result.candidates[4]!.id).toBe('chunk-5');
      expect(result.highestSimilarityScore).toBe(0.9);
    });

    it('should gracefully fall back when reranker returns malformed response', async () => {
      const candidates = createCandidates(5);
      vectorSearchRepository.searchSimilarChunks.mockResolvedValue(candidates);

      rerankerProvider.rerank.mockRejectedValue(
        new Error('Reranker returned non-array results'),
      );

      const result = await service.retrieveCandidates({
        query: 'Query with malformed response',
        topK: 3,
      });

      expect(result.candidates).toHaveLength(3);
      expect(result.candidates[0]!.id).toBe('chunk-1');
      expect(result.candidates[1]!.id).toBe('chunk-2');
      expect(result.candidates[2]!.id).toBe('chunk-3');
    });
  });

  describe('Observability & Privacy Protection', () => {
    beforeEach(async () => {
      await setupTestModule(true);
    });

    it('should not include raw document content in structured log output', async () => {
      const logSpy = jest.spyOn(service['logger'], 'logEvent');
      const warnSpy = jest.spyOn(service['logger'], 'warnEvent');

      const candidates = [
        {
          id: 'chunk-private',
          versionId: 'ver-1',
          chunkIndex: 0,
          content: 'TOP_SECRET_INTERNAL_CREDENTIALS_AND_KEYS',
          similarity: 0.95,
        },
      ];
      vectorSearchRepository.searchSimilarChunks.mockResolvedValue(candidates);

      rerankerProvider.rerank.mockResolvedValue({
        results: [{ index: 0, id: 'chunk-private', relevanceScore: 0.99 }],
        modelName: 'qwen3-reranker:4b',
        durationMs: 12,
      });

      await service.retrieveCandidates({
        query: 'Security policy query',
        topK: 1,
      });

      for (const call of logSpy.mock.calls) {
        const metadata = JSON.stringify(call[1] || {});
        expect(metadata).not.toContain('TOP_SECRET_INTERNAL_CREDENTIALS_AND_KEYS');
      }

      for (const call of warnSpy.mock.calls) {
        const metadata = JSON.stringify(call[1] || {});
        expect(metadata).not.toContain('TOP_SECRET_INTERNAL_CREDENTIALS_AND_KEYS');
      }

      logSpy.mockRestore();
      warnSpy.mockRestore();
    });
  });
});
