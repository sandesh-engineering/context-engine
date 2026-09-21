import {
  Injectable,
  Logger,
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
import { OutboxMessagePayload } from '../messaging/interfaces/message-publisher.interface';

/**
 * Configuration options for SqsIngestionPollerService initialization.
 */
import { IngestionPipelineExecutor } from '../pipeline/ingestion-pipeline.executor';

export interface SqsIngestionPollerOptions {
  /* Pre-configured SQSClient instance for AWS SQS operations */
  sqsClient?: SQSClient;
  /* Target AWS SQS Queue URL */
  queueUrl?: string;
  /* Long polling wait time in seconds (0 to 20s) */
  waitTimeSeconds?: number;
  /* Maximum number of messages to fetch per poll batch (1 to 10) */
  maxNumberOfMessages?: number;
  /* Visibility timeout in seconds for in-flight messages */
  visibilityTimeoutSeconds?: number;
  /* Number of concurrent long-polling loops */
  concurrency?: number;
  /* Ingestion pipeline executor service */
  pipelineExecutor?: IngestionPipelineExecutor;
}

/**
 * AWS SQS background worker poller service.
 *
 * @remarks
 * - Continuously long-polls AWS SQS queue (`knowledge-engine-ingestion-queue`) for job dispatch events.
 * - Enforces atomic database job claiming against PostgreSQL (`IngestionJobStage.AVAILABLE`) to ensure idempotency.
 * - Acknowledges and deletes processed or duplicate messages from SQS.
 */
@Injectable()
export class SqsIngestionPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SqsIngestionPollerService.name);
  private readonly sqsClient: SQSClient;
  private readonly queueUrl: string;
  private readonly waitTimeSeconds: number;
  private readonly maxNumberOfMessages: number;
  private readonly visibilityTimeoutSeconds: number;
  private readonly concurrency: number;
  private readonly pipelineExecutor?: IngestionPipelineExecutor;

  private isRunning = false;
  private pollingPromises: Promise<void>[] = [];

  constructor(
    private readonly appConfig: AppConfigService,
    private readonly configService: ConfigService,
    private readonly jobsRepository: IngestionJobsRepository,
    @Optional() options?: SqsIngestionPollerOptions,
  ) {
    this.pipelineExecutor = options?.pipelineExecutor;
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

  /**
   * NestJS Lifecycle Hook: Initiates SQS long polling worker loops when module initializes.
   *
   * @remarks
   * Evaluates `WORKER_ENABLED` environment configuration to determine whether to launch background loops.
   */
  onModuleInit(): void {
    if (this.appConfig.workerEnabled || process.env.WORKER_ENABLED === 'true') {
      this.startPoller();
    } else {
      this.logger.log('SqsIngestionPollerService disabled', { workerEnabled: false });
    }
  }

  /**
   * NestJS Lifecycle Hook: Gracefully terminates long polling loops when module shuts down.
   *
   * @returns {Promise<void>}
   */
  async onModuleDestroy(): Promise<void> {
    await this.stopPoller();
  }

  /**
   * Starts the SQS long-polling worker loops.
   *
   * @remarks
   * Spawns worker polling loops up to the configured `concurrency` level.
   */
  startPoller(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.logger.log('Starting SQS Ingestion Poller', {
      queueUrl: this.queueUrl,
      concurrency: this.concurrency,
      waitTimeSeconds: this.waitTimeSeconds,
      maxMessages: this.maxNumberOfMessages,
    });

    for (let i = 0; i < this.concurrency; i++) {
      this.pollingPromises.push(this.runPollLoop(i));
    }
  }

  /**
   * Stops the worker polling loop gracefully and awaits in-flight message processing.
   *
   * @returns {Promise<void>}
   */
  async stopPoller(): Promise<void> {
    if (!this.isRunning) {
      return;
    }
    this.logger.log('Stopping SQS Ingestion Poller', { queueUrl: this.queueUrl });
    this.isRunning = false;
    await Promise.all(this.pollingPromises);
    this.pollingPromises = [];
    this.logger.log('SQS Ingestion Poller stopped cleanly', { queueUrl: this.queueUrl });
  }

  /**
   * Internal worker polling loop executing continuous SQS long polling requests.
   *
   * @param {number} workerId - Zero-indexed identifier for the worker concurrency loop
   * @returns {Promise<void>}
   */
  private async runPollLoop(workerId: number): Promise<void> {
    while (this.isRunning) {
      try {
        const messages = await this.pollMessages();
        if (messages && messages.length > 0) {
          this.logger.debug('Worker received SQS messages', {
            workerId,
            messageCount: messages.length,
          });
          for (const message of messages) {
            if (!this.isRunning) break;
            await this.processSqsMessage(message);
          }
        }
      } catch (error) {
        if (!this.isRunning) break;
        this.logger.error('Unhandled error in worker poll loop', {
          workerId,
          queueUrl: this.queueUrl,
          error: error instanceof Error ? error.message : String(error),
        });
        /* Small backoff on loop error to prevent tight error spinning */
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
  }

  /**
   * Executes a single SQS `ReceiveMessageCommand` long-poll invocation.
   *
   * @returns {Promise<Message[]>} Array of received SQS message objects
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
   * Processes an individual SQS message payload atomically and handles deletion and idempotency.
   *
   * @remarks
   * - Parses SQS JSON message payload.
   * - Enforces pipeline stage validation: job MUST be in `AVAILABLE` stage to be claimed.
   * - Deletes acknowledged duplicate or invalid messages from SQS queue.
   * - Leaves unhandled processing errors in SQS to trigger visibility timeout / DLQ redrive.
   *
   * @param {Message} sqsMessage - Native SQS message object
   * @returns {Promise<void>}
   * @throws {Error} Throws if job processing pipeline fails
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
      /* Delete unparseable poison message from queue */
      await this.deleteSqsMessage(sqsMessage.ReceiptHandle);
      return;
    }

    const payloadObj = parsedPayload.payload as Record<string, unknown> | undefined;
    const jobId = (payloadObj?.jobId as string) || (parsedPayload.eventId as string);

    if (!jobId) {
      this.logger.warn('SQS message payload missing jobId or eventId', {
        receiptHandle: sqsMessage.ReceiptHandle,
        parsedPayload,
      });
      await this.deleteSqsMessage(sqsMessage.ReceiptHandle);
      return;
    }

    /* Atomic SQL stage claim (must be in SOURCE_READY stage to transition to PARSING) */
    const { claimed, job } = await this.jobsRepository.claimJobForProcessing(jobId);

    if (!claimed) {
      this.logger.warn('Skipping duplicate or unclaimable job message', {
        jobId,
        currentStage: job?.stage || 'UNKNOWN',
        currentStatus: job?.status || 'UNKNOWN',
      });
      /* Delete acknowledged duplicate message from SQS queue */
      await this.deleteSqsMessage(sqsMessage.ReceiptHandle);
      return;
    }

    try {
      this.logger.log('Commencing processing for claimed job', { jobId });

      /* Business logic processing execution point (Parsing & Chunking) */
      await this.executeJobPipeline(jobId);

      /* Delete message from SQS after successful parsing & chunking stage execution */
      await this.deleteSqsMessage(sqsMessage.ReceiptHandle);
      this.logger.log('Successfully processed parsing and chunking for job', { jobId });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error('Job processing failed', { jobId, error: errorMessage });
      await this.jobsRepository.markJobFailed(jobId, errorMessage);
      /* DO NOT delete message from SQS; leave for SQS visibility timeout / DLQ redrive */
      throw error;
    }
  }

  /**
   * Executes ingestion job pipeline processing steps using IngestionPipelineExecutor.
   *
   * @param {string} jobId - Primary key identifier of target ingestion job
   * @returns {Promise<void>}
   */
  private async executeJobPipeline(jobId: string): Promise<void> {
    if (this.pipelineExecutor) {
      await this.pipelineExecutor.executePipeline(jobId);
    } else {
      this.logger.debug('Ingestion pipeline executed (standalone mock mode)', { jobId });
    }
  }

  /**
   * Deletes a processed SQS message from queue using its receipt handle.
   *
   * @param {string} receiptHandle - SQS receipt handle string
   * @returns {Promise<void>}
   */
  private async deleteSqsMessage(receiptHandle: string): Promise<void> {
    const command = new DeleteMessageCommand({
      QueueUrl: this.queueUrl,
      ReceiptHandle: receiptHandle,
    });
    await this.sqsClient.send(command);
  }
}
