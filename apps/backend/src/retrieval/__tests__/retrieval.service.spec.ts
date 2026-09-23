import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { RetrievalService } from '../services/retrieval.service';
import { RetrievalQueryValidator } from '../services/retrieval-query-validator.service';
import { VectorSearchRepository } from '../repositories/vector-search.repository';
import { EMBEDDING_PROVIDER } from '../../ingestion/embeddings/interfaces/embedding-provider.interface';
import { InvalidQueryException } from '../exceptions/invalid-query.exception';
import { EmbeddingDimensionMismatchException } from '../exceptions/embedding-dimension-mismatch.exception';

describe('RetrievalService', () => {
  let service: RetrievalService;
  let queryValidator: RetrievalQueryValidator;
  let vectorSearchRepository: jest.Mocked<VectorSearchRepository>;
  let embeddingProvider: any;
  let configService: jest.Mocked<ConfigService>;

  const mockQueryVector = new Array(768).fill(0.1);

  beforeEach(async () => {
    const mockVectorRepository = {
      searchSimilarChunks: jest.fn(),
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
});
