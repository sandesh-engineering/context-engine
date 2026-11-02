import { Injectable } from '@nestjs/common';
import { DataSource, Repository, IsNull } from 'typeorm';
import { DocumentChunkEntity } from '../entities/document-chunk.entity';

import * as crypto from 'crypto';
import { Domain } from '../../common/enums';
import { EmbeddingOutboxEntity } from '../entities/embedding-outbox.entity';

import { TraceContextPropagator } from '../../../common/telemetry';

type ChunkEmbedding = {
  chunkId: string;
  embedding: number[];
};

@Injectable()
export class DocumentChunksRepository {
  private readonly repository: Repository<DocumentChunkEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.repository = this.dataSource.getRepository(DocumentChunkEntity);
  }

  /**
   * Persists a batch of document chunk entities and writes an outbox event to embedding_outbox transactionally.
   *
   * @remarks
   * - Transactionally clears existing chunks for version on retry.
   * - Atomically persists new chunk entities and enqueues event in `embedding_outbox`.
   *
   * @param {string} versionId - Document version UUID
   * @param {Partial<DocumentChunkEntity>[]} chunks - Array of chunk entities to persist
   * @returns {Promise<DocumentChunkEntity[]>} Array of persisted chunk entities
   */
  async saveChunks(
    versionId: string,
    chunks: Partial<DocumentChunkEntity>[],
  ): Promise<DocumentChunkEntity[]> {
    return this.saveChunksWithOutbox(versionId, chunks);
  }

  /**
   * Transactionally persists document chunks and enqueues an outbox event into embedding_outbox.
   *
   * @param {string} versionId - Document version UUID
   * @param {Partial<DocumentChunkEntity>[]} chunks - Array of chunk entities to persist
   * @param {Record<string, unknown>} [traceMetadata] - Optional explicit trace context metadata
   * @returns {Promise<DocumentChunkEntity[]>} Array of saved chunk entities
   */
  async saveChunksWithOutbox(
    versionId: string,
    chunks: Partial<DocumentChunkEntity>[],
    traceMetadata?: Record<string, unknown>,
    jobId?: string,
  ): Promise<DocumentChunkEntity[]> {
    if (!chunks || chunks.length === 0) {
      return [];
    }

    return this.dataSource.transaction(async (manager) => {
      /* Clear existing chunks for version on retry */
      await manager.delete(DocumentChunkEntity, { versionId });

      const chunkEntities = chunks.map((chunk, index) =>
        manager.create(DocumentChunkEntity, {
          ...chunk,
          versionId,
          chunkIndex: chunk.chunkIndex ?? index,
        }),
      );

      const savedChunks = await manager.save(DocumentChunkEntity, chunkEntities);

      /* Inject active OpenTelemetry context into outbox metadata carrier */
      const metadata = TraceContextPropagator.injectToCarrier(
        traceMetadata ? { ...traceMetadata } : {},
      );

      /* Enqueue event in embedding_outbox table */
      const eventId = `evt_emb_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const embeddingOutboxEvent = manager.create(EmbeddingOutboxEntity, {
        event_id: eventId,
        topic: 'document.embedding.v1',
        version: 1,
        domain: Domain.DOCUMENT,
        retries: 0,
        processed: false,
        processed_at: null,
        failed_at: null,
        metadata: Object.keys(metadata).length > 0 ? (metadata as Record<string, unknown>) : null,
        payload: {
          versionId,
          jobId,
          chunkCount: savedChunks.length,
          chunkIds: savedChunks.map((c) => c.id),
        },
      });

      await manager.save(EmbeddingOutboxEntity, embeddingOutboxEvent);

      return savedChunks;
    });
  }

  /**
   * Fetches chunks for a document version that have not yet received vector embeddings.
   *
   * @remarks
   * - Restricts query to records where `version_id = :versionId AND embedding IS NULL`.
   * - Orders by `chunk_index ASC` to maintain chunk sequence during embedding generation.
   *
   * @param {string} versionId - Document version UUID
   * @param {number} [limit=20] - Maximum number of unembedded chunks to retrieve per batch
   * @returns {Promise<DocumentChunkEntity[]>} Array of unembedded chunk entities
   */
  async fetchUnembeddedChunks(
    versionId: string,
    limit = 20,
  ): Promise<DocumentChunkEntity[]> {
    return this.repository.find({
      where: {
        versionId,
        embedding: IsNull(),
      },
      order: {
        chunkIndex: 'ASC',
      },
      take: limit,
    });
  }

  /**
   * Updates vector embeddings for a batch of document chunks.
   *
   * @param {{ chunkId: string; embedding: number[] }[]} chunkEmbeddings - Array of chunk ID and embedding vector pairs
   * @returns {Promise<void>}
   */
  async updateBatchEmbeddings(
    chunkEmbeddings: ChunkEmbedding[],
  ): Promise<void> {
    if (chunkEmbeddings.length === 0) {
      return;
    }

    const values: string[] = [];
    const params: unknown[] = [];

    for (const { chunkId, embedding } of chunkEmbeddings) {
      const idParam = `$${params.length + 1}`;
      params.push(chunkId);

      const embeddingParam = `$${params.length + 1}`;
      params.push(JSON.stringify(embedding));

      values.push(`(${idParam}::uuid, ${embeddingParam}::vector)`);
    }

    const sql = `
    UPDATE document_chunks AS dc
    SET embedding = v.embedding
    FROM (
      VALUES
        ${values.join(',\n        ')}
    ) AS v(id, embedding)
    WHERE dc.id = v.id
  `;

    await this.dataSource.query(sql, params);
  }

  /**
   * Retrieves total chunk count and embedded chunk count for a document version.
   *
   * @param {string} versionId - Document version UUID
   * @returns {Promise<{ total: number; embedded: number }>} Counts of total and embedded chunks
   */
  async countChunkStats(
    versionId: string,
  ): Promise<{ total: number; embedded: number }> {
    const total = await this.repository.count({ where: { versionId } });
    const unembedded = await this.repository.count({
      where: { versionId, embedding: IsNull() },
    });
    return {
      total,
      embedded: total - unembedded,
    };
  }

  /**
   * Retrieves all chunks for a document version ordered by sequential index.
   *
   * @param {string} versionId - Document version UUID
   * @returns {Promise<DocumentChunkEntity[]>} Array of document chunk entities
   */
  async fetchChunksByVersionId(versionId: string): Promise<DocumentChunkEntity[]> {
    return this.repository.find({
      where: { versionId },
      order: { chunkIndex: 'ASC' },
    });
  }
}
