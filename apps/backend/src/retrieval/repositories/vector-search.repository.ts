import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DocumentChunkEntity } from '../../ingestion/database/entities';

export interface CandidateChunk {
  id: string;
  versionId: string;
  chunkIndex: number;
  content: string;
  headingPath?: string;
  pageStart?: number;
  pageEnd?: number;
  metadataJson?: Record<string, unknown>;
  similarity: number;
}

export interface VectorSearchOptions {
  topK?: number;
  similarityThreshold?: number;
}

export interface KeywordSearchOptions {
  topK?: number;
}

@Injectable()
export class VectorSearchRepository {
  constructor(private readonly dataSource: DataSource) { }

  /**
   * Performs vector similarity search against document_chunks using pgvector cosine distance.
   *
   * @param {number[]} queryVector - Dense vector representation of query
   * @param {VectorSearchOptions} [options] - Search options (topK limit, similarity threshold)
   * @returns {Promise<CandidateChunk[]>} Candidate document chunks exceeding similarity threshold
   */
  async searchSimilarChunks(
    queryVector: number[],
    options?: VectorSearchOptions,
  ): Promise<CandidateChunk[]> {
    const topK = options?.topK ?? 5;
    const threshold = options?.similarityThreshold ?? 0.5;

    if (!queryVector?.length) {
      return [];
    }

    const vectorJson = JSON.stringify(queryVector);

    const similarityExpression =
      '1 - (documentChunk.embedding <=> CAST(:queryVector AS vector))';

    const rows = await this.dataSource
      .getRepository(DocumentChunkEntity)
      .createQueryBuilder('documentChunk')
      .select('documentChunk.id', 'id')
      .addSelect('documentChunk.versionId', 'versionId')
      .addSelect('documentChunk.chunkIndex', 'chunkIndex')
      .addSelect('documentChunk.content', 'content')
      .addSelect('documentChunk.headingPath', 'headingPath')
      .addSelect('documentChunk.pageStart', 'pageStart')
      .addSelect('documentChunk.pageEnd', 'pageEnd')
      .addSelect('documentChunk.metadataJson', 'metadataJson')
      .addSelect(similarityExpression, 'similarity')
      .where('documentChunk.embedding IS NOT NULL')
      .andWhere(`${similarityExpression} >= :threshold`)
      .setParameters({
        queryVector: vectorJson,
        threshold,
      })
      .orderBy('similarity', 'DESC')
      .limit(topK)
      .getRawMany();

    return rows.map((row) => ({
      id: row.id,
      versionId: row.versionId,
      chunkIndex: Number(row.chunkIndex),
      content: row.content,
      headingPath: row.headingPath ?? undefined,
      pageStart: row.pageStart ? Number(row.pageStart) : undefined,
      pageEnd: row.pageEnd ? Number(row.pageEnd) : undefined,
      metadataJson: row.metadataJson ?? undefined,
      similarity: Number(row.similarity),
    }));
  }

  /**
   * Performs sparse full-text keyword search against document_chunks using PostgreSQL websearch_to_tsquery and ts_rank_cd.
   *
   * @param {string} query - Natural language search query
   * @param {KeywordSearchOptions} [options] - Keyword search options (topK limit)
   * @returns {Promise<CandidateChunk[]>} Candidate document chunks matching keywords ranked by ts_rank_cd
   */
  async searchByKeywords(
    query: string,
    options?: KeywordSearchOptions,
  ): Promise<CandidateChunk[]> {
    const topK = options?.topK ?? 20;

    if (!query || query.trim().length === 0) {
      return [];
    }

    const trimmedQuery = query.trim();

    const rankExpression =
      "ts_rank_cd(to_tsvector('english', documentChunk.content), websearch_to_tsquery('english', :queryText))";

    const rows = await this.dataSource
      .getRepository(DocumentChunkEntity)
      .createQueryBuilder('documentChunk')
      .select('documentChunk.id', 'id')
      .addSelect('documentChunk.versionId', 'versionId')
      .addSelect('documentChunk.chunkIndex', 'chunkIndex')
      .addSelect('documentChunk.content', 'content')
      .addSelect('documentChunk.headingPath', 'headingPath')
      .addSelect('documentChunk.pageStart', 'pageStart')
      .addSelect('documentChunk.pageEnd', 'pageEnd')
      .addSelect('documentChunk.metadataJson', 'metadataJson')
      .addSelect(rankExpression, 'similarity')
      .where("to_tsvector('english', documentChunk.content) @@ websearch_to_tsquery('english', :queryText)")
      .setParameters({
        queryText: trimmedQuery,
      })
      .orderBy('similarity', 'DESC')
      .limit(topK)
      .getRawMany();

    return rows.map((row) => ({
      id: row.id,
      versionId: row.versionId,
      chunkIndex: Number(row.chunkIndex),
      content: row.content,
      headingPath: row.headingPath ?? undefined,
      pageStart: row.pageStart ? Number(row.pageStart) : undefined,
      pageEnd: row.pageEnd ? Number(row.pageEnd) : undefined,
      metadataJson: row.metadataJson ?? undefined,
      similarity: Number(row.similarity),
    }));
  }
}
