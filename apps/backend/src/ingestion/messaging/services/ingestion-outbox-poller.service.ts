import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
  Optional,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  type IMessagePublisher,
  MESSAGE_PUBLISHER,
  OutboxMessagePayload,
} from '../interfaces/message-publisher.interface';
import { OutboxRepository } from '../../database/repositories/outbox.repository';

export interface PollerBatchResult {
  polledCount: number;
  publishedCount: number;
  dlqCount: number;
  failedCount: number;
}

export interface IngestionOutboxPollerOptions {
  batchSize?: number;
  pollIntervalMs?: number;
  autoStart?: boolean;
}

/**
 * Asynchronous background poller service that periodically queries pending ingestion outbox events
 * from PostgreSQL (`ingestion_outbox` table) and batch-publishes them to SQS.
 */
@Injectable()
export class IngestionOutboxPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IngestionOutboxPollerService.name);
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private isPolling = false;
  private timerHandle?: NodeJS.Timeout;
  private readonly maxRetries: number;

  private readonly messagePublisher: IMessagePublisher;

  constructor(
    @Inject(MESSAGE_PUBLISHER)
    messagePublisher: IMessagePublisher,
    private readonly outboxRepository: OutboxRepository,
    private readonly configService: ConfigService,
    @Optional() options?: IngestionOutboxPollerOptions,
  ) {
    this.messagePublisher = messagePublisher;
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
    this.logger.log('Starting Ingestion Outbox Poller background loop', {
      batchSize: this.batchSize,
      intervalMs: this.pollIntervalMs,
    });
    this.timerHandle = setInterval(() => {
      this.pollAndPublishBatch().catch((err) => {
        this.logger.error('Unhandled error in Ingestion Outbox Poller iteration', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.pollIntervalMs);
  }

  stopPolling(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = undefined;
      this.logger.log('Stopped Ingestion Outbox Poller background loop');
    }
  }

  async pollAndPublishBatch(customBatchSize?: number): Promise<PollerBatchResult> {
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
        await this.outboxRepository.fetchPendingOutboxEvents(effectiveBatchSize);

      polledCount = pendingEvents.length;

      if (polledCount === 0) {
        return { polledCount: 0, publishedCount: 0, dlqCount: 0, failedCount: 0 };
      }

      this.logger.log('Polled pending ingestion outbox events', { batchSize: polledCount });

      const messages: OutboxMessagePayload[] = pendingEvents.map((evt) => ({
        eventId: evt.event_id,
        eventType: evt.topic,
        timestamp: evt.created_at
          ? new Date(evt.created_at).toISOString()
          : new Date().toISOString(),
        traceId: (evt.metadata?.traceId as string) || undefined,
        payload: evt.payload || {},
      }));

      /* Execute batch publish to primary message queue */
      const publishResult = await this.messagePublisher.publishBatch(messages);

      /* Mark successful items as processed in database */
      if (publishResult.successful.length > 0) {
        const successIds = publishResult.successful.map((item) => item.eventId);
        await this.outboxRepository.markEventsProcessed(successIds);
        publishedCount = successIds.length;
      }

      /* Handle failed items: increment retries or reroute to DLQ */
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
          await this.outboxRepository.incrementRetries(retryEligibleIds);
          this.logger.warn('Incremented ingestion outbox retry attempt counters', {
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
              `Batch publish failed after ${this.maxRetries} retries`,
            );
            const dlqSuccessIds = dlqResult.successful.map((item) => item.eventId);
            if (dlqSuccessIds.length > 0) {
              await this.outboxRepository.markEventsFailedDlq(dlqSuccessIds);
              dlqCount = dlqSuccessIds.length;
            }
          } catch (dlqErr) {
            this.logger.error('Failed rerouting unprocessable ingestion outbox batch to DLQ', {
              dlqCount: dlqEligibleIds.length,
              error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
            });
          }
        }
      }

      this.logger.log('Completed ingestion outbox relay iteration', {
        polledCount,
        publishedCount,
        dlqCount,
        failedCount,
      });

      return { polledCount, publishedCount, dlqCount, failedCount };
    } catch (err) {
      this.logger.error('Ingestion Outbox Poller iteration failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      this.isPolling = false;
    }
  }
}
export { IngestionOutboxPollerService as OutboxPollerService };
