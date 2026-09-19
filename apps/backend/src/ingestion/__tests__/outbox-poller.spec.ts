import { OutboxPollerService } from '../messaging/services/outbox-poller.service';
import { IMessagePublisher } from '../messaging/interfaces/message-publisher.interface';
import { OutboxEventEntity } from '../database/entities';

describe('OutboxPollerService Unit Tests', () => {
  let mockPublisher: jest.Mocked<IMessagePublisher>;
  let mockOutboxRepository: any;
  let mockConfigService: any;
  let pollerService: OutboxPollerService;

  beforeEach(() => {
    mockPublisher = {
      publishBatch: jest.fn(),
      publishToDlq: jest.fn(),
    };

    mockOutboxRepository = {
      fetchPendingOutboxEvents: jest.fn(),
      markEventsProcessed: jest.fn(),
      markEventsFailedDlq: jest.fn(),
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'OUTBOX_POLL_BATCH_SIZE') return 10;
        if (key === 'OUTBOX_POLL_INTERVAL_MS') return 1000;
        if (key === 'OUTBOX_POLLER_ENABLED') return 'false';
        return undefined;
      }),
    };

    pollerService = new OutboxPollerService(
      mockPublisher,
      mockOutboxRepository,
      mockConfigService,
      { autoStart: false },
    );
  });

  it('should return empty result when no pending events exist', async () => {
    mockOutboxRepository.fetchPendingOutboxEvents.mockResolvedValue([]);

    const result = await pollerService.pollAndPublishBatch();

    expect(result.polledCount).toBe(0);
    expect(result.publishedCount).toBe(0);
    expect(mockPublisher.publishBatch).not.toHaveBeenCalled();
  });

  it('should poll pending events, publish batch, and mark processed on success', async () => {
    const pendingEvents: Partial<OutboxEventEntity>[] = [
      {
        id: '1',
        event_id: 'evt_1',
        topic: 'document.ingestion.v1',
        payload: { jobId: 'job-1' },
        created_at: new Date(),
        metadata: { traceId: 'trace-1' },
      },
    ];

    mockOutboxRepository.fetchPendingOutboxEvents.mockResolvedValue(pendingEvents);
    mockPublisher.publishBatch.mockResolvedValue({
      successful: [{ eventId: 'evt_1', messageId: 'msg-1', success: true }],
      failed: [],
    });

    const result = await pollerService.pollAndPublishBatch(5);

    expect(result.polledCount).toBe(1);
    expect(result.publishedCount).toBe(1);
    expect(mockOutboxRepository.fetchPendingOutboxEvents).toHaveBeenCalledWith(5);
    expect(mockPublisher.publishBatch).toHaveBeenCalledTimes(1);
    expect(mockOutboxRepository.markEventsProcessed).toHaveBeenCalledWith(['evt_1']);
  });

  it('should reroute failed items to DLQ and mark failed DLQ in repository', async () => {
    const pendingEvents: Partial<OutboxEventEntity>[] = [
      {
        id: '1',
        event_id: 'evt_fail',
        topic: 'document.ingestion.v1',
        payload: { jobId: 'job-fail' },
        created_at: new Date(),
      },
    ];

    mockOutboxRepository.fetchPendingOutboxEvents.mockResolvedValue(pendingEvents);
    mockPublisher.publishBatch.mockResolvedValue({
      successful: [],
      failed: [{ eventId: 'evt_fail', success: false, error: 'Queue error' }],
    });
    mockPublisher.publishToDlq.mockResolvedValue({
      successful: [{ eventId: 'evt_fail', messageId: 'dlq-msg-1', success: true }],
      failed: [],
    });

    const result = await pollerService.pollAndPublishBatch();

    expect(result.polledCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(mockPublisher.publishToDlq).toHaveBeenCalled();
    expect(mockOutboxRepository.markEventsFailedDlq).toHaveBeenCalledWith(['evt_fail']);
  });

  it('should prevent overlapping concurrent poll cycles when already polling', async () => {
    mockOutboxRepository.fetchPendingOutboxEvents.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve([]), 50)),
    );

    const firstPoll = pollerService.pollAndPublishBatch();
    const secondPoll = await pollerService.pollAndPublishBatch();

    expect(secondPoll.polledCount).toBe(0); // Blocked by isPolling lock
    await firstPoll;
  });
});
