import {
  Injectable,
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
import { IngestionJobStatus, IngestionJobStage } from '../common/enums';
import { OutboxMessagePayload } from '../messaging/interfaces/message-publisher.interface';

export interface SqsIngestionPollerOptions {
  sqsClient?: SQSClient;
  queueUrl?: string;
  waitTimeSeconds?: number;
  maxNumberOfMessages?: number;
  visibilityTimeoutSeconds?: number;
  concurrency?: number;
}

@Injectable()
export class SqsIngestionPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsIngestionPollerService.name);
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
    options?: SqsIngestionPollerOptions,
  ) {
    this.queueUrl =
      options?.queueUrl ||
      this.appConfig.sqsIngestionQueueUrl ||
      'http://localhost:4566/000000000000/knowledge-engine-ingestion-queue';

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

  /**
   * NestJS Lifecycle Hook: Initiates SQS long polling worker loop when module initializes.
   */
  onModuleInit(): void {
    if (this.appConfig.workerEnabled || process.env.WORKER_ENABLED === 'true') {
      this.startPoller();
    } else {
      this.logger.log('SqsIngestionPollerService disabled (WORKER_ENABLED=false)');
    }
  }

  /**
   * NestJS Lifecycle Hook: Gracefully terminates long polling loops when module shuts down.
   */
  async onModuleDestroy(): Promise<void> {
    await this.stopPoller();
  }

  /**
   * Manually starts the SQS long-polling worker loops.
   */
  startPoller(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.logger.log(
      `Starting SQS Ingestion Poller [queueUrl=${this.queueUrl}, concurrency=${this.concurrency}, waitTime=${this.waitTimeSeconds}s]`,
    );

    for (let i = 0; i < this.concurrency; i++) {
      this.pollingPromises.push(this.runPollLoop(i));
    }
  }

  /**
   * Manually stops the worker polling loop and awaits in-flight message processing.
   */
  async stopPoller(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    this.logger.log('Stopping SQS Ingestion Poller...');
    this.isRunning = false;
    await Promise.all(this.pollingPromises);
    this.pollingPromises = [];
    this.logger.log('SQS Ingestion Poller stopped cleanly');
  }

  /**
   * Internal worker polling loop executing SQS long polling requests continuously.
   */
  private async runPollLoop(workerId: number): Promise<void> {
    while (this.isRunning) {
      try {
        const messages = await this.pollMessages();
        if (messages && messages.length > 0) {
          this.logger.debug(
            `Worker #${workerId} received ${messages.length} SQS message(s)`,
          );
          for (const message of messages) {
            if (!this.isRunning) break;
            await this.processSqsMessage(message);
          }
        }
      } catch (error) {
        if (!this.isRunning) break;
        this.logger.error(
          `Unhandled error in worker #${workerId} poll loop: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        // Small backoff on loop error to prevent tight error spinning
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Executes a single SQS `ReceiveMessageCommand` long-poll invocation.
   */
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
   * Processes an individual SQS message payload atomically and handles deletion / idempotency.
   *
   * @param {Message} sqsMessage - Native SQS message object
   */
  async processSqsMessage(sqsMessage: Message): Promise<void> {
    if (!sqsMessage.Body || !sqsMessage.ReceiptHandle) {
      return;
    }

    let parsedPayload: OutboxMessagePayload | null = null;
    try {
      parsedPayload = JSON.parse(sqsMessage.Body) as OutboxMessagePayload;
    } catch (err) {
      this.logger.error('Failed to parse SQS message JSON body', {
        receiptHandle: sqsMessage.ReceiptHandle,
        body: sqsMessage.Body,
      });
      // Delete unparseable poison message from queue
      await this.deleteSqsMessage(sqsMessage.ReceiptHandle);
      return;
    }

    const payloadObj = parsedPayload.payload as Record<string, unknown> | undefined;
    const jobId = (payloadObj?.jobId as string) || (parsedPayload.eventId as string);

    if (!jobId) {
      this.logger.warn('SQS message missing jobId or eventId payload field', {
        parsedPayload,
      });
      await this.deleteSqsMessage(sqsMessage.ReceiptHandle);
      return;
    }

    // Atomic SQL stage claim (AVAILABLE -> PARSING/PROCESSING)
    const { claimed, job } = await this.jobsRepository.claimJobForProcessing(jobId);

    if (!claimed) {
      this.logger.warn(
        `Skipping duplicate or unclaimable job message [jobId=${jobId}, currentStage=${
          job?.stage || 'UNKNOWN'
        }, currentStatus=${job?.status || 'UNKNOWN'}]`,
      );
      // Delete acknowledged duplicate message from SQS queue
      await this.deleteSqsMessage(sqsMessage.ReceiptHandle);
      return;
    }

    try {
      this.logger.log(`Commencing processing for claimed job [jobId=${jobId}]`);

      // Business logic processing execution point
      await this.executeJobPipeline(jobId);

      // Mark job completed in database
      await this.jobsRepository.markJobCompleted(jobId);

      // Delete message from SQS after successful execution
      await this.deleteSqsMessage(sqsMessage.ReceiptHandle);
      this.logger.log(`Successfully processed and acknowledged job [jobId=${jobId}]`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`Job processing failed [jobId=${jobId}]: ${errorMessage}`);
      await this.jobsRepository.markJobFailed(jobId, errorMessage);
      // DO NOT delete message from SQS; leave for SQS visibility timeout / DLQ redrive
      throw error;
    }
  }

  /**
   * Executes ingestion job pipeline processing steps.
   */
  private async executeJobPipeline(jobId: string): Promise<void> {
    // Placeholder pipeline processing hook (e.g. document download, parsing, chunking, embedding)
    this.logger.debug(`Ingestion pipeline executed for job ${jobId}`);
  }

  /**
   * Deletes a processed SQS message from queue using its receipt handle.
   */
  private async deleteSqsMessage(receiptHandle: string): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });
    await this.sqsClient.send(command);
  }
}
