import { Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  SendMessageBatchCommand,
  SendMessageBatchRequestEntry,
  MessageAttributeValue,
} from '@aws-sdk/client-sqs';
import { SpanKind } from '@opentelemetry/api';
import {
  IMessagePublisher,
  OutboxMessagePayload,
  PublishBatchResult,
  PublishBatchItemResult,
} from '../interfaces/message-publisher.interface';
import { RetryPolicy } from '../../resilience/retry-policy';
import { ErrorClassifier } from '../../resilience/error-classifier';
import { AppTracer, SemanticAttributes, TraceContextPropagator } from '../../../common/telemetry';
import { StructuredLogger, LogEvents } from '../../../common/logger';

export interface SqsPublisherOptions {
  queueUrl?: string;
  dlqUrl?: string;
  client?: SQSClient;
  retryPolicy?: RetryPolicy;
}

@Injectable()
export class SqsMessagePublisher implements IMessagePublisher {
  private readonly logger = new StructuredLogger(SqsMessagePublisher.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;
  private readonly dlqUrl: string;
  private readonly retryPolicy: RetryPolicy;

  constructor(
    private readonly configService: ConfigService,
    @Optional() options?: SqsPublisherOptions,
  ) {
    this.queueUrl =
      options?.queueUrl ||
      this.configService.get<string>('SQS_INGESTION_QUEUE_URL') ||
      'http://localhost:4566/000000000000/knowledge-engine-ingestion-queue';

    this.dlqUrl =
      options?.dlqUrl ||
      this.configService.get<string>('SQS_INGESTION_DLQ_URL') ||
      'http://localhost:4566/000000000000/knowledge-engine-ingestion-dlq';

    const awsRegion = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    const endpoint = this.configService.get<string>('AWS_ENDPOINT_URL');
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    const sqsOptions: any = { region: awsRegion };
    if (endpoint) {
      sqsOptions.endpoint = endpoint;
    }
    if (accessKeyId && secretAccessKey) {
      sqsOptions.credentials = { accessKeyId, secretAccessKey };
    }

    this.sqsClient = options?.client || new SQSClient(sqsOptions);

    this.retryPolicy = options?.retryPolicy || new RetryPolicy({ maxAttempts: 3 });
  }

  /**
   * Batch publishes outbox event payloads to primary SQS Queue with retry logic.
   */
  async publishBatch(messages: OutboxMessagePayload[]): Promise<PublishBatchResult> {
    if (!messages || messages.length === 0) {
      return { successful: [], failed: [] };
    }

    return AppTracer.traceSpan(
      'queue.publish',
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          [SemanticAttributes.MESSAGING_SYSTEM]: 'aws.sqs',
          [SemanticAttributes.MESSAGING_DESTINATION_NAME]: this.queueUrl,
          [SemanticAttributes.MESSAGING_OPERATION]: 'publish',
          [SemanticAttributes.MESSAGING_BATCH_COUNT]: messages.length,
        },
      },
      async (span) => {
        this.logger.logEvent(LogEvents.OUTBOX_PUBLISH_STARTED, {
          queue: this.queueUrl,
          batchCount: messages.length,
          eventIds: messages.map((m) => m.eventId),
        });

        return this.retryPolicy.execute(
          async () => this.sendBatchToQueue(this.queueUrl, messages),
          {
            onRetry: (err, attempt, delayMs) => {
              this.logger.warnEvent(LogEvents.OUTBOX_RETRY_SCHEDULED, {
                queue: this.queueUrl,
                batchCount: messages.length,
                attempt,
                delayMs,
                errorMessage: err instanceof Error ? err.message : String(err),
              });
            },
          },
        );
      },
    );
  }

  /**
   * Reroutes unprocessable or terminally failed outbox messages to SQS Dead-Letter Queue (DLQ).
   */
  async publishToDlq(
    messages: OutboxMessagePayload[],
    errorReason: string,
  ): Promise<PublishBatchResult> {
    if (!messages || messages.length === 0) {
      return { successful: [], failed: [] };
    }

    return AppTracer.traceSpan(
      'queue.publish_dlq',
      {
        kind: SpanKind.PRODUCER,
        attributes: {
          [SemanticAttributes.MESSAGING_SYSTEM]: 'aws.sqs',
          [SemanticAttributes.MESSAGING_DESTINATION_NAME]: this.dlqUrl,
          [SemanticAttributes.MESSAGING_OPERATION]: 'publish_dlq',
          [SemanticAttributes.MESSAGING_BATCH_COUNT]: messages.length,
          'dlq.reason': errorReason,
        },
      },
      async () => {
        this.logger.warnEvent(LogEvents.OUTBOX_DLQ_ROUTED, {
          dlqUrl: this.dlqUrl,
          reason: errorReason,
          batchCount: messages.length,
          eventIds: messages.map((m) => m.eventId),
        });

        const dlqMessages = messages.map((msg) => ({
          ...msg,
          payload: {
            ...msg.payload,
            dlqReason: errorReason,
            dlqTimestamp: new Date().toISOString(),
          },
        }));

        return this.sendBatchToQueue(this.dlqUrl, dlqMessages);
      },
    );
  }

  /**
   * Internal helper sending message batch to target SQS Queue with standard W3C trace context attributes.
   */
  private async sendBatchToQueue(
    targetQueueUrl: string,
    messages: OutboxMessagePayload[],
  ): Promise<PublishBatchResult> {
    const entries: SendMessageBatchRequestEntry[] = messages.map((msg) => {
      const entry: SendMessageBatchRequestEntry = {
        Id: msg.eventId.replace(/[^a-zA-Z0-9_-]/g, '_'), // SQS Id requirements
        MessageBody: JSON.stringify(msg),
        MessageAttributes: {},
      };

      const messageAttributes: Record<string, MessageAttributeValue> = {};

      // 1. Check for W3C traceparent in message metadata or payload
      const traceparent =
        msg.traceparent ||
        (msg.metadata?.traceparent as string) ||
        undefined;

      const tracestate =
        msg.tracestate ||
        (msg.metadata?.tracestate as string) ||
        undefined;

      const traceId =
        msg.traceId ||
        (msg.metadata?.traceId as string) ||
        undefined;

      if (traceparent) {
        messageAttributes.traceparent = {
          DataType: 'String',
          StringValue: traceparent,
        };
      }
      if (tracestate) {
        messageAttributes.tracestate = {
          DataType: 'String',
          StringValue: tracestate,
        };
      }
      if (traceId) {
        messageAttributes.traceId = {
          DataType: 'String',
          StringValue: traceId,
        };
      } else if (traceparent) {
        const parts = traceparent.split('-');
        if (parts.length >= 2 && parts[1]) {
          messageAttributes.traceId = {
            DataType: 'String',
            StringValue: parts[1],
          };
        }
      }

      // 2. If no traceparent was in payload, inject the active ambient trace context
      if (!messageAttributes.traceparent) {
        TraceContextPropagator.injectToSqsAttributes(messageAttributes);
      }

      if (msg.eventId) {
        messageAttributes.eventId = {
          DataType: 'String',
          StringValue: msg.eventId,
        };
      }
      if (msg.eventType) {
        messageAttributes.eventType = {
          DataType: 'String',
          StringValue: msg.eventType,
        };
      }

      entry.MessageAttributes = messageAttributes;
      return entry;
    });

    const command = new SendMessageBatchCommand({
      QueueUrl: targetQueueUrl,
      Entries: entries,
    });

    try {
      const response = await this.sqsClient.send(command);

      const successful: PublishBatchItemResult[] = (response.Successful || []).map((res) => {
        const matchingMsg = messages.find((m) => {
          const sanitized = m.eventId.replace(/[^a-zA-Z0-9_-]/g, '_');
          return (
            sanitized === res.Id ||
            m.eventId === res.Id ||
            sanitized.replace(/-/g, '_') === (res.Id || '').replace(/-/g, '_')
          );
        });
        return {
          eventId: matchingMsg ? matchingMsg.eventId : res.Id || 'unknown',
          messageId: res.MessageId,
          success: true,
        };
      });

      const failed: PublishBatchItemResult[] = (response.Failed || []).map((err) => {
        const matchingMsg = messages.find((m) => {
          const sanitized = m.eventId.replace(/[^a-zA-Z0-9_-]/g, '_');
          return (
            sanitized === err.Id ||
            m.eventId === err.Id ||
            sanitized.replace(/-/g, '_') === (err.Id || '').replace(/-/g, '_')
          );
        });
        return {
          eventId: matchingMsg ? matchingMsg.eventId : err.Id || 'unknown',
          success: false,
          error: err.Message || `SQS Error code ${err.Code}`,
        };
      });

      if (successful.length > 0) {
        this.logger.logEvent(LogEvents.OUTBOX_PUBLISH_COMPLETED, {
          queue: targetQueueUrl,
          publishedCount: successful.length,
          failedCount: failed.length,
        });
      }

      return { successful, failed };
    } catch (err) {
      if (!ErrorClassifier.isRetryable(err)) {
        this.logger.logError(LogEvents.OUTBOX_PUBLISH_FAILED, err, {
          queueUrl: targetQueueUrl,
          batchCount: messages.length,
        });
      }
      throw err;
    }
  }
}
