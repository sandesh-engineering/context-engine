import { Injectable, Inject } from '@nestjs/common';
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
import { AppTracer, SemanticAttributes } from '../../common/telemetry';
import { StructuredLogger, LogEvents } from '../../common/logger';

@Injectable()
export class IngestionPipelineExecutor {
  private readonly logger = new StructuredLogger(IngestionPipelineExecutor.name);

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
  }

  /**
   * Executes PDF document downloading and structural text parsing stage.
   */
  private async executeParsingStage(job: IngestionJobEntity): Promise<ParsedDocument> {
    const jobId = job.id;
    const versionId = job.versionId;
    const storageKey = job.version!.storageKey;

    if (!this.storageService.getObjectStream) {
      throw new Error('Object storage service does not implement getObjectStream');
    }

    // Sub-span: s3.download / document.download
    const { filePath } = await AppTracer.traceSpan(
      'document.download',
      {
        attributes: {
          [SemanticAttributes.KE_JOB_ID]: jobId,
          [SemanticAttributes.KE_VERSION_ID]: versionId,
          'storage.key': storageKey,
        },
      },
      async () => {
        this.logger.logEvent(LogEvents.DOCUMENT_DOWNLOAD_STARTED, {
          jobId,
          versionId,
          storageKey,
        });

        const s3Stream = await this.storageService.getObjectStream!(storageKey);
        const res = await this.tempStorageManager.streamToTempFile(jobId, s3Stream);

        this.logger.logEvent(LogEvents.DOCUMENT_DOWNLOAD_COMPLETED, {
          jobId,
          versionId,
          storageKey,
        });

        return res;
      },
    );

    // Sub-span: document.parse
    return AppTracer.traceSpan(
      'document.parse',
      {
        attributes: {
          [SemanticAttributes.KE_JOB_ID]: jobId,
          [SemanticAttributes.KE_VERSION_ID]: versionId,
          'mime.type': job.version!.mimeType,
        },
      },
      async (span) => {
        try {
          this.logger.logEvent(LogEvents.DOCUMENT_PARSE_STARTED, {
            jobId,
            versionId,
          });

          const parsedDocument = await this.pdfParser.parse({
            filePath,
            contentType: job.version!.mimeType,
          });

          if (parsedDocument.metadata.pageCount !== undefined) {
            span.setAttribute('document.page_count', parsedDocument.metadata.pageCount);
          }

          this.logger.logEvent(LogEvents.DOCUMENT_PARSE_COMPLETED, {
            jobId,
            versionId,
            pageCount: parsedDocument.metadata.pageCount,
          });

          await this.jobsRepository.updateJobStage(jobId, IngestionJobStage.CHUNKING);
          job.stage = IngestionJobStage.CHUNKING;
          return parsedDocument;
        } catch (parseErr) {
          this.logger.logError(LogEvents.DOCUMENT_PARSE_FAILED, parseErr, {
            jobId,
            versionId,
          });
          throw parseErr;
        } finally {
          await this.tempStorageManager.cleanupTempFile(filePath);
        }
      },
    );
  }

  /**
   * Executes structural document chunking and transactional chunk & outbox persistence stage.
   */
  private async executeChunkingStage(
    job: IngestionJobEntity,
    inMemoryDoc: ParsedDocument | null,
  ): Promise<ParsedDocument> {
    const jobId = job.id;
    const versionId = job.versionId;
    const storageKey = job.version!.storageKey;

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

    return AppTracer.traceSpan(
      'document.chunk',
      {
        attributes: {
          [SemanticAttributes.KE_JOB_ID]: jobId,
          [SemanticAttributes.KE_VERSION_ID]: versionId,
        },
      },
      async (span) => {
        try {
          this.logger.logEvent(LogEvents.DOCUMENT_CHUNK_STARTED, { jobId, versionId });

          const chunkEntities = this.chunker.chunkDocument(parsedDocument);
          span.setAttribute('document.chunk_count', chunkEntities.length);

          // Persist chunks with outbox event
          await AppTracer.traceSpan(
            'document.persist_chunks',
            {
              attributes: {
                [SemanticAttributes.KE_JOB_ID]: jobId,
                [SemanticAttributes.KE_VERSION_ID]: versionId,
                'chunk.count': chunkEntities.length,
              },
            },
            async () => {
              await this.chunksRepository.saveChunksWithOutbox(versionId, chunkEntities);
            },
          );

          this.logger.logEvent(LogEvents.DOCUMENT_CHUNK_COMPLETED, {
            jobId,
            versionId,
            chunkCount: chunkEntities.length,
          });

          await this.jobsRepository.updateJobStage(jobId, IngestionJobStage.EMBEDDING);
          job.stage = IngestionJobStage.EMBEDDING;
          return parsedDocument;
        } catch (chunkErr) {
          this.logger.logError(LogEvents.DOCUMENT_CHUNK_FAILED, chunkErr, {
            jobId,
            versionId,
          });
          throw chunkErr;
        }
      },
    );
  }
}
