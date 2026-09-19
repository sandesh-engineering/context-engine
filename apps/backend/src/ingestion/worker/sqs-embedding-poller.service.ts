import {
  Injectable,
  Inject,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  SQSClient,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  Message,
} from '@aws-sdk/client-sqs';
import { AppConfigService } from '../../config/app-config.service';
import { IngestionJobsRepository } from '../database/repositories/ingestion-jobs.repository';
import { DocumentChunksRepository } from '../database/repositories/document-chunks.repository';
import {
  EMBEDDING_PROVIDER,
  type IEmbeddingProvider,
} from '../embeddings/interfaces/embedding-provider.interface';
import { OutboxMessagePayload } from '../messaging/interfaces/message-publisher.interface';
import { IngestionJobStage } from '../common/enums';

export interface SqsEmbeddingPollerOptions {
  sqsClient?: SQSClient;
  queueUrl?: string;
  waitTimeSeconds?: number;
  maxNumberOfMessages?: number;
  visibilityTimeoutSeconds?: number;
  concurrency?: number;
}

/**
 * AWS SQS background worker poller service for vector embedding generation.
 *
 * @remarks
 * - Long-polls AWS SQS embedding queue for `document.embedding.v1` events.
 * - Fetches unembedded document chunks, generates dense vector embeddings via `IEmbeddingProvider`.
 * - Bulk-updates vector embeddings in PostgreSQL `document_chunks` table.
 * - Confirms vector indexing completion and updates ingestion job status upon completion.
 */
@Injectable()
export class SqsEmbeddingPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsEmbeddingPollerService.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;
  private readonly waitTimeSeconds: number;
  private readonly maxNumberOfMessages: number;
  private readonly visibilityTimeoutSeconds: number;
  private readonly concurrency: number;

  private isRunning = false;
  private pollingPromises: Promise<void>[] = [];

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly configService: ConfigService,
    private readonly jobsRepository: IngestionJobsRepository,
    private readonly chunksRepository: DocumentChunksRepository,
    @Inject(EMBEDDING_PROVIDER)
    private readonly embeddingProvider: IEmbeddingProvider,
    options?: SqsEmbeddingPollerOptions,
  ) {
    this.queueUrl =
      options?.queueUrl ||
      this.appConfig.sqsEmbeddingQueueUrl ||
      'http://localhost:4566/000000000000/knowledge-engine-embedding-queue';

    this.waitTimeSeconds =
      options?.waitTimeSeconds ?? this.appConfig.sqsPollWaitTimeSeconds;

    this.maxNumberOfMessages =
      options?.maxNumberOfMessages ?? this.appConfig.sqsMaxNumberOfMessages;

    this.visibilityTimeoutSeconds =
      options?.visibilityTimeoutSeconds ?? this.appConfig.sqsVisibilityTimeoutSeconds;

    this.concurrency =
      options?.concurrency ?? this.appConfig.sqsPollerConcurrency;

    const awsRegion = this.configService.get<string>('AWS_REGION') || 'us-east-1';
    const endpoint = this.configService.get<string>('AWS_ENDPOINT_URL');

    this.sqsClient =
      options?.sqsClient ||
      new SQSClient({
        region: awsRegion,
        ...(endpoint ? { endpoint } : {}),
      });
  }

  onModuleInit(): void {
    const embeddingWorkerEnabled =
      this.configService.get<string>('EMBEDDING_WORKER_ENABLED') === 'true' ||
      this.appConfig.workerEnabled ||
      process.env.WORKER_ENABLED === 'true';

    if (embeddingWorkerEnabled) {
      this.startPoller();
    } else {
      this.logger.log('SqsEmbeddingPollerService disabled', { workerEnabled: false });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopPoller();
  }

  startPoller(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.log('Starting SQS Embedding Poller worker', {
      queueUrl: this.queueUrl,
      concurrency: this.concurrency,
      waitTimeSeconds: this.waitTimeSeconds,
      maxMessages: this.maxNumberOfMessages,
    });

    for (let i = 0; i < this.concurrency; i++) {
      this.pollingPromises.push(this.runPollLoop(i));
    }
  }

  async stopPoller(): Promise<void> {
    if (!this.isRunning) return;
    this.logger.log('Stopping SQS Embedding Poller worker', { queueUrl: this.queueUrl });
    this.isRunning = false;
    await Promise.all(this.pollingPromises);
    this.pollingPromises = [];
    this.logger.log('SQS Embedding Poller stopped cleanly', { queueUrl: this.queueUrl });
  }

  private async runPollLoop(workerId: number): Promise<void> {
    while (this.isRunning) {
      try {
        const messages = await this.pollMessages();
        if (messages && messages.length > 0) {
          this.logger.debug('Worker received embedding SQS messages', {
            workerId,
            messageCount: messages.length,
          });
          for (const message of messages) {
            if (!this.isRunning) break;
            await this.processEmbeddingMessage(message);
          }
        }
      } catch (error) {
        if (!this.isRunning) break;
        this.logger.error('Unhandled error in embedding worker poll loop', {
          workerId,
          queueUrl: this.queueUrl,
          error: error instanceof Error ? error.message : String(error),
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  private async pollMessages(): Promise<Message[]> {
    const command = new ReceiveMessageCommand({
      QueueUrl: this.queueUrl,
      WaitTimeSeconds: this.waitTimeSeconds,
      MaxNumberOfMessages: this.maxNumberOfMessages,
      VisibilityTimeout: this.visibilityTimeoutSeconds,
      AttributeNames: ['All'],
      MessageAttributeNames: ['All'],
    });

    const response = await this.sqsClient.send(command);
    return response.Messages || [];
  }

  /**
   * Processes an individual SQS embedding message payload, generating dense vectors with AbortSignal protection.
   *
   * @param {Message} sqsMessage - Native SQS message object
   * @returns {Promise<void>}
   */
  async processEmbeddingMessage(sqsMessage: Message): Promise<void> {
    if (!sqsMessage.Body || !sqsMessage.ReceiptHandle) {
      return;
    }

    let parsedPayload: OutboxMessagePayload | null = null;
    try {
      parsedPayload = JSON.parse(sqsMessage.Body) as OutboxMessagePayload;
    } catch (err) {
      this.logger.error('Failed to parse embedding SQS message JSON body', {
        receiptHandle: sqsMessage.ReceiptHandle,
        body: sqsMessage.Body,
      });
      await this.deleteSqsMessage(sqsMessage.ReceiptHandle);
      return;
    }

    const payloadObj = parsedPayload.payload as Record<string, unknown> | undefined;
    const versionId = payloadObj?.versionId as string;
    const jobId = payloadObj?.jobId as string | undefined;
    const traceId =
      parsedPayload.traceId ||
      (sqsMessage.MessageAttributes?.traceId?.StringValue as string) ||
      undefined;

    if (!versionId) {
      this.logger.warn('Embedding SQS message missing versionId', {
        receiptHandle: sqsMessage.ReceiptHandle,
        parsedPayload,
        traceId,
      });
      await this.deleteSqsMessage(sqsMessage.ReceiptHandle);
      return;
    }

    this.logger.log('Processing vector embeddings for version', { versionId, jobId, traceId });

    const batchSize = this.appConfig.embeddingBatchSize;
    const abortController = new AbortController();

    try {
      while (this.isRunning) {
        const unembeddedChunks = await this.chunksRepository.fetchUnembeddedChunks(
          versionId,
          batchSize,
        );

        if (!unembeddedChunks || unembeddedChunks.length === 0) {
          break;
        }

        this.logger.log('Generating embeddings for chunk batch', {
          versionId,
          batchCount: unembeddedChunks.length,
          traceId,
        });

        const texts = unembeddedChunks.map((c) => c.content);
        const embeddingResult = await this.embeddingProvider.generateEmbeddings(
          { texts },
          { signal: abortController.signal },
        );

        const chunkEmbeddings = unembeddedChunks.map((chunk, idx) => ({
          chunkId: chunk.id,
          embedding: embeddingResult.embeddings[idx] || [],
        }));

        await this.chunksRepository.updateBatchEmbeddings(chunkEmbeddings);
      }

      /* Verify vector embedding persistence and complete ingestion job */
      await this.verifyEmbeddingPersistenceAndComplete(versionId, jobId, traceId);

      /* Delete message from SQS embedding queue after successful execution */
      await this.deleteSqsMessage(sqsMessage.ReceiptHandle);
      this.logger.log('Acknowledged and deleted embedding SQS message', { versionId, traceId });
    } catch (error) {
      abortController.abort();
      this.logger.error('Failed processing embedding batch message', {
        versionId,
        jobId,
        traceId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Verifies all document chunks for a version have received embeddings and updates job stage/status to COMPLETED.
   *
   * @param {string} versionId - Target document version UUID
   * @param {string} [jobId] - Optional associated ingestion job UUID
   * @param {string} [traceId] - Distributed tracing correlation ID
   * @returns {Promise<void>}
   */
  private async verifyEmbeddingPersistenceAndComplete(
    versionId: string,
    jobId?: string,
    traceId?: string,
  ): Promise<void> {
    const stats = await this.chunksRepository.countChunkStats(versionId);
    this.logger.log('Confirmed chunk embedding completion stats', {
      versionId,
      totalChunks: stats.total,
      embeddedChunks: stats.embedded,
      traceId,
    });

    if (jobId && stats.total > 0 && stats.embedded === stats.total) {
      await this.jobsRepository.updateJobStage(jobId, IngestionJobStage.INDEXING);
      await this.jobsRepository.markJobCompleted(jobId);
      this.logger.log('Marked ingestion job completed following embedding persistence verification', {
        jobId,
        versionId,
        traceId,
      });
    }
  }

  private async deleteSqsMessage(receiptHandle: string): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });
    await this.sqsClient.send(command);
  }
}
