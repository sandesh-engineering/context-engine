import {
  Injectable,
  Inject,
  Logger,
  InternalServerErrorException,
  BadRequestException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Readable } from 'stream';
import type {
  IObjectStorageService,
} from './storage/interfaces/object-storage.interface';
import {
  OBJECT_STORAGE_SERVICE,
} from './storage/interfaces/object-storage.interface';
import { IngestionPersistenceService } from './services/ingestion-persistence.service';
import { StoragePathBuilder } from './services/storage-path-builder.service';
import { StreamValidator, ValidatedStreamResult } from './validation/stream-validator';
import { S3StorageAdapter, StreamUploadResult } from './storage/adapters/s3-storage.adapter';
import { IngestionJobStatus, IngestionJobStage } from './common/enums';

export interface DocumentUploadStreamParams {
  stream: Readable;
  originalFilename: string;
  title: string;
  tenantId: string;
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
}

@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);
  private readonly maxFileSizeBytes: number;

  constructor(
    @Inject(OBJECT_STORAGE_SERVICE)
    private readonly storageService: IObjectStorageService,
    private readonly persistenceService: IngestionPersistenceService,
    private readonly pathBuilder: StoragePathBuilder,
    private readonly configService: ConfigService,
  ) {
    /* Read max document size from config or enforce standard 500 MB limit */
    this.maxFileSizeBytes =
      this.configService.get<number>('MAX_DOCUMENT_SIZE_BYTES') || 500 * 1024 * 1024;
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
   * @param {DocumentUploadStreamParams} params - Upload stream, tenant context, and document metadata
   * @returns {Promise<DocumentUploadResponse>} Ingestion job metadata and accepted status
   * @throws {BadRequestException} Throws if tenantId, title, or filename is missing, or magic bytes are invalid
   * @throws {PayloadTooLargeException} Throws if stream exceeds configured byte limit
   * @throws {InternalServerErrorException} Throws if downstream database persistence fails
   *
   * @example
   * ```ts
   * const response = await ingestionService.uploadDocument({
   *   stream: fileStream,
   *   originalFilename: 'whitepaper.pdf',
   *   title: 'Whitepaper 2026',
   *   tenantId: 'ten_abc123',
   * });
   * ```
   */
  async uploadDocument(
    params: DocumentUploadStreamParams,
  ): Promise<DocumentUploadResponse> {
    this.validateUploadParameters(params);

    const tempDocId = `doc_${Date.now()}`;
    const tempVerId = `ver_${Date.now()}`;
    const storageKey = this.pathBuilder.buildRawDocumentKey(
      params.tenantId,
      tempDocId,
      tempVerId,
    );

    this.logger.log('Starting document upload intake', {
      tenantId: params.tenantId,
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

    /* Step 3: Atomically commit Document, Version, IngestionJob, Outbox in DB */
    try {
      const persisted = await this.persistenceService.persistUploadedDocument({
        tenantId: params.tenantId,
        title: params.title,
        storageKey,
        sha256Digest: uploadResult.sha256Digest,
        byteSize: uploadResult.byteSize,
        originalFilename: params.originalFilename,
        mimeType: validatedResult.sniffResult.mimeType,
        metadata: {
          traceId: params.traceId,
          source: 'direct_upload',
        },
      });

      this.logger.log('Document ingestion intake completed successfully', {
        documentId: persisted.document.id,
        versionId: persisted.version.id,
        jobId: persisted.job.id,
        storageKey,
        tenantId: params.tenantId,
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
      /* Step 4: Consistency Handling - Execute compensating storage deletion on DB failure */
      await this.compensateStorageRollback(storageKey, params.tenantId, params.traceId, dbError);
      throw new InternalServerErrorException(
        'Failed to record document metadata after storage staging',
      );
    }
  }

  /**
   * Validates presence of mandatory business parameters.
   */
  private validateUploadParameters(params: DocumentUploadStreamParams): void {
    if (!params.tenantId || params.tenantId.trim().length === 0) {
      throw new BadRequestException('Tenant ID is required for document upload');
    }
    if (!params.title || params.title.trim().length === 0) {
      throw new BadRequestException('Document title is required for upload');
    }
    if (!params.originalFilename || params.originalFilename.trim().length === 0) {
      throw new BadRequestException('Original filename is required for upload');
    }
  }

  /**
   * Executes stream magic byte sniffing and byte counting wrapping.
   */
  private async validateStream(
    stream: Readable,
    customMaxBytes?: number,
  ): Promise<ValidatedStreamResult> {
    const maxBytes = customMaxBytes || this.maxFileSizeBytes;
    return StreamValidator.validateAndWrapStream(stream, { maxBytes });
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
      if ('streamToStorage' in this.storageService) {
        return await (this.storageService as S3StorageAdapter).streamToStorage(
          storageKey,
          stream,
          {
            metadata: {
              tenantId: params.tenantId,
              originalFilename: encodeURIComponent(params.originalFilename),
            },
          },
        );
      }
      throw new Error('Configured storage service does not support stream staging');
    } catch (uploadError) {
      this.logger.error('Failed streaming document to object storage', {
        storageKey,
        tenantId: params.tenantId,
        traceId: params.traceId,
        error: uploadError instanceof Error ? uploadError.message : String(uploadError),
      });
      throw uploadError;
    }
  }

  /**
   * Executes compensating deletion when downstream database persistence fails.
   */
  private async compensateStorageRollback(
    storageKey: string,
    tenantId: string,
    traceId: string | undefined,
    dbError: unknown,
  ): Promise<void> {
    this.logger.error('Database transaction failed. Initiating compensating storage deletion.', {
      storageKey,
      tenantId,
      traceId,
      error: dbError instanceof Error ? dbError.message : String(dbError),
    });

    try {
      await this.storageService.deleteObject(storageKey);
    } catch (cleanupError) {
      this.logger.error('Failed compensating deletion of orphaned storage object', {
        storageKey,
        tenantId,
        error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError),
      });
    }
  }
}
