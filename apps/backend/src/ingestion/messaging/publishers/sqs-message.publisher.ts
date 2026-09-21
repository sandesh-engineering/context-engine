import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  SendMessageBatchCommand,
  SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs';
import {
  IMessagePublisher,
  OutboxMessagePayload,
  PublishBatchResult,
  PublishBatchItemResult,
} from '../interfaces/message-publisher.interface';
import { RetryPolicy } from '../../resilience/retry-policy';
import { ErrorClassifier } from '../../resilience/error-classifier';

export interface SqsPublisherOptions {
  queueUrl?: string;
  dlqUrl?: string;
  client?: SQSClient;
  retryPolicy?: RetryPolicy;
}

@Injectable()
export class SqsMessagePublisher implements IMessagePublisher {
  private readonly logger = new Logger(SqsMessagePublisher.name);
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
   *
   * @remarks
   * - Leverages `RetryPolicy` and `ErrorClassifier` for bounded retries on transient errors.
   * - Attaches `traceId` as an SQS MessageAttribute for distributed tracing context propagation.
   *
   * @param {OutboxMessagePayload[]} messages - Array of outbox messages to publish
   * @returns {Promise<PublishBatchResult>} Breakdown of successful and failed batch items
   * @throws {Error} Throws if permanent queue error or retry attempts fail
   *
   * @example
   * ```ts
   * const result = await publisher.publishBatch([messagePayload]);
   * ```
   */
  async publishBatch(messages: OutboxMessagePayload[]): Promise<PublishBatchResult> {
    if (!messages || messages.length === 0) {
      return { successful: [], failed: [] };
    }

    return this.retryPolicy.execute(
      async () => this.sendBatchToQueue(this.queueUrl, messages),
      {
        onRetry: (err, attempt, delayMs) => {
          this.logger.warn(
            `Transient SQS batch publish error on attempt ${attempt}, retrying in ${delayMs}ms`,
            {
              queueUrl: this.queueUrl,
              batchCount: messages.length,
              error: err instanceof Error ? err.message : String(err),
            },
          );
        },
      },
    );
  }

  /**
   * Reroutes unprocessable or terminally failed outbox messages to SQS Dead-Letter Queue (DLQ).
   *
   * @remarks
   * - Wraps payload with `dlqReason` and `dlqTimestamp` operational metadata.
   * - Prevents endless retries on poison-pill payloads.
   *
   * @param {OutboxMessagePayload[]} messages - Outbox messages to reroute
   * @param {string} errorReason - Explanation of terminal failure/escalation
   * @returns {Promise<PublishBatchResult>} Breakdown of successful and failed DLQ items
   *
   * @example
   * ```ts
   * await publisher.publishToDlq(failedMessages, 'Max retry limit reached');
   * ```
   */
  async publishToDlq(
    messages: OutboxMessagePayload[],
    errorReason: string,
  ): Promise<PublishBatchResult> {
    if (!messages || messages.length === 0) {
      return { successful: [], failed: [] };
    }

    this.logger.warn(`Rerouting ${messages.length} outbox messages to DLQ`, {
      dlqUrl: this.dlqUrl,
      reason: errorReason,
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
  }

  /**
   * Internal helper sending message batch to target SQS Queue.
   */
  private async sendBatchToQueue(
    targetQueueUrl: string,
    messages: OutboxMessagePayload[],
  ): Promise<PublishBatchResult> {
    const entries: SendMessageBatchRequestEntry[] = messages.map((msg) => {
      const entry: SendMessageBatchRequestEntry = {
        Id: msg.eventId.replace(/[^a-zA-Z0-9_-]/g, '_'), // SQS Id requirements
        MessageBody: JSON.stringify(msg),
      };

      if (msg.traceId) {
        entry.MessageAttributes = {
          traceId: {
            DataType: 'String',
            StringValue: msg.traceId,
          },
        };
      }

      return entry;
    });

    const command = new SendMessageBatchCommand({
      QueueUrl: targetQueueUrl,
      Entries: entries,
    });

    try {
      const response = await this.sqsClient.send(command);

      const successful: PublishBatchItemResult[] = (response.Successful || []).map((res) => {
        const matchingMsg = messages.find(
          (m) => m.eventId.replace(/[^a-zA-Z0-9_-]/g, '_') === res.Id,
        );
        return {
          eventId: matchingMsg ? matchingMsg.eventId : res.Id || 'unknown',
          messageId: res.MessageId,
          success: true,
        };
      });

      const failed: PublishBatchItemResult[] = (response.Failed || []).map((err) => {
        const matchingMsg = messages.find(
          (m) => m.eventId.replace(/[^a-zA-Z0-9_-]/g, '_') === err.Id,
        );
        return {
          eventId: matchingMsg ? matchingMsg.eventId : err.Id || 'unknown',
          success: false,
          error: err.Message || `SQS Error code ${err.Code}`,
        };
      });

      return { successful, failed };
    } catch (err) {
      if (!ErrorClassifier.isRetryable(err)) {
        this.logger.error('Permanent error sending batch to SQS queue', {
          queueUrl: targetQueueUrl,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throw err;
    }
  }
}
