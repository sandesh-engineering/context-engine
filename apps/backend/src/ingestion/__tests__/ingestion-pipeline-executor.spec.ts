import { Readable } from 'stream';
import { IngestionPipelineExecutor } from '../pipeline/ingestion-pipeline.executor';
import { IngestionJobsRepository } from '../database/repositories/ingestion-jobs.repository';
import { DocumentChunksRepository } from '../database/repositories/document-chunks.repository';
import { TempStorageManager } from '../services/temp-storage-manager.service';
import { PdfParserAdapter } from '../parsing/adapters/pdf-parser.adapter';
import { IDocumentChunker } from '../chunking/interfaces/document-chunker.interface';
import { IObjectStorageService } from '../storage/interfaces/object-storage.interface';
import { IngestionJobStage } from '../common/enums';
import { IngestionJobEntity } from '../database/entities/ingestion-job.entity';
import { DocumentVersionEntity } from '../database/entities/document-version.entity';
import { DocumentChunkEntity } from '../database/entities/document-chunk.entity';
import { ParsedDocument } from '../parsing/interfaces/document-parser.interface';

describe('IngestionPipelineExecutor Unit Tests', () => {
  let executor: IngestionPipelineExecutor;
  let mockJobsRepository: jest.Mocked<IngestionJobsRepository>;
  let mockChunksRepository: jest.Mocked<DocumentChunksRepository>;
  let mockStorageService: jest.Mocked<IObjectStorageService>;
  let mockTempStorageManager: jest.Mocked<TempStorageManager>;
  let mockPdfParser: jest.Mocked<PdfParserAdapter>;
  let mockChunker: jest.Mocked<IDocumentChunker>;

  const mockJobId = 'job-123';
  const mockVersionId = 'ver-456';
  const mockStorageKey = 'documents/d1/versions/ver-456/raw.bin';

  const mockParsedDoc: ParsedDocument = {
    metadata: { pageCount: 1 },
    pages: [
      {
        pageNumber: 1,
        blocks: [{ type: 'paragraph', content: 'Page 1 text content' }],
      },
    ],
  };

  const mockChunk = new DocumentChunkEntity();
  mockChunk.id = 'chunk-1';
  mockChunk.versionId = mockVersionId;
  mockChunk.chunkIndex = 0;
  mockChunk.content = 'Page 1 text content';
  mockChunk.tokenCount = 4;
  mockChunk.startCharOffset = 0;
  mockChunk.endCharOffset = 19;
  mockChunk.pageStart = 1;
  mockChunk.pageEnd = 1;
  mockChunk.metadataJson = { pageNumber: 1 };
  mockChunk.createdAt = new Date();

  const mockChunks: DocumentChunkEntity[] = [mockChunk];

  function createMockJob(stage: IngestionJobStage): IngestionJobEntity {
    const version = new DocumentVersionEntity();
    version.id = mockVersionId;
    version.storageKey = mockStorageKey;
    version.mimeType = 'application/pdf';

    const job = new IngestionJobEntity();
    job.id = mockJobId;
    job.versionId = mockVersionId;
    job.stage = stage;
    job.version = version;
    return job;
  }

  beforeEach(() => {
    mockJobsRepository = {
      findJobById: jest.fn(),
      updateJobStage: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockChunksRepository = {
      saveChunksWithOutbox: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockStorageService = {
      getObjectStream: jest.fn().mockResolvedValue(Readable.from(['fake pdf stream'])),
    } as any;

    mockTempStorageManager = {
      streamToTempFile: jest.fn().mockResolvedValue({ filePath: '/tmp/job-123.pdf', byteSize: 100 }),
      cleanupTempFile: jest.fn().mockResolvedValue(undefined),
    } as any;

    mockPdfParser = {
      parse: jest.fn().mockResolvedValue(mockParsedDoc),
    } as any;

    mockChunker = {
      chunkDocument: jest.fn().mockReturnValue(mockChunks),
    } as any;

    executor = new IngestionPipelineExecutor(
      mockJobsRepository,
      mockChunksRepository,
      mockStorageService,
      mockTempStorageManager,
      mockPdfParser,
      mockChunker,
    );
  });

  describe('executePipeline', () => {
    it('should throw Error with code NOSUCHKEY if job is not found', async () => {
      mockJobsRepository.findJobById.mockResolvedValue(null);

      await expect(executor.executePipeline('missing-job')).rejects.toThrow(
        'Ingestion job or version record not found [jobId=missing-job]',
      );
    });

    it('should throw Error with code NOSUCHKEY if job has no version relation', async () => {
      const jobWithoutVersion = new IngestionJobEntity();
      jobWithoutVersion.id = 'job-no-ver';
      mockJobsRepository.findJobById.mockResolvedValue(jobWithoutVersion);

      await expect(executor.executePipeline('job-no-ver')).rejects.toThrow(
        'Ingestion job or version record not found [jobId=job-no-ver]',
      );
    });

    it('should execute full pipeline (PARSING and CHUNKING) when stage is SOURCE_READY', async () => {
      const job = createMockJob(IngestionJobStage.SOURCE_READY);
      mockJobsRepository.findJobById.mockResolvedValue(job);

      await executor.executePipeline(mockJobId);

      // Stage 1: PARSING
      expect(mockStorageService.getObjectStream).toHaveBeenCalledWith(mockStorageKey);
      expect(mockTempStorageManager.streamToTempFile).toHaveBeenCalledWith(mockJobId, expect.anything());
      expect(mockPdfParser.parse).toHaveBeenCalledWith({
        filePath: '/tmp/job-123.pdf',
        contentType: 'application/pdf',
      });
      expect(mockTempStorageManager.cleanupTempFile).toHaveBeenCalledWith('/tmp/job-123.pdf');
      expect(mockJobsRepository.updateJobStage).toHaveBeenCalledWith(mockJobId, IngestionJobStage.CHUNKING);

      // Stage 2: CHUNKING
      expect(mockChunker.chunkDocument).toHaveBeenCalledWith(mockParsedDoc);
      expect(mockChunksRepository.saveChunksWithOutbox).toHaveBeenCalledWith(mockVersionId, mockChunks);
      expect(mockJobsRepository.updateJobStage).toHaveBeenCalledWith(mockJobId, IngestionJobStage.EMBEDDING);
      expect(job.stage).toBe(IngestionJobStage.EMBEDDING);
    });

    it('should start at CHUNKING stage directly when job stage is CHUNKING', async () => {
      const job = createMockJob(IngestionJobStage.CHUNKING);
      mockJobsRepository.findJobById.mockResolvedValue(job);

      await executor.executePipeline(mockJobId);

      // Should re-fetch file and parse because inMemoryDoc is null
      expect(mockStorageService.getObjectStream).toHaveBeenCalledWith(mockStorageKey);
      expect(mockPdfParser.parse).toHaveBeenCalledTimes(1);
      expect(mockChunker.chunkDocument).toHaveBeenCalledWith(mockParsedDoc);
      expect(mockChunksRepository.saveChunksWithOutbox).toHaveBeenCalledWith(mockVersionId, mockChunks);
      expect(mockJobsRepository.updateJobStage).toHaveBeenCalledWith(mockJobId, IngestionJobStage.EMBEDDING);
      expect(job.stage).toBe(IngestionJobStage.EMBEDDING);
    });

    it('should cleanup temp file even if pdf parsing fails during PARSING stage', async () => {
      const job = createMockJob(IngestionJobStage.SOURCE_READY);
      mockJobsRepository.findJobById.mockResolvedValue(job);
      mockPdfParser.parse.mockRejectedValue(new Error('Corrupted PDF header'));

      await expect(executor.executePipeline(mockJobId)).rejects.toThrow('Corrupted PDF header');
      expect(mockTempStorageManager.cleanupTempFile).toHaveBeenCalledWith('/tmp/job-123.pdf');
      expect(mockChunksRepository.saveChunksWithOutbox).not.toHaveBeenCalled();
    });

    it('should throw if storageService does not implement getObjectStream', async () => {
      const job = createMockJob(IngestionJobStage.SOURCE_READY);
      mockJobsRepository.findJobById.mockResolvedValue(job);
      delete (mockStorageService as any).getObjectStream;

      await expect(executor.executePipeline(mockJobId)).rejects.toThrow(
        'Object storage service does not implement getObjectStream',
      );
    });
  });
});
