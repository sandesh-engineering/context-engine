import { ConfigService } from '@nestjs/config';
import { SqsMessagePublisher } from '../messaging/publishers/sqs-message.publisher';
import { OutboxMessagePayload } from '../messaging/interfaces/message-publisher.interface';
import { RetryPolicy } from '../resilience/retry-policy';

describe('SqsMessagePublisher Unit Tests', () => {
  let mockConfigService: ConfigService;

  beforeEach(() => {
    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'SQS_INGESTION_QUEUE_URL') return 'http://localhost:4566/0000/queue';
        if (key === 'SQS_INGESTION_DLQ_URL') return 'http://localhost:4566/0000/dlq';
        return undefined;
      }),
    } as any;
  });

  it('should return empty result when publishing empty message array', async () => {
    const publisher = new SqsMessagePublisher(mockConfigService);
    const result = await publisher.publishBatch([]);
    expect(result.successful.length).toBe(0);
    expect(result.failed.length).toBe(0);
  });

  it('should publish batch to standard queue using SQSClient mock', async () => {
    const mockSqsClient = {
      send: jest.fn().mockResolvedValue({
        Successful: [{ Id: 'evt_1', MessageId: 'msg-uuid-1' }],
        Failed: [],
      }),
    } as any;

    const publisher = new SqsMessagePublisher(mockConfigService, {
      client: mockSqsClient,
    });

    const messages: OutboxMessagePayload[] = [
      {
        eventId: 'evt-1',
        eventType: 'ingestion.job.created',
        timestamp: new Date().toISOString(),
        traceId: 'trace-123',
        payload: { jobId: 'job-1' },
      },
    ];

    const result = await publisher.publishBatch(messages);

    expect(result.successful.length).toBe(1);
    expect(result.successful[0]?.eventId).toBe('evt-1');
    expect(result.successful[0]?.messageId).toBe('msg-uuid-1');
    expect(mockSqsClient.send).toHaveBeenCalledTimes(1);
  });

  it('should retry transient errors using retry policy', async () => {
    let sendCount = 0;
    const mockSqsClient = {
      send: jest.fn().mockImplementation(async () => {
        sendCount++;
        if (sendCount < 2) {
          const err: any = new Error('ServiceUnavailable');
          err.$metadata = { httpStatusCode: 503 };
          throw err;
        }
        return {
          Successful: [{ Id: 'evt_1', MessageId: 'msg-uuid-retry' }],
          Failed: [],
        };
      }),
    } as any;

    const retryPolicy = new RetryPolicy({
      maxAttempts: 3,
      initialDelayMs: 1,
      maxDelayMs: 5,
      sleepFn: () => Promise.resolve(),
    });

    const publisher = new SqsMessagePublisher(mockConfigService, {
      client: mockSqsClient,
      retryPolicy,
    });

    const messages: OutboxMessagePayload[] = [
      {
        eventId: 'evt-1',
        eventType: 'ingestion.job.created',
        timestamp: new Date().toISOString(),
        payload: { jobId: 'job-1' },
      },
    ];

    const result = await publisher.publishBatch(messages);

    expect(result.successful.length).toBe(1);
    expect(sendCount).toBe(2);
  });

  it('should reroute terminal failure messages to DLQ', async () => {
    const mockSqsClient = {
      send: jest.fn().mockResolvedValue({
        Successful: [{ Id: 'evt_dlq', MessageId: 'dlq-msg-1' }],
        Failed: [],
      }),
    } as any;

    const publisher = new SqsMessagePublisher(mockConfigService, {
      client: mockSqsClient,
    });

    const messages: OutboxMessagePayload[] = [
      {
        eventId: 'evt-dlq',
        eventType: 'ingestion.job.created',
        timestamp: new Date().toISOString(),
        payload: { jobId: 'job-dead' },
      },
    ];

    const result = await publisher.publishToDlq(messages, 'Max retry limit reached');

    expect(result.successful.length).toBe(1);
    expect(mockSqsClient.send).toHaveBeenCalledTimes(1);
  });
});
