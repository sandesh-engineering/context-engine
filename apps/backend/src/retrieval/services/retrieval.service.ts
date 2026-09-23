import { Injectable, Inject, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetrievalQueryValidator } from './retrieval-query-validator.service';
import {
  VectorSearchRepository,
  CandidateChunk,
} from '../repositories/vector-search.repository';
import type { IEmbeddingProvider } from '../../ingestion/embeddings/interfaces/embedding-provider.interface';
import { EMBEDDING_PROVIDER } from '../../ingestion/embeddings/interfaces/embedding-provider.interface';
import { EmbeddingDimensionMismatchException } from '../exceptions/embedding-dimension-mismatch.exception';

export interface RetrievalQueryParams {
  query: string;
  topK?: number;
  similarityThreshold?: number;
  traceId?: string;
}

export interface RetrievalResult {
  query: string;
  queryVector: number[];
  candidates: CandidateChunk[];
  totalRetrieved: number;
  highestSimilarityScore: number;
  traceId?: string;
}

@Injectable()
export class RetrievalService {
  private readonly logger = new Logger(RetrievalService.name);
  private readonly expectedDimensions: number;

  constructor(
    private readonly queryValidator: RetrievalQueryValidator,
    private readonly vectorSearchRepository: VectorSearchRepository,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: IEmbeddingProvider,
    private readonly configService: ConfigService,
  ) {
    this.expectedDimensions =
      this.configService.get<number>('EMBEDDING_DIMENSIONS') || 768;
  }

  /**
   * Executes RAG query retrieval pipeline:
   * 1. Validates and sanitizes user query string
   * 2. Generates query vector embedding via configured local embedding provider
   * 3. Validates embedding space dimension symmetry
   * 4. Queries pgvector cosine similarity index
   * 5. Applies score thresholding and fails fast if no relevant candidates are found
   *
   * @param {RetrievalQueryParams} params - Query text, limits, thresholds, and trace context
   * @returns {Promise<RetrievalResult>} Retrieved candidate chunks and vector search metrics
   * @throws {InvalidQueryException} Throws if query fails validation checks
   * @throws {EmbeddingDimensionMismatchException} Throws if embedding provider returns mismatched vector size
   */
  async retrieveCandidates(
    params: RetrievalQueryParams,
  ): Promise<RetrievalResult> {
    const sanitizedQuery = this.queryValidator.validate(params.query);

    this.logger.log('Generating query embedding for vector search', {
      queryLength: sanitizedQuery.length,
      traceId: params.traceId,
    });

    /* Step 1: Generate dense vector embedding for user question */
    const embeddingResponse = await this.embeddingProvider.generateEmbeddings({
      texts: [sanitizedQuery],
    });

    const queryVector = embeddingResponse.embeddings[0];
    if (!queryVector || queryVector.length === 0) {
      this.logger.error('Embedding provider returned empty vector for query', {
        query: sanitizedQuery,
        traceId: params.traceId,
      });
      throw new Error('Failed to generate embedding vector for user query.');
    }

    const actualDimensions =
      embeddingResponse.dimensions || queryVector.length;

    /* Step 2: Enforce strict embedding dimension symmetry check */
    if (actualDimensions !== this.expectedDimensions) {
      this.logger.error('Embedding dimension mismatch during retrieval', {
        expectedDimensions: this.expectedDimensions,
        actualDimensions,
        traceId: params.traceId,
      });
      throw new EmbeddingDimensionMismatchException(
        this.expectedDimensions,
        actualDimensions,
      );
    }

    /* Step 3: Perform pgvector similarity search */
    const candidates = await this.vectorSearchRepository.searchSimilarChunks(
      queryVector,
      {
        topK: params.topK,
        similarityThreshold: params.similarityThreshold,
      },
    );

    const highestSimilarityScore =
      candidates.length > 0 && candidates[0] ? candidates[0].similarity : 0;

    /* Step 4: Log metrics and handle fail-fast empty candidates */
    if (candidates.length === 0) {
      this.logger.warn('Zero candidate document chunks matched similarity threshold', {
        query: sanitizedQuery,
        similarityThreshold: params.similarityThreshold,
        traceId: params.traceId,
      });
    } else {
      this.logger.log('Retrieved candidate document chunks successfully', {
        candidateCount: candidates.length,
        highestSimilarityScore,
        traceId: params.traceId,
      });
    }

    return {
      query: sanitizedQuery,
      queryVector,
      candidates,
      totalRetrieved: candidates.length,
      highestSimilarityScore,
      traceId: params.traceId,
    };
  }
}
