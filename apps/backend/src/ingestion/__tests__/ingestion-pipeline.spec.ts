import { Readable } from 'stream';
import { BadRequestException, InternalServerErrorException, PayloadTooLargeException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IngestionService } from '../ingestion.service';
import { MemoryStorageAdapter } from '../storage/adapters/memory-storage.adapter';
import { IngestionPersistenceService } from '../services/ingestion-persistence.service';
import { StoragePathBuilder } from '../services/storage-path-builder.service';
import {
  DocumentEntity,
  DocumentVersionEntity,
  IngestionJobEntity,
  IngestionOutboxEntity,
} from '../database/entities';
import { IngestionJobStatus, IngestionJobStage } from '../common/enums';

describe('Ingestion Pipeline Integration Tests', () => {
  let ingestionService: IngestionService;
  let storageAdapter: MemoryStorageAdapter;
  let mockPersistenceService: IngestionPersistenceService;
  let pathBuilder: StoragePathBuilder;
  let mockConfigService: ConfigService;

  beforeEach(() => {
    storageAdapter = new MemoryStorageAdapter();
    pathBuilder = new StoragePathBuilder();

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'MAX_DOCUMENT_SIZE_BYTES') {
          return 500 * 1024 * 1024;
        }
        return undefined;
      }),
    } as any;

    mockPersistenceService = {
      persistUploadedDocument: jest.fn().mockImplementation(async (params) => {
        const doc = new DocumentEntity();
        doc.id = 'doc-uuid-123';
        doc.title = params.title;
        doc.createdAt = new Date();

        const ver = new DocumentVersionEntity();
        ver.id = 'ver-uuid-123';
        ver.documentId = doc.id;
        ver.storageKey = params.storageKey;
        ver.sha256Digest = params.sha256Digest;
        ver.byteSize = params.byteSize;

        const job = new IngestionJobEntity();
        job.id = 'job-uuid-123';
        job.versionId = ver.id;
        job.status = IngestionJobStatus.PENDING;
        job.stage = IngestionJobStage.SOURCE_READY;

        const outbox = new IngestionOutboxEntity();
        outbox.id = 'outbox-uuid-123';
        outbox.processed = false;

        return {
          document: doc,
          version: ver,
          job,
          outboxEvent: outbox,
        };
      }),
    } as any;

    ingestionService = new IngestionService(
      storageAdapter,
      mockPersistenceService,
      pathBuilder,
      mockConfigService,
    );
  });

  describe('Happy Path', () => {
    it('should successfully stream valid PDF, stage to storage, and persist DB records', async () => {
      const pdfContent = '%PDF-1.7\nSample Knowledge Document Content';
      const stream = Readable.from([Buffer.from(pdfContent)]);

      const result = await ingestionService.uploadDocument({
        stream,
        originalFilename: 'annual-report.pdf',
        title: 'Annual Report 2026',
      });

      expect(result.documentId).toBe('doc-uuid-123');
      expect(result.versionId).toBe('ver-uuid-123');
      expect(result.jobId).toBe('job-uuid-123');
      expect(result.status).toBe(IngestionJobStatus.PENDING);
      expect(result.stage).toBe(IngestionJobStage.SOURCE_READY);
      expect(result.sha256Digest).toBeDefined();
      expect(result.byteSize).toBe(Buffer.byteLength(pdfContent));
      expect(storageAdapter.objects.has(result.storageKey)).toBe(true);
      expect(mockPersistenceService.persistUploadedDocument).toHaveBeenCalledTimes(1);
    });
  });

  describe('Validation Failures', () => {
    it('should reject file stream exceeding size limit', async () => {
      const stream = Readable.from([
        Buffer.from('%PDF-1.7\nLarge Content that exceeds maximum bytes threshold'),
      ]);

      await expect(
        ingestionService.uploadDocument({
          stream,
          originalFilename: 'large.pdf',
          title: 'Large PDF',
          maxSizeBytes: 20, // 20 bytes ceiling
        }),
      ).rejects.toThrow(PayloadTooLargeException);

      expect(mockPersistenceService.persistUploadedDocument).not.toHaveBeenCalled();
    });

    it('should reject invalid magic bytes and zip bombs disguised as PDF', async () => {
      const zipContent = Buffer.concat([
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        Buffer.from('Spoofed zip payload'),
      ]);
      const stream = Readable.from([zipContent]);

      await expect(
        ingestionService.uploadDocument({
          stream,
          originalFilename: 'malicious.pdf',
          title: 'Malicious Document',
        }),
      ).rejects.toThrow(BadRequestException);

      expect(mockPersistenceService.persistUploadedDocument).not.toHaveBeenCalled();
    });

    it('should reject a missing document title', async () => {
      const stream = Readable.from([Buffer.from('%PDF-1.7\nContent')]);

      await expect(
        ingestionService.uploadDocument({
          stream,
          originalFilename: 'test.pdf',
          title: '',
        }),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('Inconsistency & DB Transaction Failure Handling', () => {
    it('should rollback and delete staged storage object if DB transaction fails', async () => {
      mockPersistenceService.persistUploadedDocument = jest
        .fn()
        .mockRejectedValue(new Error('PostgreSQL deadlock / connection error'));

      const pdfContent = '%PDF-1.7\nValid PDF Document';
      const stream = Readable.from([Buffer.from(pdfContent)]);

      await expect(
        ingestionService.uploadDocument({
          stream,
          originalFilename: 'test.pdf',
          title: 'Test Doc',
        }),
      ).rejects.toThrow(InternalServerErrorException);

      expect(storageAdapter.deletedKeys.length).toBe(1);
    });
  });

  describe('Midway Stream Abort / Orphaned Multipart Cleanup', () => {
    it('should abort in-flight multipart upload when stream is interrupted midway', async () => {
      const interruptedStream = new Readable({
        read() {
          this.push(Buffer.from('%PDF-1.7\nFirst valid chunk'));
          process.nextTick(() => {
            this.emit('error', new Error('Client socket closed'));
          });
        },
      });

      await expect(
        ingestionService.uploadDocument({
          stream: interruptedStream,
          originalFilename: 'broken.pdf',
          title: 'Broken Doc',
        }),
      ).rejects.toThrow('Client socket closed');

      expect(storageAdapter.abortedUploadIds.length).toBe(1);
      expect(mockPersistenceService.persistUploadedDocument).not.toHaveBeenCalled();
    });
  });
});
