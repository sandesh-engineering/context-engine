import {
  Injectable,
  Inject,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppConfigService } from '../../../config/app-config.service';
import {
  type IMessagePublisher,
  MESSAGE_PUBLISHER,
  OutboxMessagePayload,
} from '../interfaces/message-publisher.interface';
import { EmbeddingOutboxRepository } from '../../database/repositories/embedding-outbox.repository';
import { SqsMessagePublisher } from '../publishers/sqs-message.publisher';
import { StructuredLogger, LogEvents } from '../../../common/logger';

export interface EmbeddingPollerBatchResult {
  polledCount: number;
  publishedCount: number;
  dlqCount: number;
  failedCount: number;
}

export interface EmbeddingOutboxPollerOptions {
  batchSize?: number;
  pollIntervalMs?: number;
  autoStart?: boolean;
}

/**
 * Asynchronous background poller service that queries pending embedding outbox events
 * from PostgreSQL (`embedding_outbox` table) and batch-publishes them to the SQS embedding queue.
 */
@Injectable()
export class EmbeddingOutboxPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new StructuredLogger(EmbeddingOutboxPollerService.name);
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private readonly maxRetries: number;
  private isPolling = false;
  private timerHandle?: NodeJS.Timeout;
  private readonly messagePublisher: IMessagePublisher;

  constructor(
    @Inject(MESSAGE_PUBLISHER)
    messagePublisher: IMessagePublisher,
    private readonly embeddingOutboxRepository: EmbeddingOutboxRepository,
    private readonly configService: ConfigService,
    private readonly appConfig: AppConfigService,
    @Optional() options?: EmbeddingOutboxPollerOptions,
  ) {
    /* If provided publisher is primary SQS publisher, instantiate dedicated publisher for SQS embedding queue */
    const embeddingQueueUrl = this.appConfig.sqsEmbeddingQueueUrl;
    this.messagePublisher =
      options ? messagePublisher : new SqsMessagePublisher(this.configService, { queueUrl: embeddingQueueUrl });

    this.batchSize =
      options?.batchSize ||
      this.configService.get<number>('OUTBOX_POLL_BATCH_SIZE') ||
      10;

    this.pollIntervalMs =
      options?.pollIntervalMs ||
      this.configService.get<number>('OUTBOX_POLL_INTERVAL_MS') ||
      1000;

    this.maxRetries =
      this.configService.get<number>('OUTBOX_MAX_RETRIES') ||
      3;
  }

  onModuleInit(): void {
    const enabled = this.configService.get<string>('OUTBOX_POLLER_ENABLED') !== 'false';
    if (enabled) {
      this.startPolling();
    }
  }

  onModuleDestroy(): void {
    this.stopPolling();
  }

  startPolling(): void {
    if (this.timerHandle) return;
    this.logger.logEvent(LogEvents.OUTBOX_POLL_STARTED, {
      batchSize: this.batchSize,
      pollIntervalMs: this.pollIntervalMs,
    });
    this.timerHandle = setInterval(() => {
      this.pollAndPublishBatch().catch((err) => {
        this.logger.logError('outbox.embedding_poll.failed', err);
      });
    }, this.pollIntervalMs);
  }

  stopPolling(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = undefined;
      this.logger.logEvent('outbox.embedding_poll.stopped');
    }
  }

  async pollAndPublishBatch(customBatchSize?: number): Promise<EmbeddingPollerBatchResult> {
    if (this.isPolling) {
      return { polledCount: 0, publishedCount: 0, dlqCount: 0, failedCount: 0 };
    }

    this.isPolling = true;
    const effectiveBatchSize = customBatchSize || this.batchSize;
    let polledCount = 0;
    let publishedCount = 0;
    let dlqCount = 0;
    let failedCount = 0;

    try {
      const pendingEvents =
        await this.embeddingOutboxRepository.fetchPendingOutboxEvents(effectiveBatchSize);

      polledCount = pendingEvents.length;

      if (polledCount === 0) {
        return { polledCount: 0, publishedCount: 0, dlqCount: 0, failedCount: 0 };
      }

      this.logger.debugEvent(LogEvents.OUTBOX_POLL_STARTED, { batchSize: polledCount });

      const messages: OutboxMessagePayload[] = pendingEvents.map((evt) => ({
        eventId: evt.event_id,
        eventType: evt.topic,
        timestamp: evt.created_at
          ? new Date(evt.created_at).toISOString()
          : new Date().toISOString(),
        traceId: (evt.metadata?.traceId as string) || undefined,
        traceparent: (evt.metadata?.traceparent as string) || undefined,
        tracestate: (evt.metadata?.tracestate as string) || undefined,
        metadata: evt.metadata || undefined,
        payload: evt.payload || {},
      }));

      /* Execute batch publish to SQS embedding queue */
      const publishResult = await this.messagePublisher.publishBatch(messages);

      if (publishResult.successful.length > 0) {
        const successIds = publishResult.successful.map((item) => item.eventId);
        await this.embeddingOutboxRepository.markEventsProcessed(successIds);
        publishedCount = successIds.length;
      }

      if (publishResult.failed.length > 0) {
        failedCount = publishResult.failed.length;
        const failedEventIds = publishResult.failed.map((item) => item.eventId);
        const dlqEligibleIds: string[] = [];
        const retryEligibleIds: string[] = [];

        for (const failedId of failedEventIds) {
          const eventRecord = pendingEvents.find((evt) => evt.event_id === failedId);
          const currentRetries = eventRecord?.retries || 0;
          if (currentRetries + 1 >= this.maxRetries) {
            dlqEligibleIds.push(failedId);
          } else {
            retryEligibleIds.push(failedId);
          }
        }

        if (retryEligibleIds.length > 0) {
          await this.embeddingOutboxRepository.incrementRetries(retryEligibleIds);
          this.logger.warn('Incremented embedding outbox retry attempt counters', {
            retryCount: retryEligibleIds.length,
            eventIds: retryEligibleIds,
          });
        }

        if (dlqEligibleIds.length > 0) {
          const failedMessages = messages.filter((m) =>
            dlqEligibleIds.includes(m.eventId),
          );

          try {
            const dlqResult = await this.messagePublisher.publishToDlq(
              failedMessages,
              `Embedding batch publish failed after ${this.maxRetries} retries`,
            );
            const dlqSuccessIds = dlqResult.successful.map((item) => item.eventId);
            if (dlqSuccessIds.length > 0) {
              await this.embeddingOutboxRepository.markEventsFailedDlq(dlqSuccessIds);
              dlqCount = dlqSuccessIds.length;
            }
          } catch (dlqErr) {
            this.logger.error('Failed rerouting unprocessable embedding outbox batch to DLQ', {
              dlqCount: dlqEligibleIds.length,
              error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
            });
          }
        }
      }

      this.logger.log('Completed embedding outbox relay iteration', {
        polledCount,
        publishedCount,
        dlqCount,
        failedCount,
      });

      return { polledCount, publishedCount, dlqCount, failedCount };
    } catch (err) {
      this.logger.error('Embedding Outbox Poller iteration failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      this.isPolling = false;
    }
  }
}
