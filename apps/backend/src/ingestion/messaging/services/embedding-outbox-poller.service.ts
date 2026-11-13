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
} from '../interfaces/message-publisher.interface';
import { EmbeddingOutboxRepository } from '../../database/repositories/embedding-outbox.repository';
import { SqsMessagePublisher } from '../publishers/sqs-message.publisher';
import { StructuredLogger, LogEvents } from '../../../common/logger';
import { EMPTY_RELAY_RESULT, relayOutboxBatch, type OutboxRelayResult } from './outbox-relay';

export type EmbeddingPollerBatchResult = OutboxRelayResult;

export interface EmbeddingOutboxPollerOptions {
  batchSize?: number;
  pollIntervalMs?: number;
  autoStart?: boolean;
}

/* SQS SendMessageBatch accepts at most 10 entries */
const MAX_SQS_BATCH = 10;

/**
 * Background poller that relays pending `embedding_outbox` events to the embedding SQS queue.
 *
 * @remarks
 * Runs only in the worker process (WORKER_ENABLED=true, set by main-worker.ts). Retry counting
 * and DLQ rerouting live in {@link relayOutboxBatch}.
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
    /* The injected publisher targets the ingestion queue; production uses a dedicated embedding-queue publisher */
    this.messagePublisher = options
      ? messagePublisher
      : new SqsMessagePublisher(this.configService, {
          queueUrl: this.appConfig.sqsEmbeddingQueueUrl,
          dlqUrl: this.appConfig.sqsEmbeddingDlqUrl,
        });

    this.batchSize = Math.min(
      options?.batchSize || this.configService.get<number>('OUTBOX_BATCH_SIZE') || MAX_SQS_BATCH,
      MAX_SQS_BATCH,
    );
    this.pollIntervalMs =
      options?.pollIntervalMs || this.configService.get<number>('OUTBOX_POLL_INTERVAL_MS') || 5000;
    this.maxRetries = this.configService.get<number>('OUTBOX_MAX_RETRIES') || 5;
  }

  onModuleInit(): void {
    const isWorker = this.configService.get<boolean>('WORKER_ENABLED') === true;
    const enabled = this.configService.get<boolean>('OUTBOX_POLLER_ENABLED') !== false;
    if (isWorker && enabled) {
      this.startPolling();
    } else {
      this.logger.debugEvent('outbox.embedding_poll.disabled', { isWorker, enabled });
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
      return { ...EMPTY_RELAY_RESULT };
    }

    this.isPolling = true;
    try {
      return await relayOutboxBatch({
        store: this.embeddingOutboxRepository,
        publisher: this.messagePublisher,
        batchSize: Math.min(customBatchSize || this.batchSize, MAX_SQS_BATCH),
        maxRetries: this.maxRetries,
        logger: this.logger,
        label: 'embedding',
      });
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
