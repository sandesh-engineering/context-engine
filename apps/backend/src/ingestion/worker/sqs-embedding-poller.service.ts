import {
  Injectable,
  Inject,
  Optional,
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
import { IngestionJobStage, IngestionJobStatus } from '../common/enums';
import { AppTracer, SemanticAttributes } from '../../common/telemetry';
import { StructuredLogger, LogEvents } from '../../common/logger';

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
 */
@Injectable()
export class SqsEmbeddingPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new StructuredLogger(SqsEmbeddingPollerService.name);
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
    @Optional() options?: SqsEmbeddingPollerOptions,
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
    const accessKeyId = this.configService.get<string>('AWS_ACCESS_KEY_ID');
    const secretAccessKey = this.configService.get<string>('AWS_SECRET_ACCESS_KEY');

    const sqsOptions: any = { region: awsRegion };
    if (endpoint) {
      sqsOptions.endpoint = endpoint;
    }
    if (accessKeyId && secretAccessKey) {
      sqsOptions.credentials = { accessKeyId, secretAccessKey };
    }

    this.sqsClient = options?.sqsClient || new SQSClient(sqsOptions);
  }

  onModuleInit(): void {
    /* Only the worker process consumes the queue; EMBEDDING_WORKER_ENABLED=false turns this consumer off there */
    const embeddingWorkerEnabled =
      this.appConfig.workerEnabled && this.appConfig.embeddingWorkerEnabled;

    if (embeddingWorkerEnabled) {
      this.startPoller();
    } else {
      this.logger.logEvent('embedding.worker.disabled', { workerEnabled: false });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopPoller();
  }

  startPoller(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.logger.logEvent('embedding.worker.started', {
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
    this.logger.logEvent('embedding.worker.stopping', { queueUrl: this.queueUrl });
    this.isRunning = false;
    await Promise.all(this.pollingPromises);
    this.pollingPromises = [];
    this.logger.logEvent('embedding.worker.stopped', { queueUrl: this.queueUrl });
  }

  private async runPollLoop(workerId: number): Promise<void> {
    while (this.isRunning) {
      try {
        const messages = await this.pollMessages();
        if (messages && messages.length > 0) {
          for (const message of messages) {
            if (!this.isRunning) break;
            await this.processEmbeddingMessage(message);
          }
        }
      } catch (error) {
        if (!this.isRunning) break;
        this.logger.logError('embedding.poll_loop.failed', error, {
          workerId,
          queueUrl: this.queueUrl,
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
   * Processes an individual SQS embedding message payload within an OpenTelemetry Consumer span.
   */
  async processEmbeddingMessage(sqsMessage: Message): Promise<void> {
    if (!sqsMessage.Body || !sqsMessage.ReceiptHandle) {
      return;
    }

    let parsedPayload: OutboxMessagePayload | null = null;
    try {
      parsedPayload = JSON.parse(sqsMessage.Body) as OutboxMessagePayload;
    } catch (err) {
      this.logger.logError(LogEvents.QUEUE_MESSAGE_FAILED, err, {
        messageId: sqsMessage.MessageId,
        receiptHandle: sqsMessage.ReceiptHandle,
        body: sqsMessage.Body,
      });
      await this.deleteSqsMessage(sqsMessage.ReceiptHandle);
      return;
    }

    const payloadObj = parsedPayload.payload as Record<string, unknown> | undefined;
    const versionId = payloadObj?.versionId as string;
    const jobId = payloadObj?.jobId as string | undefined;

    // Merge attributes from SQS MessageAttributes and parsedPayload metadata
    const messageAttributes = {
      ...(sqsMessage.MessageAttributes || {}),
    };

    if (!messageAttributes.traceparent && parsedPayload.traceparent) {
      messageAttributes.traceparent = {
        DataType: 'String',
        StringValue: parsedPayload.traceparent,
      };
    }
    if (!messageAttributes.tracestate && parsedPayload.tracestate) {
      messageAttributes.tracestate = {
        DataType: 'String',
        StringValue: parsedPayload.tracestate,
      };
    }

    return AppTracer.traceConsumer(
      'embedding.worker',
      messageAttributes,
      async (span) => {
        span.setAttribute(SemanticAttributes.MESSAGING_SYSTEM, 'aws.sqs');
        span.setAttribute(SemanticAttributes.MESSAGING_DESTINATION_NAME, this.queueUrl);
        span.setAttribute(SemanticAttributes.MESSAGING_OPERATION, 'consume');
        if (sqsMessage.MessageId) {
          span.setAttribute(SemanticAttributes.MESSAGING_MESSAGE_ID, sqsMessage.MessageId);
        }
        if (versionId) {
          span.setAttribute(SemanticAttributes.KE_VERSION_ID, versionId);
        }
        if (jobId) {
          span.setAttribute(SemanticAttributes.KE_JOB_ID, jobId);
        }

        if (!versionId) {
          this.logger.warnEvent('embedding.message.missing_version_id', {
            receiptHandle: sqsMessage.ReceiptHandle,
            parsedPayload,
          });
          await this.deleteSqsMessage(sqsMessage.ReceiptHandle!);
          return;
        }

        this.logger.logEvent(LogEvents.EMBEDDING_JOB_STARTED, {
          versionId,
          jobId,
          messageId: sqsMessage.MessageId,
        });

        const batchSize = this.appConfig.embeddingBatchSize;
        const abortController = new AbortController();

        try {
          let batchIndex = 0;
          let hasMore = true;
          while (hasMore) {
            const unembeddedChunks = await this.chunksRepository.fetchUnembeddedChunks(
              versionId,
              batchSize,
            );

            if (!unembeddedChunks || unembeddedChunks.length === 0) {
              hasMore = false;
              break;
            }

            batchIndex++;
            this.logger.logEvent(LogEvents.EMBEDDING_BATCH_STARTED, {
              versionId,
              jobId,
              batchIndex,
              batchCount: unembeddedChunks.length,
            });

            const texts = unembeddedChunks.map((c) => c.content);

            // Sub-span: embedding.ollama
            const embeddingResult = await AppTracer.traceSpan(
              'embedding.ollama',
              {
                attributes: {
                  [SemanticAttributes.KE_VERSION_ID]: versionId,
                  'batch.size': texts.length,
                },
              },
              async () =>
                this.embeddingProvider.generateEmbeddings(
                  { texts },
                  { signal: abortController.signal },
                ),
            );

            /* One non-empty vector per chunk, or the whole batch is retried */
            const vectors = embeddingResult.embeddings;
            if (
              vectors.length !== unembeddedChunks.length ||
              vectors.some((vector) => !Array.isArray(vector) || vector.length === 0)
            ) {
              throw new Error(
                `Embedding provider returned ${vectors.length} usable vectors for ${unembeddedChunks.length} chunks`,
              );
            }

            const chunkEmbeddings = unembeddedChunks.map((chunk, idx) => ({
              chunkId: chunk.id,
              embedding: vectors[idx]!,
            }));

            // Sub-span: embedding.persist
            await AppTracer.traceSpan(
              'embedding.persist',
              {
                attributes: {
                  [SemanticAttributes.KE_VERSION_ID]: versionId,
                  'chunk.count': chunkEmbeddings.length,
                },
              },
              async () => this.chunksRepository.updateBatchEmbeddings(chunkEmbeddings),
            );

            this.logger.logEvent(LogEvents.EMBEDDING_BATCH_COMPLETED, {
              versionId,
              jobId,
              batchIndex,
              batchCount: unembeddedChunks.length,
            });
          }

          /* Verify vector embedding persistence and complete ingestion job */
          await this.verifyEmbeddingPersistenceAndComplete(versionId, jobId);

          /* Delete message from SQS embedding queue after successful execution */
          await this.deleteSqsMessage(sqsMessage.ReceiptHandle!);

          this.logger.logEvent(LogEvents.EMBEDDING_JOB_COMPLETED, {
            versionId,
            jobId,
            messageId: sqsMessage.MessageId,
          });
        } catch (error) {
          abortController.abort();
          this.logger.logError(LogEvents.EMBEDDING_JOB_FAILED, error, {
            versionId,
            jobId,
            messageId: sqsMessage.MessageId,
          });
          /* Show the failure on the job. The message stays in the queue: a successful redelivery
             marks the job COMPLETED again, and SQS moves it to the DLQ after maxReceiveCount. */
          await this.markJobFailedSafely(versionId, jobId, error);
          throw error;
        }
      },
    );
  }

  /**
   * Verifies all document chunks for a version have received embeddings and updates job stage/status to COMPLETED.
   */
  private async verifyEmbeddingPersistenceAndComplete(
    versionId: string,
    jobId?: string,
  ): Promise<void> {
    const stats = await this.chunksRepository.countChunkStats(versionId);

    // If jobId wasn't provided in the payload, look it up by versionId
    let effectiveJobId = jobId;
    if (!effectiveJobId) {
      const job = await this.jobsRepository.findJobByVersionId(versionId);
      if (job) {
        effectiveJobId = job.id;
      }
    }

    this.logger.logEvent(LogEvents.EMBEDDING_PERSIST_COMPLETED, {
      versionId,
      jobId: effectiveJobId,
      totalChunks: stats.total,
      embeddedChunks: stats.embedded,
    });

    if (effectiveJobId && stats.total > 0 && stats.embedded === stats.total) {
      await this.jobsRepository.updateJobStage(effectiveJobId, IngestionJobStage.INDEXING);
      await this.jobsRepository.markJobCompleted(effectiveJobId);
      this.logger.logEvent(LogEvents.INGESTION_INTAKE_COMPLETED, {
        jobId: effectiveJobId,
        versionId,
        status: IngestionJobStatus.COMPLETED,
      });
    }
  }

  /**
   * Marks the version's job FAILED without masking the original embedding error.
   */
  private async markJobFailedSafely(
    versionId: string,
    jobId: string | undefined,
    error: unknown,
  ): Promise<void> {
    try {
      const effectiveJobId =
        jobId || (await this.jobsRepository.findJobByVersionId(versionId))?.id;
      if (effectiveJobId) {
        await this.jobsRepository.markJobFailed(
          effectiveJobId,
          `Embedding failed: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    } catch (markError) {
      this.logger.logError('embedding.job.mark_failed_error', markError, { versionId, jobId });
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
