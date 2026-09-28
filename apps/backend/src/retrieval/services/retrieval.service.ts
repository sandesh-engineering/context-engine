import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RetrievalQueryValidator } from './retrieval-query-validator.service';
import {
  VectorSearchRepository,
  CandidateChunk,
} from '../repositories/vector-search.repository';
import type { IEmbeddingProvider } from '../../ingestion/embeddings/interfaces/embedding-provider.interface';
import { EMBEDDING_PROVIDER } from '../../ingestion/embeddings/interfaces/embedding-provider.interface';
import { EmbeddingDimensionMismatchException } from '../exceptions/embedding-dimension-mismatch.exception';
import { AppTracer, SemanticAttributes } from '../../common/telemetry';
import { StructuredLogger, LogEvents } from '../../common/logger';

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
  private readonly logger = new StructuredLogger(RetrievalService.name);
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
   * Executes RAG query retrieval pipeline with tracing spans and structured logging:
   * 1. Validates and sanitizes user query string
   * 2. Generates query vector embedding (sub-span: retrieval.query_embedding)
   * 3. Validates embedding space dimension symmetry
   * 4. Queries pgvector cosine similarity index (sub-span: retrieval.vector_search)
   * 5. Returns ranked candidate chunks
   */
  async retrieveCandidates(
    params: RetrievalQueryParams,
  ): Promise<RetrievalResult> {
    return AppTracer.traceSpan(
      'retrieval',
      {
        attributes: {
          [SemanticAttributes.RAG_TOP_K]: params.topK || 5,
          'query.length': params.query?.length || 0,
        },
      },
      async (span) => {
        const sanitizedQuery = this.queryValidator.validate(params.query);

        this.logger.logEvent(LogEvents.RETRIEVAL_STARTED, {
          queryLength: sanitizedQuery.length,
          topK: params.topK,
          similarityThreshold: params.similarityThreshold,
          traceId: params.traceId,
        });

        /* Step 1: Generate dense vector embedding for user query */
        const queryVector = await AppTracer.traceSpan(
          'retrieval.query_embedding',
          {
            attributes: {
              'query.length': sanitizedQuery.length,
            },
          },
          async () => {
            const embeddingResponse = await this.embeddingProvider.generateEmbeddings({
              texts: [sanitizedQuery],
            });

            const vector = embeddingResponse.embeddings[0];
            if (!vector || vector.length === 0) {
              const err = new Error('Failed to generate embedding vector for user query.');
              this.logger.logError(LogEvents.RETRIEVAL_FAILED, err, {
                query: sanitizedQuery,
                traceId: params.traceId,
              });
              throw err;
            }

            const actualDimensions =
              embeddingResponse.dimensions || vector.length;

            /* Step 2: Dimension symmetry check */
            if (actualDimensions !== this.expectedDimensions) {
              const mismatchErr = new EmbeddingDimensionMismatchException(
                this.expectedDimensions,
                actualDimensions,
              );
              this.logger.logError(LogEvents.RETRIEVAL_FAILED, mismatchErr, {
                expectedDimensions: this.expectedDimensions,
                actualDimensions,
                traceId: params.traceId,
              });
              throw mismatchErr;
            }

            return vector;
          },
        );

        this.logger.debugEvent(LogEvents.RETRIEVAL_QUERY_EMBEDDED, {
          dimensions: queryVector.length,
          traceId: params.traceId,
        });

        /* Step 3: Perform pgvector similarity search */
        const candidates = await AppTracer.traceSpan(
          'retrieval.vector_search',
          {
            attributes: {
              'vector.dimensions': queryVector.length,
              [SemanticAttributes.RAG_TOP_K]: params.topK || 5,
            },
          },
          async (searchSpan) => {
            const results = await this.vectorSearchRepository.searchSimilarChunks(
              queryVector,
              {
                topK: params.topK,
                similarityThreshold: params.similarityThreshold,
              },
            );

            searchSpan.setAttribute(SemanticAttributes.RAG_RETRIEVED_COUNT, results.length);
            if (results.length > 0 && results[0]) {
              searchSpan.setAttribute(
                SemanticAttributes.RAG_HIGHEST_SCORE,
                results[0].similarity,
              );
            }
            return results;
          },
        );

        const highestSimilarityScore =
          candidates.length > 0 && candidates[0] ? candidates[0].similarity : 0;

        span.setAttribute(SemanticAttributes.RAG_RETRIEVED_COUNT, candidates.length);
        span.setAttribute(SemanticAttributes.RAG_HIGHEST_SCORE, highestSimilarityScore);

        /* Step 4: Log metrics and handle fail-fast empty candidates */
        if (candidates.length === 0) {
          span.setAttribute(SemanticAttributes.RAG_INSUFFICIENT_EVIDENCE, true);
          this.logger.warnEvent(LogEvents.RETRIEVAL_NO_EVIDENCE, {
            queryLength: sanitizedQuery.length,
            similarityThreshold: params.similarityThreshold,
            traceId: params.traceId,
          });
        } else {
          this.logger.logEvent(LogEvents.RETRIEVAL_CANDIDATES_FOUND, {
            candidateCount: candidates.length,
            highestSimilarityScore,
            candidateChunkIds: candidates.map((c) => c.id),
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
      },
    );
  }
}
