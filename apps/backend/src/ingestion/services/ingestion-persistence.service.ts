import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import * as crypto from 'crypto';
import {
  DocumentEntity,
  DocumentVersionEntity,
  IngestionJobEntity,
  IngestionOutboxEntity,
} from '../database/entities';
import {
  DocumentSourceType,
  IngestionJobStatus,
  IngestionJobStage,
  Domain,
} from '../common/enums';
import { TraceContextPropagator } from '../../common/telemetry';
import { StructuredLogger, LogEvents } from '../../common/logger';

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
  outboxEvent: IngestionOutboxEntity;
}

@Injectable()
export class IngestionPersistenceService {
  private readonly logger = new StructuredLogger(IngestionPersistenceService.name);

  constructor(private readonly dataSource: DataSource) { }

  /**
   * Atomically records Document, DocumentVersion, IngestionJob, and IngestionOutboxEntity in PostgreSQL.
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
        stage: IngestionJobStage.SOURCE_READY,
        attemptCount: 0,
      });
      const savedJob = await manager.save(IngestionJobEntity, job);

      /* 4. Inject active OpenTelemetry context into outbox metadata carrier */
      const metadata = TraceContextPropagator.injectToCarrier(
        params.metadata ? { ...params.metadata } : {},
      );

      /* 5. Insert transactional outbox event in ingestion_outbox table */
      const eventId = `evt_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
      const outboxEvent = manager.create(IngestionOutboxEntity, {
        event_id: eventId,
        topic: 'document.ingestion.v1',
        version: 1,
        domain: Domain.DOCUMENT,
        retries: 0,
        processed: false,
        processed_at: null,
        failed_at: null,
        metadata: Object.keys(metadata).length > 0 ? (metadata as Record<string, unknown>) : null,
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
      const savedOutbox = await manager.save(IngestionOutboxEntity, outboxEvent);

      this.logger.logEvent('document.persist.completed', {
        documentId: savedDocument.id,
        versionId: savedVersion.id,
        jobId: savedJob.id,
        eventId: savedOutbox.event_id,
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

