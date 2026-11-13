import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RetrievalService } from '../services/retrieval.service';
import { RetrievalQueryValidator } from '../services/retrieval-query-validator.service';
import { VectorSearchRepository } from '../repositories/vector-search.repository';
import { EMBEDDING_PROVIDER } from '../../ingestion/embeddings/interfaces/embedding-provider.interface';
import { InvalidQueryException } from '../exceptions/invalid-query.exception';
import { EmbeddingDimensionMismatchException } from '../exceptions/embedding-dimension-mismatch.exception';

import { AppConfigService } from '../../config/app-config.service';

describe('RetrievalService', () => {
  let service: RetrievalService;
  let queryValidator: RetrievalQueryValidator;
  let vectorSearchRepository: jest.Mocked<VectorSearchRepository>;
  let embeddingProvider: any;
  let configService: jest.Mocked<ConfigService>;
  let appConfigService: Partial<AppConfigService>;

  const mockQueryVector = new Array(768).fill(0.1);

  beforeEach(async () => {
    const mockVectorRepository = {
      searchSimilarChunks: jest.fn(),
      searchByKeywords: jest.fn(),
    };

    const mockEmbeddingProvider = {
      generateEmbeddings: jest.fn(),
    };

    const mockConfig = {
      get: jest.fn((key: string) => {
        if (key === 'EMBEDDING_DIMENSIONS') return 768;
        return undefined;
      }),
    };

    appConfigService = {
      rerankingEnabled: false,
      rerankerCandidatesTopK: 30,
      rerankerFinalTopK: 5,
      hybridSearchEnabled: false,
      hybridSearchVectorTopK: 20,
      hybridSearchKeywordTopK: 20,
      hybridSearchRrfK: 60,
      hybridSearchFinalTopK: 8,
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
      ],
    }).compile();

    service = module.get<RetrievalService>(RetrievalService);
    queryValidator = module.get<RetrievalQueryValidator>(RetrievalQueryValidator);
    vectorSearchRepository = module.get(VectorSearchRepository);
    embeddingProvider = module.get(EMBEDDING_PROVIDER);
    configService = module.get(ConfigService);
  });

  describe('Happy Path', () => {
    it('should successfully embed query, execute vector search, and return candidate chunks', async () => {
      const mockCandidates = [
        {
          id: 'chunk-1',
          versionId: 'ver-1',
          chunkIndex: 0,
          content: 'Database security policy details...',
          similarity: 0.89,
        },
        {
          id: 'chunk-2',
          versionId: 'ver-1',
          chunkIndex: 1,
          content: 'AWS Secrets Manager integration...',
          similarity: 0.75,
        },
      ];

      embeddingProvider.generateEmbeddings.mockResolvedValue({
        embeddings: [mockQueryVector],
        modelName: 'embeddinggemma',
        dimensions: 768,
      });

      vectorSearchRepository.searchSimilarChunks.mockResolvedValue(mockCandidates);

      const result = await service.retrieveCandidates({
        query: 'What are the database security credentials guidelines?',
        topK: 5,
        similarityThreshold: 0.5,
        traceId: 'trace-123',
      });

      expect(embeddingProvider.generateEmbeddings).toHaveBeenCalledWith({
        texts: ['What are the database security credentials guidelines?'],
      });

      expect(vectorSearchRepository.searchSimilarChunks).toHaveBeenCalledWith(
        mockQueryVector,
        { topK: 5, similarityThreshold: 0.5 },
      );

      expect(result.query).toBe('What are the database security credentials guidelines?');
      expect(result.queryVector).toBe(mockQueryVector);
      expect(result.candidates).toEqual(mockCandidates);
      expect(result.totalRetrieved).toBe(2);
      expect(result.highestSimilarityScore).toBe(0.89);
      expect(result.traceId).toBe('trace-123');
    });
  });

  describe('Unhappy Paths', () => {
    it('should throw InvalidQueryException when query is empty or invalid', async () => {
      await expect(
        service.retrieveCandidates({ query: '   ' }),
      ).rejects.toThrow(InvalidQueryException);

      await expect(
        service.retrieveCandidates({ query: 'asdfghjkl' }),
      ).rejects.toThrow(InvalidQueryException);

      expect(embeddingProvider.generateEmbeddings).not.toHaveBeenCalled();
      expect(vectorSearchRepository.searchSimilarChunks).not.toHaveBeenCalled();
    });

    it('should throw EmbeddingDimensionMismatchException when generated vector size differs', async () => {
      const mismatchedVector = new Array(384).fill(0.1);

      embeddingProvider.generateEmbeddings.mockResolvedValue({
        embeddings: [mismatchedVector],
        modelName: 'bge-small',
        dimensions: 384,
      });

      await expect(
        service.retrieveCandidates({
          query: 'How to configure PostgreSQL connection pooling?',
        }),
      ).rejects.toThrow(EmbeddingDimensionMismatchException);

      expect(vectorSearchRepository.searchSimilarChunks).not.toHaveBeenCalled();
    });

    it('should return zero candidates when no chunks match similarity threshold', async () => {
      embeddingProvider.generateEmbeddings.mockResolvedValue({
        embeddings: [mockQueryVector],
        modelName: 'embeddinggemma',
        dimensions: 768,
      });

      vectorSearchRepository.searchSimilarChunks.mockResolvedValue([]);

      const result = await service.retrieveCandidates({
        query: 'How to write a NodeJS program for web server?',
        similarityThreshold: 0.8,
      });

      expect(result.totalRetrieved).toBe(0);
      expect(result.highestSimilarityScore).toBe(0);
      expect(result.candidates).toEqual([]);
    });
  });

  describe('Hybrid Retrieval (PostgreSQL + pgvector + RRF)', () => {
    beforeEach(() => {
      embeddingProvider.generateEmbeddings.mockResolvedValue({
        embeddings: [mockQueryVector],
        modelName: 'embeddinggemma',
        dimensions: 768,
      });
    });

    it('should use vector-only search when hybridSearchEnabled is false', async () => {
      (appConfigService as any).hybridSearchEnabled = false;

      const mockCandidates = [
        {
          id: 'chunk-1',
          versionId: 'ver-1',
          chunkIndex: 0,
          content: 'Vector only chunk',
          similarity: 0.85,
        },
      ];
      vectorSearchRepository.searchSimilarChunks.mockResolvedValue(mockCandidates);

      const result = await service.retrieveCandidates({
        query: 'What is vector indexing?',
      });

      expect(vectorSearchRepository.searchSimilarChunks).toHaveBeenCalled();
      expect(vectorSearchRepository.searchByKeywords).not.toHaveBeenCalled();
      expect(result.hybrid).toBe(false);
      expect(result.candidates).toEqual(mockCandidates);
    });

    it('should run vector search and keyword search concurrently and merge with RRF when hybridSearchEnabled is true', async () => {
      (appConfigService as any).hybridSearchEnabled = true;

      const vectorCandidates = [
        {
          id: 'chunk-vec-1',
          versionId: 'ver-1',
          chunkIndex: 0,
          content: 'Vector chunk',
          similarity: 0.9,
        },
        {
          id: 'chunk-both',
          versionId: 'ver-1',
          chunkIndex: 1,
          content: 'Appears in both',
          similarity: 0.8,
        },
      ];

      const keywordCandidates = [
        {
          id: 'chunk-both',
          versionId: 'ver-1',
          chunkIndex: 1,
          content: 'Appears in both',
          similarity: 0.35,
        },
        {
          id: 'chunk-kw-1',
          versionId: 'ver-1',
          chunkIndex: 2,
          content: 'Keyword chunk',
          similarity: 0.25,
        },
      ];

      vectorSearchRepository.searchSimilarChunks.mockResolvedValue(vectorCandidates);
      vectorSearchRepository.searchByKeywords.mockResolvedValue(keywordCandidates);

      const result = await service.retrieveCandidates({
        query: 'PostgreSQL HNSW and full-text search',
      });

      expect(vectorSearchRepository.searchSimilarChunks).toHaveBeenCalledWith(
        mockQueryVector,
        { topK: 20, similarityThreshold: undefined },
      );
      expect(vectorSearchRepository.searchByKeywords).toHaveBeenCalledWith(
        'PostgreSQL HNSW and full-text search',
        { topK: 20 },
      );

      expect(result.hybrid).toBe(true);
      // chunk-both appears in both (rank 2 in vector, rank 1 in keyword) -> 1/62 + 1/61
      // chunk-vec-1 appears in vector (rank 1) -> 1/61
      // chunk-kw-1 appears in keyword (rank 2) -> 1/62
      expect(result.candidates).toHaveLength(3);
      expect(result.candidates[0]?.id).toBe('chunk-both');
      expect(result.candidates[0]?.similarity).toBeCloseTo(1 / 61 + 1 / 62, 6);
      expect(result.candidates[1]?.id).toBe('chunk-vec-1');
      expect(result.candidates[2]?.id).toBe('chunk-kw-1');
    });

    it('should fall back to vector-only candidates when keyword search fails or rejects', async () => {
      (appConfigService as any).hybridSearchEnabled = true;

      const vectorCandidates = [
        {
          id: 'chunk-v1',
          versionId: 'ver-1',
          chunkIndex: 0,
          content: 'Resilient vector candidate',
          similarity: 0.88,
        },
      ];

      vectorSearchRepository.searchSimilarChunks.mockResolvedValue(vectorCandidates);
      vectorSearchRepository.searchByKeywords.mockRejectedValue(
        new Error('PostgreSQL FTS connection error'),
      );

      const result = await service.retrieveCandidates({
        query: 'Testing keyword search fallback',
      });

      expect(result.hybrid).toBe(true);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0]?.id).toBe('chunk-v1');
    });

    it('should return empty candidates when both vector and keyword search return empty arrays in hybrid mode', async () => {
      (appConfigService as any).hybridSearchEnabled = true;

      vectorSearchRepository.searchSimilarChunks.mockResolvedValue([]);
      vectorSearchRepository.searchByKeywords.mockResolvedValue([]);

      const result = await service.retrieveCandidates({
        query: 'No matching documentation available',
      });

      expect(result.hybrid).toBe(true);
      expect(result.totalRetrieved).toBe(0);
      expect(result.candidates).toEqual([]);
    });
  });
});

