import { Injectable, Inject, Optional } from '@nestjs/common';
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
import { AppConfigService } from '../../config/app-config.service';
import type {
  IQwenRerankerProvider,
  RerankCandidate,
} from '../interfaces/reranker-provider.interface';
import { RERANKER_PROVIDER } from '../interfaces/reranker-provider.interface';

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
  reranked?: boolean;
  rerankFallback?: boolean;
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
    private readonly appConfig: AppConfigService,
    @Optional()
    @Inject(RERANKER_PROVIDER)
    private readonly rerankerProvider?: IQwenRerankerProvider,
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
   * 5. Optionally invokes Qwen3-Reranker cross-encoder behind RERANKING_ENABLED feature flag
   * 6. Returns ranked candidate chunks with resilient fallback to vector search order
   */
  async retrieveCandidates(
    params: RetrievalQueryParams,
  ): Promise<RetrievalResult> {
    const isRerankingEnabled =
      Boolean(this.appConfig.rerankingEnabled) && Boolean(this.rerankerProvider);

    const requestedTopK = params.topK || 5;
    const initialVectorTopK = isRerankingEnabled
      ? Math.max(this.appConfig.rerankerCandidatesTopK || 30, requestedTopK)
      : requestedTopK;

    return AppTracer.traceSpan(
      'retrieval',
      {
        attributes: {
          [SemanticAttributes.RAG_TOP_K]: requestedTopK,
          'query.length': params.query?.length || 0,
          [SemanticAttributes.RAG_RERANK_ENABLED]: isRerankingEnabled,
        },
      },
      async (span) => {
        const sanitizedQuery = this.queryValidator.validate(params.query);

        this.logger.logEvent(LogEvents.RETRIEVAL_STARTED, {
          queryLength: sanitizedQuery.length,
          topK: requestedTopK,
          initialVectorTopK,
          rerankingEnabled: isRerankingEnabled,
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
        const rawCandidates = await AppTracer.traceSpan(
          'retrieval.vector_search',
          {
            attributes: {
              'vector.dimensions': queryVector.length,
              [SemanticAttributes.RAG_TOP_K]: initialVectorTopK,
            },
          },
          async (searchSpan) => {
            const results = await this.vectorSearchRepository.searchSimilarChunks(
              queryVector,
              {
                topK: initialVectorTopK,
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

        /* Step 4: Handle zero-candidate fast-fail */
        if (rawCandidates.length === 0) {
          span.setAttribute(SemanticAttributes.RAG_INSUFFICIENT_EVIDENCE, true);
          span.setAttribute(SemanticAttributes.RAG_RETRIEVED_COUNT, 0);
          span.setAttribute(SemanticAttributes.RAG_HIGHEST_SCORE, 0);

          this.logger.warnEvent(LogEvents.RETRIEVAL_NO_EVIDENCE, {
            queryLength: sanitizedQuery.length,
            similarityThreshold: params.similarityThreshold,
            traceId: params.traceId,
          });

          return {
            query: sanitizedQuery,
            queryVector,
            candidates: [],
            totalRetrieved: 0,
            highestSimilarityScore: 0,
            traceId: params.traceId,
          };
        }

        /* Step 5: Optional Cross-Encoder Reranking */
        let finalCandidates: CandidateChunk[] = rawCandidates.slice(0, requestedTopK);
        let rerankApplied = false;
        let rerankFallback = false;

        if (isRerankingEnabled && this.rerankerProvider) {
          try {
            finalCandidates = await AppTracer.traceSpan(
              'retrieval.rerank',
              {
                attributes: {
                  [SemanticAttributes.RAG_RERANK_ENABLED]: true,
                  [SemanticAttributes.RAG_RERANK_MODEL]: this.appConfig.rerankerModelName,
                  [SemanticAttributes.RAG_RERANK_CANDIDATES_IN]: rawCandidates.length,
                },
              },
              async (rerankSpan) => {
                this.logger.logEvent(LogEvents.RETRIEVAL_RERANK_STARTED, {
                  candidatesIn: rawCandidates.length,
                  model: this.appConfig.rerankerModelName,
                  traceId: params.traceId,
                });

                const rerankInput: RerankCandidate[] = rawCandidates.map((c) => ({
                  id: c.id,
                  content: c.content,
                }));

                const rerankResponse = await this.rerankerProvider!.rerank(
                  sanitizedQuery,
                  rerankInput,
                );

                const scoreMap = new Map<string, number>();
                for (const item of rerankResponse.results) {
                  scoreMap.set(item.id, item.relevanceScore);
                }

                // Stable sort descending by relevance score, preserving initial vector similarity order on ties
                const originalIndexMap = new Map<string, number>();
                rawCandidates.forEach((c, idx) => originalIndexMap.set(c.id, idx));

                const sorted = [...rawCandidates].sort((a, b) => {
                  const scoreA = scoreMap.get(a.id) ?? -Infinity;
                  const scoreB = scoreMap.get(b.id) ?? -Infinity;
                  if (scoreB !== scoreA) {
                    return scoreB - scoreA;
                  }
                  return (originalIndexMap.get(a.id) ?? 0) - (originalIndexMap.get(b.id) ?? 0);
                });

                // Update candidate similarity field to reflect reranked relevance score
                const scoredCandidates = sorted.map((c) => ({
                  ...c,
                  similarity: scoreMap.get(c.id) ?? c.similarity,
                }));

                const finalTopK = params.topK || this.appConfig.rerankerFinalTopK || 5;
                const selected = scoredCandidates.slice(0, finalTopK);

                rerankSpan.setAttribute(
                  SemanticAttributes.RAG_RERANK_CANDIDATES_OUT,
                  selected.length,
                );
                rerankSpan.setAttribute(
                  SemanticAttributes.RAG_RERANK_FALLBACK,
                  false,
                );
                rerankSpan.setAttribute(
                  SemanticAttributes.RAG_RERANK_DURATION_MS,
                  rerankResponse.durationMs,
                );

                this.logger.logEvent(LogEvents.RETRIEVAL_RERANK_COMPLETED, {
                  candidatesIn: rawCandidates.length,
                  candidatesOut: selected.length,
                  durationMs: rerankResponse.durationMs,
                  highestRerankScore: selected[0]?.similarity,
                  traceId: params.traceId,
                });

                rerankApplied = true;
                return selected;
              },
            );
          } catch (rerankError: any) {
            rerankFallback = true;
            this.logger.warnEvent(LogEvents.RETRIEVAL_RERANK_FALLBACK, {
              reason: rerankError.message,
              model: this.appConfig.rerankerModelName,
              fallbackCount: Math.min(rawCandidates.length, requestedTopK),
              traceId: params.traceId,
            });

            span.setAttribute(SemanticAttributes.RAG_RERANK_FALLBACK, true);
            // Fall back to original vector search order
            finalCandidates = rawCandidates.slice(0, requestedTopK);
          }
        }

        const highestSimilarityScore =
          finalCandidates.length > 0 && finalCandidates[0] ? finalCandidates[0].similarity : 0;

        span.setAttribute(SemanticAttributes.RAG_RETRIEVED_COUNT, finalCandidates.length);
        span.setAttribute(SemanticAttributes.RAG_HIGHEST_SCORE, highestSimilarityScore);

        this.logger.logEvent(LogEvents.RETRIEVAL_CANDIDATES_FOUND, {
          candidateCount: finalCandidates.length,
          highestSimilarityScore,
          candidateChunkIds: finalCandidates.map((c) => c.id),
          traceId: params.traceId,
        });

        return {
          query: sanitizedQuery,
          queryVector,
          candidates: finalCandidates,
          totalRetrieved: finalCandidates.length,
          highestSimilarityScore,
          traceId: params.traceId,
          reranked: rerankApplied,
          rerankFallback,
        };
      },
    );
  }
}
