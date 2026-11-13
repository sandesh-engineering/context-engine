import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { DocumentChunkEntity } from '../../ingestion/database/entities';

export interface CandidateChunk {
  id: string;
  versionId: string;
  chunkIndex: number;
  content: string;
  headingPath?: string;
  /* Title of the parent document (falls back to the uploaded filename) */
  documentTitle?: string;
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
    const topK = options?.topK ?? 20;
    const threshold = options?.similarityThreshold ?? 0.5;

    if (!queryVector?.length) {
      return [];
    }

    const vectorJson = JSON.stringify(queryVector);

    /* Order by the raw cosine distance (<=>) so PostgreSQL can use the HNSW index
       (vector_cosine_ops); similarity = 1 - distance is computed afterwards */
    const distanceExpression = 'documentChunk.embedding <=> CAST(:queryVector AS vector)';

    const rows = await this.dataSource
      .getRepository(DocumentChunkEntity)
      .createQueryBuilder('documentChunk')
      .leftJoin('documentChunk.version', 'version')
      .leftJoin('version.document', 'document')
      .select('documentChunk.id', 'id')
      .addSelect('documentChunk.versionId', 'versionId')
      .addSelect('documentChunk.chunkIndex', 'chunkIndex')
      .addSelect('documentChunk.content', 'content')
      .addSelect('documentChunk.headingPath', 'headingPath')
      .addSelect('COALESCE(document.title, version.originalFilename)', 'documentTitle')
      .addSelect('documentChunk.pageStart', 'pageStart')
      .addSelect('documentChunk.pageEnd', 'pageEnd')
      .addSelect('documentChunk.metadataJson', 'metadataJson')
      .addSelect(distanceExpression, 'distance')
      .where('documentChunk.embedding IS NOT NULL')
      .andWhere(`${distanceExpression} <= :maxDistance`)
      .setParameters({
        queryVector: vectorJson,
        maxDistance: 1 - threshold,
      })
      .orderBy('distance', 'ASC')
      .limit(topK)
      .getRawMany();

    return rows.map((row) => ({
      id: row.id,
      versionId: row.versionId,
      chunkIndex: Number(row.chunkIndex),
      content: row.content,
      headingPath: row.headingPath ?? undefined,
      documentTitle: row.documentTitle ?? undefined,
      pageStart: row.pageStart ? Number(row.pageStart) : undefined,
      pageEnd: row.pageEnd ? Number(row.pageEnd) : undefined,
      metadataJson: row.metadataJson ?? undefined,
      similarity: 1 - Number(row.distance),
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
      .leftJoin('documentChunk.version', 'version')
      .leftJoin('version.document', 'document')
      .select('documentChunk.id', 'id')
      .addSelect('documentChunk.versionId', 'versionId')
      .addSelect('documentChunk.chunkIndex', 'chunkIndex')
      .addSelect('documentChunk.content', 'content')
      .addSelect('documentChunk.headingPath', 'headingPath')
      .addSelect('COALESCE(document.title, version.originalFilename)', 'documentTitle')
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
      documentTitle: row.documentTitle ?? undefined,
      pageStart: row.pageStart ? Number(row.pageStart) : undefined,
      pageEnd: row.pageEnd ? Number(row.pageEnd) : undefined,
      metadataJson: row.metadataJson ?? undefined,
      similarity: Number(row.similarity),
    }));
  }
}
