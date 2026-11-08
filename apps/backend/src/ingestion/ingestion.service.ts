import {
  Injectable,
  Inject,
  InternalServerErrorException,
  BadRequestException,
  PayloadTooLargeException,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable, Transform, pipeline } from 'stream';
import type {
  IObjectStorageService,
  StreamUploadResult,
} from './storage/interfaces/object-storage.interface';
import {
  OBJECT_STORAGE_SERVICE,
} from './storage/interfaces/object-storage.interface';
import { IngestionPersistenceService } from './services/ingestion-persistence.service';
import { StoragePathBuilder } from './services/storage-path-builder.service';
import { IngestionJobsRepository } from './database/repositories/ingestion-jobs.repository';
import { DocumentSourceType, IngestionJobStatus, IngestionJobStage } from './common/enums';
import { AppTracer, SemanticAttributes } from '../common/telemetry';
import { StructuredLogger, LogEvents } from '../common/logger';
import { fileTypeStream } from "file-type"
import { randomUUID } from 'crypto';

/* Mirrors the DOCUMENT_MAX_SIZE_BYTES default in env.validation.ts (100 MB) */
const DEFAULT_MAX_DOCUMENT_SIZE_BYTES = 104857600;
const DEFAULT_RECENT_JOBS_LIMIT = 30;
const MAX_RECENT_JOBS_LIMIT = 100;

export interface DocumentUploadStreamParams {
  stream: Readable;
  originalFilename: string;
  title: string;
  maxSizeBytes?: number;
  traceId?: string;
}

export interface DocumentUploadResponse {
  documentId: string;
  versionId: string;
  jobId: string;
  status: IngestionJobStatus;
  stage: IngestionJobStage;
  storageKey: string;
  sha256Digest: string;
  byteSize: number;
  createdAt: Date;
  /** True when identical bytes were already uploaded; the existing document is returned. */
  duplicate?: boolean;
}

export interface IngestionJobItem {
  id: string;
  title?: string;
  filename?: string;
  url?: string;
  sourceType?: 'FILE' | 'URL';
  status: string;
  createdAt: string;
  byteSize?: number;
  /** Reason of the last failed attempt (FAILED jobs only). */
  errorMessage?: string;
}

export interface DocumentFile {
  stream: Readable;
  mimeType: string;
  filename: string;
  byteSize: number;
}

@Injectable()
export class IngestionService {
  private readonly logger = new StructuredLogger(IngestionService.name);
  private readonly maxFileSizeBytes: number;

  constructor(
    @Inject(OBJECT_STORAGE_SERVICE)
    private readonly storageService: IObjectStorageService,
    private readonly persistenceService: IngestionPersistenceService,
    private readonly jobsRepository: IngestionJobsRepository,
    private readonly pathBuilder: StoragePathBuilder,
    private readonly configService: ConfigService,
  ) {
    /* Same key and default as the env schema and the worker's TempStorageManager */
    this.maxFileSizeBytes =
      this.configService.get<number>('DOCUMENT_MAX_SIZE_BYTES') || DEFAULT_MAX_DOCUMENT_SIZE_BYTES;
  }

  /**
   * Maximum accepted upload size in bytes.
   */
  get maxUploadBytes(): number {
    return this.maxFileSizeBytes;
  }

  /**
   * Retrieves recent ingestion jobs formatted for client consumers.
   *
   * @param {number} [limit=30] - Requested page size, clamped to 1..MAX_RECENT_JOBS_LIMIT
   */
  async getRecentJobs(limit: number = DEFAULT_RECENT_JOBS_LIMIT): Promise<IngestionJobItem[]> {
    const safeLimit = Number.isInteger(limit)
      ? Math.min(Math.max(limit, 1), MAX_RECENT_JOBS_LIMIT)
      : DEFAULT_RECENT_JOBS_LIMIT;
    const jobs = await this.jobsRepository.findRecentJobs(safeLimit);
    return jobs.map((job) => ({
      id: job.id,
      title: job.version?.document?.title || job.version?.originalFilename || 'Document',
      filename: job.version?.originalFilename,
      sourceType:
        job.version?.document?.sourceType === DocumentSourceType.EXTERNAL_URL
          ? 'URL'
          : 'FILE',
      status: job.status,
      createdAt: job.createdAt ? job.createdAt.toISOString() : new Date().toISOString(),
      byteSize: Number(job.version?.byteSize || 0),
      errorMessage: job.status === IngestionJobStatus.FAILED ? job.errorMessage : undefined,
    }));
  }

  /**
   * Opens the stored raw file of a document version.
   *
   * @remarks
   * - Returns a stream; the binary is never buffered in memory.
   *
   * @param {string} versionId - Document version identifier (from a chat citation)
   * @returns {Promise<DocumentFile>} Object stream plus the metadata needed for response headers
   * @throws {NotFoundException} Throws if the version does not exist
   * @throws {InternalServerErrorException} Throws if the storage backend cannot stream objects
   */
  async getDocumentFile(versionId: string): Promise<DocumentFile> {
    const version = await this.jobsRepository.findVersionById(versionId);
    if (!version) {
      throw new NotFoundException('Document not found');
    }
    if (!this.storageService.getObjectStream) {
      throw new InternalServerErrorException('Configured storage does not support reading objects');
    }

    const stream = await this.storageService.getObjectStream(version.storageKey);
    return {
      stream,
      mimeType: version.mimeType,
      filename: version.originalFilename,
      byteSize: Number(version.byteSize),
    };
  }

  /**
   * Orchestrates the complete direct document streaming ingestion intake pipeline.
   *
   * @remarks
   * - Performs streaming magic byte and size validation without disk spooling.
   * - Stages immutable raw binary to object storage with bounded retries and exponential backoff.
   * - Atomically persists metadata and Transactional Outbox event in PostgreSQL.
   * - Performs compensating storage deletion if the database transaction fails.
   *
   * @param {DocumentUploadStreamParams} params - Upload stream and document metadata
   * @returns {Promise<DocumentUploadResponse>} Ingestion job metadata and accepted status
   * @throws {BadRequestException} Throws if title or filename is missing, or magic bytes are invalid
   * @throws {PayloadTooLargeException} Throws if stream exceeds configured byte limit
   * @throws {InternalServerErrorException} Throws if downstream database persistence fails
   *
   * @example
   * ```ts
   * const response = await ingestionService.uploadDocument({
   *   stream: fileStream,
   *   originalFilename: 'whitepaper.pdf',
   *   title: 'Whitepaper 2026',
   * });
   * ```
   */
  async uploadDocument(
    params: DocumentUploadStreamParams,
  ): Promise<DocumentUploadResponse> {
    return AppTracer.traceSpan(
      'document.create',
      {
        attributes: {
          'document.title': params.title,
          'document.filename': params.originalFilename,
        },
      },
      async (span) => {
        this.validateUploadParameters(params);

        /* Random ids: concurrent uploads must never share (and overwrite) a storage key */
        const tempDocId = `doc_${randomUUID()}`;
        const tempVerId = `ver_${randomUUID()}`;
        const storageKey = this.pathBuilder.buildRawDocumentKey(tempDocId, tempVerId);

        this.logger.logEvent(LogEvents.INGESTION_INTAKE_STARTED, {
          title: params.title,
          originalFilename: params.originalFilename,
          storageKey,
          traceId: params.traceId,
        });

        /* Step 1: Validate stream headers and wrap in counting stream */
        const validatedResult = await this.validateStream(params.stream, params.maxSizeBytes);

        /* Step 2: Stream bytes to resilient object storage */
        const uploadResult = await this.stageToStorage(
          storageKey,
          validatedResult.stream,
          params,
        );

        /* Steps 3-4 share the catch below, so a failed lookup or commit removes the staged object */
        try {
          /* Step 3: Identical bytes already ingested (or in progress): reuse instead of indexing a duplicate */
          const existing = await this.jobsRepository.findReusableJobByDigest(uploadResult.sha256Digest);
          if (existing?.version?.document) {
            await this.deleteStagedObject(storageKey, params.traceId);
            this.logger.logEvent(LogEvents.INGESTION_INTAKE_COMPLETED, {
              documentId: existing.version.document.id,
              versionId: existing.version.id,
              jobId: existing.id,
              duplicate: true,
              traceId: params.traceId,
            });
            return {
              documentId: existing.version.document.id,
              versionId: existing.version.id,
              jobId: existing.id,
              status: existing.status,
              stage: existing.stage,
              storageKey: existing.version.storageKey,
              sha256Digest: existing.version.sha256Digest,
              byteSize: Number(existing.version.byteSize),
              createdAt: existing.version.document.createdAt,
              duplicate: true,
            };
          }

          /* Step 4: Atomically commit Document, Version, IngestionJob, Outbox in DB */
          const persisted = await this.persistenceService.persistUploadedDocument({
            title: params.title,
            storageKey,
            sha256Digest: uploadResult.sha256Digest,
            byteSize: uploadResult.byteSize,
            originalFilename: params.originalFilename,
            mimeType: validatedResult.mimeType,
            metadata: {
              traceId: params.traceId,
              source: 'direct_upload',
            },
          });

          span.setAttribute(SemanticAttributes.KE_JOB_ID, persisted.job.id);
          span.setAttribute(SemanticAttributes.KE_DOCUMENT_ID, persisted.document.id);
          span.setAttribute(SemanticAttributes.KE_VERSION_ID, persisted.version.id);

          this.logger.logEvent(LogEvents.INGESTION_INTAKE_COMPLETED, {
            documentId: persisted.document.id,
            versionId: persisted.version.id,
            jobId: persisted.job.id,
            storageKey,
            traceId: params.traceId,
          });

          return {
            documentId: persisted.document.id,
            versionId: persisted.version.id,
            jobId: persisted.job.id,
            status: persisted.job.status,
            stage: persisted.job.stage,
            storageKey,
            sha256Digest: uploadResult.sha256Digest,
            byteSize: uploadResult.byteSize,
            createdAt: persisted.document.createdAt,
          };
        } catch (dbError) {
          /* Step 5: Consistency Handling - Execute compensating storage deletion on DB failure */
          this.logger.logError(LogEvents.INGESTION_INTAKE_FAILED, dbError, {
            storageKey,
            traceId: params.traceId,
          });
          await this.compensateStorageRollback(storageKey, params.traceId, dbError);
          throw new InternalServerErrorException(
            'Failed to record document metadata after storage staging',
          );
        }
      },
    );
  }

  /**
   * Validates presence of mandatory business parameters.
   */
  private validateUploadParameters(params: DocumentUploadStreamParams): void {
    if (!params.title || params.title.trim().length === 0) {
      throw new BadRequestException('Document title is required for upload');
    }
    if (!params.originalFilename || params.originalFilename.trim().length === 0) {
      throw new BadRequestException('Original filename is required for upload');
    }
  }

  /**
   * Validates file stream type using file-type stream detection and enforces size bounds.
   */
  private async validateStream(
    stream: Readable,
    customMaxBytes?: number,
  ): Promise<{ stream: Readable; mimeType: string }> {
    const maxBytes = customMaxBytes || this.maxFileSizeBytes;

    let fts;
    try {
      fts = await fileTypeStream(Readable.toWeb(stream));
    } catch (err: any) {
      stream.destroy();
      throw err;
    }

    if (!fts.fileType || fts.fileType.mime !== 'application/pdf') {
      stream.destroy();
      throw new BadRequestException('Invalid file format: Only valid PDF documents are allowed');
    }

    let bytesRead = 0;
    const sizeLimiter = new Transform({
      transform(chunk, encoding, callback) {
        bytesRead += chunk.length;
        if (bytesRead > maxBytes) {
          return callback(
            new PayloadTooLargeException(
              `File size limit exceeded: Maximum allowed is ${maxBytes} bytes, received ${bytesRead} bytes`,
            ),
          );
        }
        callback(null, chunk);
      },
    });

    /* pipeline (not pipe) forwards a source error, such as a client disconnect, to sizeLimiter,
       so the storage upload rejects and aborts its multipart upload instead of waiting forever */
    const nodeStream = pipeline(Readable.fromWeb(fts), sizeLimiter, () => {
      /* Errors surface through nodeStream to the storage adapter */
    });

    return {
      stream: nodeStream,
      mimeType: fts.fileType.mime,
    };
  }

  /**
   * Streams verified bytes into object storage uploader.
   */
  private async stageToStorage(
    storageKey: string,
    stream: Readable,
    params: DocumentUploadStreamParams,
  ): Promise<StreamUploadResult> {
    try {
      if (typeof this.storageService.streamToStorage === 'function') {
        return await this.storageService.streamToStorage(storageKey, stream, {
          metadata: {
            originalFilename: encodeURIComponent(params.originalFilename),
          },
        });
      }
      throw new Error('Configured storage service does not support stream staging');
    } catch (uploadError) {
      this.logger.error('Failed streaming document to object storage', {
        storageKey,
        traceId: params.traceId,
        error: uploadError instanceof Error ? uploadError.message : String(uploadError),
      });
      throw uploadError;
    }
  }

  /**
   * Deletes a freshly staged object that turned out to duplicate an existing upload.
   */
  private async deleteStagedObject(storageKey: string, traceId: string | undefined): Promise<void> {
    try {
      await this.storageService.deleteObject(storageKey);
    } catch (cleanupError) {
      this.logger.error('Failed deleting staged duplicate upload', {
        storageKey,
        traceId,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
  }

  /**
   * Executes compensating deletion when downstream database persistence fails.
   */
  private async compensateStorageRollback(
    storageKey: string,
    traceId: string | undefined,
    dbError: unknown,
  ): Promise<void> {
    this.logger.error('Database transaction failed. Initiating compensating storage deletion.', {
      storageKey,
      traceId,
      error: dbError instanceof Error ? dbError.message : String(dbError),
    });

    try {
      await this.storageService.deleteObject(storageKey);
    } catch (cleanupError) {
      this.logger.error('Failed compensating deletion of orphaned storage object', {
        storageKey,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
  }
}
