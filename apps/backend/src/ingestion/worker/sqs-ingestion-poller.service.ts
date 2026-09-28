import {
  Injectable,
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
import { IngestionPipelineExecutor } from '../pipeline/ingestion-pipeline.executor';
import { AppTracer, SemanticAttributes } from '../../common/telemetry';
import { StructuredLogger, LogEvents } from '../../common/logger';

export interface SqsIngestionPollerOptions {
  sqsClient?: SQSClient;
  queueUrl?: string;
  waitTimeSeconds?: number;
  maxNumberOfMessages?: number;
  visibilityTimeoutSeconds?: number;
  concurrency?: number;
  pipelineExecutor?: IngestionPipelineExecutor;
}

/**
 * AWS SQS background worker poller service for ingestion jobs.
 */
@Injectable()
export class SqsIngestionPollerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new StructuredLogger(SqsIngestionPollerService.name);
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

  onModuleInit(): void {
    if (this.appConfig.workerEnabled || process.env.WORKER_ENABLED === 'true') {
      this.startPoller();
    } else {
      this.logger.logEvent('ingestion.worker.disabled', { workerEnabled: false });
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.stopPoller();
  }

  startPoller(): void {
    if (this.isRunning) {
      return;
    }
    this.isRunning = true;
    this.logger.logEvent('ingestion.worker.started', {
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
    if (!this.isRunning) {
      return;
    }
    this.logger.logEvent('ingestion.worker.stopping', { queueUrl: this.queueUrl });
    this.isRunning = false;
    await Promise.all(this.pollingPromises);
    this.pollingPromises = [];
    this.logger.logEvent('ingestion.worker.stopped', { queueUrl: this.queueUrl });
  }

  private async runPollLoop(workerId: number): Promise<void> {
    while (this.isRunning) {
      try {
        const messages = await this.pollMessages();
        if (messages && messages.length > 0) {
          for (const message of messages) {
            if (!this.isRunning) break;
            await this.processSqsMessage(message);
          }
        }
      } catch (error) {
        if (!this.isRunning) break;
        this.logger.logError('ingestion.poll_loop.failed', error, {
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
   * Processes an individual SQS message payload atomically within an OpenTelemetry Consumer span.
   */
  async processSqsMessage(sqsMessage: Message): Promise<void> {
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
    const jobId = (payloadObj?.jobId as string) || (parsedPayload.eventId as string);

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
      'ingestion.worker',
      messageAttributes,
      async (span) => {
        span.setAttribute(SemanticAttributes.MESSAGING_SYSTEM, 'aws.sqs');
        span.setAttribute(SemanticAttributes.MESSAGING_DESTINATION_NAME, this.queueUrl);
        span.setAttribute(SemanticAttributes.MESSAGING_OPERATION, 'consume');
        if (sqsMessage.MessageId) {
          span.setAttribute(SemanticAttributes.MESSAGING_MESSAGE_ID, sqsMessage.MessageId);
        }
        if (jobId) {
          span.setAttribute(SemanticAttributes.KE_JOB_ID, jobId);
        }
        if (parsedPayload?.eventId) {
          span.setAttribute(SemanticAttributes.KE_EVENT_ID, parsedPayload.eventId);
        }

        this.logger.debugEvent(LogEvents.QUEUE_MESSAGE_RECEIVED, {
          jobId,
          eventId: parsedPayload?.eventId,
          messageId: sqsMessage.MessageId,
          queue: this.queueUrl,
        });

        if (!jobId) {
          this.logger.warnEvent('queue.message.missing_job_id', {
            receiptHandle: sqsMessage.ReceiptHandle,
            parsedPayload,
          });
          await this.deleteSqsMessage(sqsMessage.ReceiptHandle!);
          return;
        }

        /* Atomic SQL stage claim (must be in SOURCE_READY stage to transition to PARSING) */
        const { claimed, job } = await this.jobsRepository.claimJobForProcessing(jobId);

        if (!claimed) {
          this.logger.warnEvent(LogEvents.QUEUE_DUPLICATE_SKIPPED, {
            jobId,
            currentStage: job?.stage || 'UNKNOWN',
            currentStatus: job?.status || 'UNKNOWN',
          });
          await this.deleteSqsMessage(sqsMessage.ReceiptHandle!);
          return;
        }

        try {
          this.logger.logEvent(LogEvents.INGESTION_JOB_CLAIMED, {
            jobId,
            documentId: job?.version?.documentId,
            versionId: job?.versionId,
          });

          /* Business logic processing execution point (Parsing & Chunking) */
          await this.executeJobPipeline(jobId);

          /* Delete message from SQS after successful parsing & chunking stage execution */
          await this.deleteSqsMessage(sqsMessage.ReceiptHandle!);

          this.logger.logEvent(LogEvents.INGESTION_JOB_COMPLETED, {
            jobId,
            messageId: sqsMessage.MessageId,
          });
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          this.logger.logError(LogEvents.INGESTION_JOB_FAILED, error, {
            jobId,
            messageId: sqsMessage.MessageId,
          });
          await this.jobsRepository.markJobFailed(jobId, errorMessage);
          /* DO NOT delete message from SQS; leave for SQS visibility timeout / DLQ redrive */
          throw error;
        }
      },
    );
  }

  private async executeJobPipeline(jobId: string): Promise<void> {
    if (this.pipelineExecutor) {
      await this.pipelineExecutor.executePipeline(jobId);
    } else {
      this.logger.debugEvent('ingestion.pipeline.mock_mode', { jobId });
      await this.jobsRepository.markJobCompleted(jobId);
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
