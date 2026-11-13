import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
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
  title: string;
  storageKey: string;
  sha256Digest: string;
  byteSize: number;
  originalFilename: string;
  mimeType: string;
  metadata?: Record<string, unknown>;
}

export type PersistVersionParams = Omit<PersistDocumentParams, 'title'>;

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
   *   title: 'Report.pdf',
   *   storageKey: 'documents/doc_123/versions/ver_456/raw.bin',
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

      /* The first version answers as soon as its chunks are embedded, as before versioning */
      savedDocument.currentVersionId = savedVersion.id;
      await manager.update(DocumentEntity, savedDocument.id, { currentVersionId: savedVersion.id });

      return this.enqueueIngestion(manager, savedDocument, savedVersion, params);
    });
  }

  /**
   * Atomically records a new version of an existing document, with its ingestion job and outbox event.
   *
   * @remarks
   * - The document row is locked, so concurrent uploads get consecutive version numbers.
   * - The current version does not change here; it moves only once the new version is fully indexed.
   *
   * @param {string} documentId - Document the upload replaces
   * @param {PersistVersionParams} params - Stored object attributes and payload metadata
   * @returns {Promise<PersistDocumentResult>} Created database records
   * @throws {NotFoundException} Throws if the document does not exist (e.g. deleted mid-upload)
   */
  async persistNewVersion(
    documentId: string,
    params: PersistVersionParams,
  ): Promise<PersistDocumentResult> {
    return this.dataSource.transaction(async (manager) => {
      const document = await manager.findOne(DocumentEntity, {
        where: { id: documentId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!document) {
        throw new NotFoundException('Document not found');
      }

      const { maxVersion } = (await manager
        .createQueryBuilder(DocumentVersionEntity, 'version')
        .select('MAX(version.versionNumber)', 'maxVersion')
        .where('version.documentId = :documentId', { documentId })
        .getRawOne<{ maxVersion: number | null }>()) ?? { maxVersion: null };

      const version = manager.create(DocumentVersionEntity, {
        documentId,
        versionNumber: Number(maxVersion ?? 0) + 1,
        storageKey: params.storageKey,
        sha256Digest: params.sha256Digest,
        byteSize: params.byteSize,
        mimeType: params.mimeType,
        originalFilename: params.originalFilename,
      });
      const savedVersion = await manager.save(DocumentVersionEntity, version);

      return this.enqueueIngestion(manager, document, savedVersion, params);
    });
  }

  /**
   * Inserts the ingestion job checkpoint and its outbox event inside the caller's transaction.
   */
  private async enqueueIngestion(
    manager: EntityManager,
    document: DocumentEntity,
    version: DocumentVersionEntity,
    params: PersistVersionParams,
  ): Promise<PersistDocumentResult> {
    /* Initial ingestion job checkpoint */
    const job = manager.create(IngestionJobEntity, {
      versionId: version.id,
      status: IngestionJobStatus.PENDING,
      stage: IngestionJobStage.SOURCE_READY,
      attemptCount: 0,
    });
    const savedJob = await manager.save(IngestionJobEntity, job);

    /* Inject active OpenTelemetry context into outbox metadata carrier */
    const metadata = TraceContextPropagator.injectToCarrier(
      params.metadata ? { ...params.metadata } : {},
    );

    /* Transactional outbox event in ingestion_outbox table */
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
        documentId: document.id,
        versionId: version.id,
        jobId: savedJob.id,
        storageKey: params.storageKey,
        sha256Digest: params.sha256Digest,
        byteSize: params.byteSize,
        mimeType: params.mimeType,
        originalFilename: params.originalFilename,
      },
    });
    const savedOutbox = await manager.save(IngestionOutboxEntity, outboxEvent);

    this.logger.logEvent('document.persist.completed', {
      documentId: document.id,
      versionId: version.id,
      versionNumber: version.versionNumber,
      jobId: savedJob.id,
      eventId: savedOutbox.event_id,
    });

    return {
      document,
      version,
      job: savedJob,
      outboxEvent: savedOutbox,
    };
  }
}

