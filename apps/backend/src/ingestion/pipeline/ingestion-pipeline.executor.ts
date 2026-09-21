import { Injectable, Inject, Logger } from '@nestjs/common';
import { IngestionJobsRepository } from '../database/repositories/ingestion-jobs.repository';
import { DocumentChunksRepository } from '../database/repositories/document-chunks.repository';
import {
  OBJECT_STORAGE_SERVICE,
  type IObjectStorageService,
} from '../storage/interfaces/object-storage.interface';
import { TempStorageManager } from '../services/temp-storage-manager.service';
import { PdfParserAdapter } from '../parsing/adapters/pdf-parser.adapter';
import {
  DOCUMENT_CHUNKER,
  type IDocumentChunker,
} from '../chunking/interfaces/document-chunker.interface';
import { IngestionJobStage } from '../common/enums';
import { ParsedDocument } from '../parsing/interfaces/document-parser.interface';
import { IngestionJobEntity } from '../database/entities/ingestion-job.entity';

@Injectable()
export class IngestionPipelineExecutor {
  private readonly logger = new Logger(IngestionPipelineExecutor.name);

  constructor(
    private readonly jobsRepository: IngestionJobsRepository,
    private readonly chunksRepository: DocumentChunksRepository,
    @Inject(OBJECT_STORAGE_SERVICE)
    private readonly storageService: IObjectStorageService,
    private readonly tempStorageManager: TempStorageManager,
    private readonly pdfParser: PdfParserAdapter,
    @Inject(DOCUMENT_CHUNKER)
    private readonly chunker: IDocumentChunker,
  ) {}

  /**
   * Orchestrates the document parsing and chunking ingestion pipeline stages.
   *
   * @remarks
   * - Monotonic stage progression: `SOURCE_READY` -> `PARSING` -> `CHUNKING` -> `EMBEDDING`.
   * - Persists chunks and enqueues embedding outbox events transactionally in CHUNKING stage.
   * - Downstream EMBEDDING and INDEXING stages are processed asynchronously via SQS embedding queue workers.
   *
   * @param {string} jobId - Primary key identifier of target ingestion job
   * @returns {Promise<void>}
   * @throws {Error} Throws if pipeline stage execution encounters unhandled error
   */
  async executePipeline(jobId: string): Promise<void> {
    const job = await this.jobsRepository.findJobById(jobId);
    if (!job || !job.version) {
      const missingErr = new Error(`Ingestion job or version record not found [jobId=${jobId}]`);
      (missingErr as any).code = 'NOSUCHKEY';
      throw missingErr;
    }

    let parsedDocument: ParsedDocument | null = null;

    /* Stage 1: PARSING */
    if (
      job.stage === IngestionJobStage.SOURCE_READY ||
      job.stage === IngestionJobStage.PARSING
    ) {
      parsedDocument = await this.executeParsingStage(job);
    }

    /* Stage 2: CHUNKING & OUTBOX ENQUEUE */
    if (job.stage === IngestionJobStage.CHUNKING) {
      await this.executeChunkingStage(job, parsedDocument);
    }

    this.logger.log('Ingestion pipeline parsing and chunking phase complete', {
      jobId,
      stage: job.stage,
    });
  }

  /**
   * Executes PDF document downloading and structural text parsing stage.
   *
   * @param {IngestionJobEntity} job - Ingestion job record containing version and storage details
   * @returns {Promise<ParsedDocument>} Parsed document structure and metadata
   */
  private async executeParsingStage(job: IngestionJobEntity): Promise<ParsedDocument> {
    const jobId = job.id;
    const versionId = job.versionId;
    const storageKey = job.version!.storageKey;

    this.logger.log('Executing PARSING stage', { jobId, versionId, storageKey });

    if (!this.storageService.getObjectStream) {
      throw new Error('Object storage service does not implement getObjectStream');
    }

    const s3Stream = await this.storageService.getObjectStream(storageKey);
    const { filePath } = await this.tempStorageManager.streamToTempFile(jobId, s3Stream);

    try {
      const parsedDocument = await this.pdfParser.parse({
        filePath,
        contentType: job.version!.mimeType,
      });
      this.logger.log('Successfully parsed document PDF', {
        jobId,
        pageCount: parsedDocument.metadata.pageCount,
      });

      await this.jobsRepository.updateJobStage(jobId, IngestionJobStage.CHUNKING);
      job.stage = IngestionJobStage.CHUNKING;
      return parsedDocument;
    } finally {
      await this.tempStorageManager.cleanupTempFile(filePath);
    }
  }

  /**
   * Executes structural document chunking and transactional chunk & outbox persistence stage.
   *
   * @param {IngestionJobEntity} job - Ingestion job record
   * @param {ParsedDocument | null} inMemoryDoc - Cached parsed document in memory if previously parsed
   * @returns {Promise<ParsedDocument>} Parsed document structure
   */
  private async executeChunkingStage(
    job: IngestionJobEntity,
    inMemoryDoc: ParsedDocument | null,
  ): Promise<ParsedDocument> {
    const jobId = job.id;
    const versionId = job.versionId;
    const storageKey = job.version!.storageKey;

    this.logger.log('Executing CHUNKING stage', { jobId, versionId });

    let parsedDocument = inMemoryDoc;
    if (!parsedDocument) {
      if (!this.storageService.getObjectStream) {
        throw new Error('Object storage service does not implement getObjectStream');
      }
      const s3Stream = await this.storageService.getObjectStream(storageKey);
      const { filePath } = await this.tempStorageManager.streamToTempFile(jobId, s3Stream);
      try {
        parsedDocument = await this.pdfParser.parse({
          filePath,
          contentType: job.version!.mimeType,
        });
      } finally {
        await this.tempStorageManager.cleanupTempFile(filePath);
      }
    }

    const chunkEntities = this.chunker.chunkDocument(parsedDocument);
    await this.chunksRepository.saveChunksWithOutbox(versionId, chunkEntities);
    this.logger.log('Successfully persisted document chunks and embedding outbox event checkpoint', {
      jobId,
      versionId,
      chunkCount: chunkEntities.length,
    });

    await this.jobsRepository.updateJobStage(jobId, IngestionJobStage.EMBEDDING);
    job.stage = IngestionJobStage.EMBEDDING;
    return parsedDocument;
  }
}


