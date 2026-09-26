import { AppTracer, TraceContextPropagator, SemanticAttributes } from '../telemetry';
import { SqsMessagePublisher } from '../../ingestion/messaging/publishers/sqs-message.publisher';
import { SQSClient } from '@aws-sdk/client-sqs';
import { OutboxMessagePayload } from '../../ingestion/messaging/interfaces/message-publisher.interface';

describe('Distributed Tracing Propagation across EDA Boundaries', () => {
  it('should propagate trace context from HTTP caller to SQS MessageAttributes', async () => {
    const mockSend = jest.fn().mockResolvedValue({
      Successful: [{ Id: 'evt_test_1', MessageId: 'msg-sqs-101' }],
      Failed: [],
    });

    const mockSqsClient = {
      send: mockSend,
    } as unknown as SQSClient;

    const publisher = new SqsMessagePublisher(
      { get: () => 'http://localhost:4566/queue' } as any,
      { client: mockSqsClient },
    );

    let activeTraceId = '';

    await AppTracer.traceSpan('http.post_document', {}, async (httpSpan) => {
      activeTraceId = httpSpan.spanContext().traceId;

      // Simulate Outbox entity recording metadata
      const outboxMetadata: Record<string, unknown> = {};
      TraceContextPropagator.injectToCarrier(outboxMetadata);

      // Simulate Outbox poller mapping to OutboxMessagePayload
      const payload: OutboxMessagePayload = {
        eventId: 'evt_test_1',
        eventType: 'document.ingestion.v1',
        timestamp: new Date().toISOString(),
        traceId: (outboxMetadata.traceId as string) || undefined,
        traceparent: (outboxMetadata.traceparent as string) || undefined,
        metadata: outboxMetadata,
        payload: {
          jobId: 'job-abc',
          documentId: 'doc-xyz',
        },
      };

      // Publish to SQS
      const result = await publisher.publishBatch([payload]);
      expect(result.successful.length).toBe(1);
    });

    expect(mockSend).toHaveBeenCalledTimes(1);
    const sentCommand = mockSend.mock.calls[0][0];
    const entry = sentCommand.input.Entries[0];

    expect(entry).toBeDefined();
    expect(entry.MessageAttributes.traceparent).toBeDefined();
    expect(entry.MessageAttributes.traceparent.StringValue).toContain(activeTraceId);
    expect(entry.MessageAttributes.traceId.StringValue).toBe(activeTraceId);

    // Simulate Ingestion Worker receiving SQS Message
    const sqsMessage = {
      MessageId: 'msg-sqs-101',
      ReceiptHandle: 'receipt-handle-1',
      Body: entry.MessageBody,
      MessageAttributes: entry.MessageAttributes,
    };

    let workerTraceId = '';
    await AppTracer.traceConsumer('ingestion.worker', sqsMessage.MessageAttributes, async (workerSpan) => {
      workerTraceId = workerSpan.spanContext().traceId;
      expect(workerTraceId).toBe(activeTraceId);

      // Simulate downstream stage in worker (e.g. document.parse)
      await AppTracer.traceSpan('document.parse', {}, async (parseSpan) => {
        expect(parseSpan.spanContext().traceId).toBe(activeTraceId);
      });

      // Simulate creating Embedding outbox event
      const embeddingOutboxMetadata: Record<string, unknown> = {};
      TraceContextPropagator.injectToCarrier(embeddingOutboxMetadata);

      expect(embeddingOutboxMetadata.traceparent).toBeDefined();
      expect(embeddingOutboxMetadata.traceparent).toContain(activeTraceId);

      // Simulate Embedding Worker consuming message
      const embeddingSqsAttrs = TraceContextPropagator.injectToSqsAttributes({});
      await AppTracer.traceConsumer('embedding.worker', embeddingSqsAttrs, async (embeddingSpan) => {
        expect(embeddingSpan.spanContext().traceId).toBe(activeTraceId);
      });
    });
  });
});
