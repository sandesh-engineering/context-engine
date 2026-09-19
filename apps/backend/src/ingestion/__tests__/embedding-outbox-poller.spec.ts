import { EmbeddingOutboxPollerService } from '../messaging/services/embedding-outbox-poller.service';
import { IMessagePublisher } from '../messaging/interfaces/message-publisher.interface';
import { EmbeddingOutboxEntity } from '../database/entities';

describe('EmbeddingOutboxPollerService Unit Tests', () => {
  let mockPublisher: jest.Mocked<IMessagePublisher>;
  let mockEmbeddingOutboxRepository: any;
  let mockConfigService: any;
  let mockAppConfigService: any;
  let pollerService: EmbeddingOutboxPollerService;

  beforeEach(() => {
    mockPublisher = {
      publishBatch: jest.fn(),
      publishToDlq: jest.fn(),
    };

    mockEmbeddingOutboxRepository = {
      fetchPendingOutboxEvents: jest.fn(),
      markEventsProcessed: jest.fn(),
      incrementRetries: jest.fn(),
      markEventsFailedDlq: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'OUTBOX_POLL_BATCH_SIZE') return 10;
        if (key === 'OUTBOX_POLL_INTERVAL_MS') return 1000;
        if (key === 'OUTBOX_POLLER_ENABLED') return 'false';
        if (key === 'OUTBOX_MAX_RETRIES') return 3;
        return undefined;
      }),
    };

    mockAppConfigService = {
      sqsEmbeddingQueueUrl: 'http://localhost:4566/000000000000/knowledge-engine-embedding-queue',
    };

    pollerService = new EmbeddingOutboxPollerService(
      mockPublisher,
      mockEmbeddingOutboxRepository,
      mockConfigService,
      mockAppConfigService,
      { autoStart: false },
    );
  });

  it('should return empty result when no pending embedding outbox events exist', async () => {
    mockEmbeddingOutboxRepository.fetchPendingOutboxEvents.mockResolvedValue([]);

    const result = await pollerService.pollAndPublishBatch();

    expect(result.polledCount).toBe(0);
    expect(result.publishedCount).toBe(0);
    expect(mockPublisher.publishBatch).not.toHaveBeenCalled();
  });

  it('should poll pending embedding events, publish batch to SQS, and mark processed on success', async () => {
    const pendingEvents: Partial<EmbeddingOutboxEntity>[] = [
      {
        id: 'emb-out-1',
        event_id: 'evt_emb_1',
        topic: 'document.embedding.v1',
        payload: { versionId: 'ver-123', chunkCount: 5 },
        created_at: new Date(),
        metadata: { traceId: 'trace-emb-1' },
      },
    ];

    mockEmbeddingOutboxRepository.fetchPendingOutboxEvents.mockResolvedValue(pendingEvents);
    mockPublisher.publishBatch.mockResolvedValue({
      successful: [{ eventId: 'evt_emb_1', messageId: 'msg-emb-1', success: true }],
      failed: [],
    });

    const result = await pollerService.pollAndPublishBatch(5);

    expect(result.polledCount).toBe(1);
    expect(result.publishedCount).toBe(1);
    expect(mockEmbeddingOutboxRepository.fetchPendingOutboxEvents).toHaveBeenCalledWith(5);
    expect(mockPublisher.publishBatch).toHaveBeenCalledTimes(1);
    expect(mockEmbeddingOutboxRepository.markEventsProcessed).toHaveBeenCalledWith(['evt_emb_1']);
  });

  it('should increment retries counter on transient SQS publish failure before max retries threshold', async () => {
    const pendingEvents: Partial<EmbeddingOutboxEntity>[] = [
      {
        id: 'emb-out-2',
        event_id: 'evt_emb_retry',
        topic: 'document.embedding.v1',
        payload: { versionId: 'ver-456' },
        retries: 0,
        created_at: new Date(),
      },
    ];

    mockEmbeddingOutboxRepository.fetchPendingOutboxEvents.mockResolvedValue(pendingEvents);
    mockPublisher.publishBatch.mockResolvedValue({
      successful: [],
      failed: [{ eventId: 'evt_emb_retry', success: false, error: 'SQS connection timeout' }],
    });

    const result = await pollerService.pollAndPublishBatch();

    expect(result.polledCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(mockEmbeddingOutboxRepository.incrementRetries).toHaveBeenCalledWith(['evt_emb_retry']);
    expect(mockPublisher.publishToDlq).not.toHaveBeenCalled();
  });

  it('should reroute to DLQ and mark failed DLQ when retries exceed max threshold', async () => {
    const pendingEvents: Partial<EmbeddingOutboxEntity>[] = [
      {
        id: 'emb-out-3',
        event_id: 'evt_emb_dlq',
        topic: 'document.embedding.v1',
        payload: { versionId: 'ver-789' },
        retries: 2, // 2 + 1 >= maxRetries (3)
        created_at: new Date(),
      },
    ];

    mockEmbeddingOutboxRepository.fetchPendingOutboxEvents.mockResolvedValue(pendingEvents);
    mockPublisher.publishBatch.mockResolvedValue({
      successful: [],
      failed: [{ eventId: 'evt_emb_dlq', success: false, error: 'Permanent queue error' }],
    });
    mockPublisher.publishToDlq.mockResolvedValue({
      successful: [{ eventId: 'evt_emb_dlq', messageId: 'dlq-msg-emb-1', success: true }],
      failed: [],
    });

    const result = await pollerService.pollAndPublishBatch();

    expect(result.polledCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(mockPublisher.publishToDlq).toHaveBeenCalled();
    expect(mockEmbeddingOutboxRepository.markEventsFailedDlq).toHaveBeenCalledWith(['evt_emb_dlq']);
  });

  it('should prevent overlapping concurrent poll cycles when already polling', async () => {
    mockEmbeddingOutboxRepository.fetchPendingOutboxEvents.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 50)),
    );

    const firstPoll = pollerService.pollAndPublishBatch();
    const secondPoll = await pollerService.pollAndPublishBatch();

    expect(secondPoll.polledCount).toBe(0);
    await firstPoll;
  });
});
