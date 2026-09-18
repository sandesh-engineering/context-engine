import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import {
  DocumentEntity,
  DocumentVersionEntity,
  IngestionJobEntity,
  OutboxEventEntity,
} from '../database/entities';
import {
  DocumentSourceType,
  IngestionJobStatus,
  IngestionJobStage,
  SagaDomain,
} from '../common/enums';

export interface PersistDocumentParams {
  tenantId: string;
  title: string;
  storageKey: string;
  sha256Digest: string;
  byteSize: number;
  originalFilename: string;
  mimeType: string;
  metadata?: Record<string, unknown>;
}

export interface PersistDocumentResult {
  document: DocumentEntity;
  version: DocumentVersionEntity;
  job: IngestionJobEntity;
  outboxEvent: OutboxEventEntity;
}

@Injectable()
export class IngestionPersistenceService {
  private readonly logger = new Logger(IngestionPersistenceService.name);

  constructor(private readonly dataSource: DataSource) {}

  /**
   * Atomically records Document, DocumentVersion, IngestionJob, and OutboxEvent in PostgreSQL.
   *
   * @remarks
   * - Leverages database-generated UUIDs for entity identifiers.
   * - Guarantees transactional consistency between local state and message publishing.
   *
   * @param {PersistDocumentParams} params - Entity attributes and payload metadata
   * @returns {Promise<PersistDocumentResult>} Created database records
   * @throws {Error} Throws if database connection fails or transaction deadlocks
   *
   * @example
   * ```ts
   * const result = await persistenceService.persistUploadedDocument({
   *   tenantId: 'ten_123',
   *   title: 'Report.pdf',
   *   storageKey: 'tenants/ten_123/...',
   *   sha256Digest: 'e3b0c442...',
   *   byteSize: 1024,
   *   originalFilename: 'Report.pdf',
   *   mimeType: 'application/pdf',
   * });
   * ```
   */
  async persistUploadedDocument(
    params: PersistDocumentParams,
  ): Promise<PersistDocumentResult> {
    return this.dataSource.transaction(async (manager) => {
      /* 1. Insert parent logical document using database-generated UUID */
      const document = manager.create(DocumentEntity, {
        tenantId: params.tenantId,
        title: params.title,
        sourceType: DocumentSourceType.DIRECT_UPLOAD,
      });
      const savedDocument = await manager.save(DocumentEntity, document);

      /* 2. Insert physical document version */
      const version = manager.create(DocumentVersionEntity, {
        documentId: savedDocument.id,
        versionNumber: 1,
        storageKey: params.storageKey,
        sha256Digest: params.sha256Digest,
        byteSize: params.byteSize,
        mimeType: params.mimeType,
        originalFilename: params.originalFilename,
      });
      const savedVersion = await manager.save(DocumentVersionEntity, version);

      /* 3. Insert initial ingestion job checkpoint */
      const job = manager.create(IngestionJobEntity, {
        versionId: savedVersion.id,
        status: IngestionJobStatus.PENDING,
        stage: IngestionJobStage.AVAILABLE,
        attemptCount: 0,
      });
      const savedJob = await manager.save(IngestionJobEntity, job);

      /* 4. Insert transactional outbox event */
      const eventId = `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const outboxEvent = manager.create(OutboxEventEntity, {
        event_id: eventId,
        topic: 'document.ingestion.v1',
        version: 1,
        saga_id: savedDocument.id,
        domain: SagaDomain.DOCUMENT,
        retries: 0,
        processed: false,
        processed_at: null,
        failed_at: null,
        metadata: params.metadata || null,
        payload: {
          documentId: savedDocument.id,
          versionId: savedVersion.id,
          jobId: savedJob.id,
          tenantId: params.tenantId,
          storageKey: params.storageKey,
          sha256Digest: params.sha256Digest,
          byteSize: params.byteSize,
          mimeType: params.mimeType,
          originalFilename: params.originalFilename,
        },
      });
      const savedOutbox = await manager.save(OutboxEventEntity, outboxEvent);

      this.logger.log('Atomically committed document and outbox event', {
        documentId: savedDocument.id,
        versionId: savedVersion.id,
        jobId: savedJob.id,
        outboxId: savedOutbox.id,
        tenantId: params.tenantId,
      });

      return {
        document: savedDocument,
        version: savedVersion,
        job: savedJob,
        outboxEvent: savedOutbox,
      };
    });
  }
}
