import { SqsEmbeddingPollerService } from '../worker/sqs-embedding-poller.service';
import { IngestionJobsRepository } from '../database/repositories/ingestion-jobs.repository';
import { DocumentChunksRepository } from '../database/repositories/document-chunks.repository';
import { IEmbeddingProvider } from '../embeddings/interfaces/embedding-provider.interface';
import { AppConfigService } from '../../config/app-config.service';
import { DeleteMessageCommand } from '@aws-sdk/client-sqs';

describe('SqsEmbeddingPollerService Unit Tests', () => {
  let pollerService: SqsEmbeddingPollerService;
  let mockJobsRepository: jest.Mocked<IngestionJobsRepository>;
  let mockChunksRepository: jest.Mocked<DocumentChunksRepository>;
  let mockEmbeddingProvider: jest.Mocked<IEmbeddingProvider>;
  let mockAppConfig: jest.Mocked<AppConfigService>;
  let mockConfigService: any;
  let mockSqsClient: any;

  beforeEach(() => {
    mockJobsRepository = {
      updateJobStage: jest.fn(),
      markJobCompleted: jest.fn(),
      markJobFailed: jest.fn(),
      completeJobAndPromoteVersion: jest.fn(),
    } as unknown as jest.Mocked<IngestionJobsRepository>;

    mockChunksRepository = {
      fetchUnembeddedChunks: jest.fn(),
      updateBatchEmbeddings: jest.fn(),
      countChunkStats: jest.fn(),
    } as unknown as jest.Mocked<DocumentChunksRepository>;

    mockEmbeddingProvider = {
      generateEmbeddings: jest.fn(),
    };

    mockAppConfig = {
      workerEnabled: false,
      sqsEmbeddingQueueUrl: 'http://localhost:4566/000000000000/knowledge-engine-embedding-queue',
      sqsPollWaitTimeSeconds: 20,
      sqsMaxNumberOfMessages: 10,
      sqsVisibilityTimeoutSeconds: 300,
      sqsPollerConcurrency: 1,
      embeddingBatchSize: 10,
    } as unknown as jest.Mocked<AppConfigService>;

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'AWS_REGION') return 'us-east-1';
        return undefined;
      }),
    };

    mockSqsClient = {
      send: jest.fn(),
    };

    pollerService = new SqsEmbeddingPollerService(
      mockAppConfig,
      mockConfigService,
      mockJobsRepository,
      mockChunksRepository,
      mockEmbeddingProvider,
      {
        sqsClient: mockSqsClient,
        queueUrl: 'http://localhost:4566/000000000000/knowledge-engine-embedding-queue',
        waitTimeSeconds: 1,
        maxNumberOfMessages: 5,
      },
    );
  });

  it('should process embedding message, generate vector embeddings, bulk update DB, and complete job', async () => {
    const sqsMessage = {
      Body: JSON.stringify({
        eventId: 'evt-emb-123',
        payload: { versionId: 'ver-uuid-1', jobId: 'job-uuid-1' },
        traceId: 'trace-123',
      }),
      ReceiptHandle: 'rh-emb-123',
    };

    const mockUnembedded = [
      { id: 'chunk-1', content: 'First chunk text' },
      { id: 'chunk-2', content: 'Second chunk text' },
    ];

    mockChunksRepository.fetchUnembeddedChunks
      .mockResolvedValueOnce(mockUnembedded as any)
      .mockResolvedValueOnce([]); // end loop

    mockEmbeddingProvider.generateEmbeddings.mockResolvedValue({
      embeddings: [
        [0.1, 0.2, 0.3],
        [0.4, 0.5, 0.6],
      ],
      modelName: 'embeddinggemma',
      dimensions: 768,
    });

    mockChunksRepository.updateBatchEmbeddings.mockResolvedValue();
    mockChunksRepository.countChunkStats.mockResolvedValue({ total: 2, embedded: 2 });
    mockJobsRepository.completeJobAndPromoteVersion.mockResolvedValue('promoted');
    mockSqsClient.send.mockResolvedValue({});

    await pollerService.processEmbeddingMessage(sqsMessage);

    expect(mockChunksRepository.fetchUnembeddedChunks).toHaveBeenCalledWith('ver-uuid-1', 10);
    expect(mockEmbeddingProvider.generateEmbeddings).toHaveBeenCalledWith(
      { texts: ['First chunk text', 'Second chunk text'] },
      { signal: expect.any(AbortSignal) },
    );
    expect(mockChunksRepository.updateBatchEmbeddings).toHaveBeenCalledWith([
      { chunkId: 'chunk-1', embedding: [0.1, 0.2, 0.3] },
      { chunkId: 'chunk-2', embedding: [0.4, 0.5, 0.6] },
    ]);
    /* Completing the job is also what makes this version the one that answers questions */
    expect(mockJobsRepository.completeJobAndPromoteVersion).toHaveBeenCalledWith('job-uuid-1', 'ver-uuid-1');
    expect(mockSqsClient.send).toHaveBeenCalledWith(expect.any(DeleteMessageCommand));
  });

  it('should still complete the job when the document was deleted mid-embedding', async () => {
    const sqsMessage = {
      Body: JSON.stringify({
        eventId: 'evt-emb-old',
        payload: { versionId: 'ver-old', jobId: 'job-old' },
      }),
      ReceiptHandle: 'rh-emb-old',
    };

    mockChunksRepository.fetchUnembeddedChunks.mockResolvedValue([]);
    mockChunksRepository.countChunkStats.mockResolvedValue({ total: 0, embedded: 0 });
    mockJobsRepository.completeJobAndPromoteVersion.mockResolvedValue('missing');
    mockSqsClient.send.mockResolvedValue({});

    await pollerService.processEmbeddingMessage(sqsMessage);

    /* Otherwise the job would sit in EMBEDDING forever */
    expect(mockJobsRepository.completeJobAndPromoteVersion).toHaveBeenCalledWith('job-old', 'ver-old');
    expect(mockSqsClient.send).toHaveBeenCalledWith(expect.any(DeleteMessageCommand));
  });

  it('should delete unparseable poison JSON SQS message from queue', async () => {
    const invalidMessage = {
      Body: 'MALFORMED_JSON',
      ReceiptHandle: 'rh-poison',
    };

    mockSqsClient.send.mockResolvedValue({});

    await pollerService.processEmbeddingMessage(invalidMessage);

    expect(mockChunksRepository.fetchUnembeddedChunks).not.toHaveBeenCalled();
    expect(mockSqsClient.send).toHaveBeenCalledWith(expect.any(DeleteMessageCommand));
  });

  it('should trigger AbortController signal when embedding generation fails', async () => {
    const sqsMessage = {
      Body: JSON.stringify({
        eventId: 'evt-emb-err',
        payload: { versionId: 'ver-err', jobId: 'job-err' },
      }),
      ReceiptHandle: 'rh-err',
    };

    mockChunksRepository.fetchUnembeddedChunks.mockResolvedValue([
      { id: 'chunk-err', content: 'Err chunk' },
    ] as any);

    mockEmbeddingProvider.generateEmbeddings.mockRejectedValue(new Error('Ollama service down'));

    await expect(pollerService.processEmbeddingMessage(sqsMessage)).rejects.toThrow('Ollama service down');

    expect(mockSqsClient.send).not.toHaveBeenCalledWith(expect.any(DeleteMessageCommand));
    /* The job shows FAILED while SQS retries the message */
    expect(mockJobsRepository.markJobFailed).toHaveBeenCalledWith(
      'job-err',
      'Embedding failed: Ollama service down',
    );
  });

  it('should delete the message when the provider rejects the input as too large', async () => {
    const sqsMessage = {
      Body: JSON.stringify({
        eventId: 'evt-emb-413',
        payload: { versionId: 'ver-413', jobId: 'job-413' },
      }),
      ReceiptHandle: 'rh-413',
    };

    mockChunksRepository.fetchUnembeddedChunks.mockResolvedValue([
      { id: 'chunk-413', content: 'Huge chunk' },
    ] as any);
    mockSqsClient.send.mockResolvedValue({});

    const tooLarge = Object.assign(new Error('Payload too large'), { statusCode: 413 });
    mockEmbeddingProvider.generateEmbeddings.mockRejectedValue(tooLarge);

    await expect(pollerService.processEmbeddingMessage(sqsMessage)).resolves.toBeUndefined();

    expect(mockJobsRepository.markJobFailed).toHaveBeenCalledWith(
      'job-413',
      'Embedding failed: Payload too large',
    );
    expect(mockSqsClient.send).toHaveBeenCalledWith(expect.any(DeleteMessageCommand));
  });
});
