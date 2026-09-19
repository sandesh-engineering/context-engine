import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
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

export interface OutboxPollerOptions {
  batchSize?: number;
  pollIntervalMs?: number;
  autoStart?: boolean;
}

/**
 * Asynchronous background poller service that periodically queries pending outbox events
 * from PostgreSQL and batch-publishes them to message transport queues (SQS/DLQ).
 *
 * @remarks
 * - Polling concurrency is guarded via in-memory lock `isPolling` to prevent overlapping execution.
 * - Utilizes `OutboxRepository` for dedicated database access.
 * - Uses `IMessagePublisher` for provider-agnostic message transport.
 */
@Injectable()
export class OutboxPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OutboxPollerService.name);
  private readonly batchSize: number;
  private readonly pollIntervalMs: number;
  private isPolling = false;
  private timerHandle?: NodeJS.Timeout;

  private readonly messagePublisher: IMessagePublisher;

  constructor(
    @Inject(MESSAGE_PUBLISHER)
    messagePublisher: IMessagePublisher,
    private readonly outboxRepository: OutboxRepository,
    private readonly configService: ConfigService,
    options?: OutboxPollerOptions,
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
  }

  /**
   * NestJS lifecycle hook called after module initialization.
   */
  onModuleInit(): void {
    const enabled = this.configService.get<string>('OUTBOX_POLLER_ENABLED') !== 'false';
    if (enabled) {
      this.startPolling();
    }
  }

  /**
   * NestJS lifecycle hook called before application shutdown.
   */
  onModuleDestroy(): void {
    this.stopPolling();
  }

  /**
   * Starts periodic polling background loop using configured interval.
   *
   * @remarks
   * - No-ops if poller loop is already active.
   */
  startPolling(): void {
    if (this.timerHandle) return;
    this.logger.log('Starting Outbox Poller background loop', {
      batchSize: this.batchSize,
      intervalMs: this.pollIntervalMs,
    });
    this.timerHandle = setInterval(() => {
      this.pollAndPublishBatch().catch((err) => {
        this.logger.error('Unhandled error in Outbox Poller iteration', {
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }, this.pollIntervalMs);
  }

  /**
   * Stops periodic polling background loop cleanly.
   */
  stopPolling(): void {
    if (this.timerHandle) {
      clearInterval(this.timerHandle);
      this.timerHandle = undefined;
      this.logger.log('Stopped Outbox Poller background loop');
    }
  }

  /**
   * Executes a single polling cycle: fetches pending outbox events, formats payloads,
   * batch-publishes to queue publisher, handles retries/DLQ rerouting, and updates database records.
   *
   * @remarks
   * - Guarded against concurrent runs via `isPolling` flag.
   * - Propagates OpenTelemetry `traceId` context in message attributes.
   * - Ensures PII is redacted from all log outputs.
   *
   * @param {number} [customBatchSize] - Optional override for batch polling limit
   * @returns {Promise<PollerBatchResult>} Results summary of the polling iteration
   * @throws {Error} Throws if database query or unhandled publisher exception occurs
   *
   * @example
   * ```ts
   * const result = await pollerService.pollAndPublishBatch(10);
   * ```
   */
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

      this.logger.log('Polled pending outbox events', { batchSize: polledCount });

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

      /* Reroute failed items to DLQ */
      if (publishResult.failed.length > 0) {
        failedCount = publishResult.failed.length;
        const failedEventIds = publishResult.failed.map((item) => item.eventId);
        const failedMessages = messages.filter((m) =>
          failedEventIds.includes(m.eventId),
        );

        try {
          const dlqResult = await this.messagePublisher.publishToDlq(
            failedMessages,
            'Batch publish failed after retries',
          );
          const dlqSuccessIds = dlqResult.successful.map((item) => item.eventId);
          if (dlqSuccessIds.length > 0) {
            await this.outboxRepository.markEventsFailedDlq(dlqSuccessIds);
            dlqCount = dlqSuccessIds.length;
          }
        } catch (dlqErr) {
          this.logger.error('Failed rerouting unprocessable outbox batch to DLQ', {
            failedCount,
            error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
          });
        }
      }

      this.logger.log('Completed outbox relay iteration', {
        polledCount,
        publishedCount,
        dlqCount,
        failedCount,
      });

      return { polledCount, publishedCount, dlqCount, failedCount };
    } catch (err) {
      this.logger.error('Outbox Poller iteration failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    } finally {
      this.isPolling = false;
    }
  }
}
