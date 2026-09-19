import { SqsIngestionPollerService } from '../worker/sqs-ingestion-poller.service';
import { IngestionJobsRepository } from '../database/repositories/ingestion-jobs.repository';
import { AppConfigService } from '../../config/app-config.service';
import { IngestionJobStage, IngestionJobStatus } from '../common/enums';
import { DeleteMessageCommand } from '@aws-sdk/client-sqs';

describe('SqsIngestionPollerService Unit Tests', () => {
  let pollerService: SqsIngestionPollerService;
  let mockJobsRepository: jest.Mocked<IngestionJobsRepository>;
  let mockAppConfig: jest.Mocked<AppConfigService>;
  let mockConfigService: any;
  let mockSqsClient: any;

  beforeEach(() => {
    mockJobsRepository = {
      claimJobForProcessing: jest.fn(),
      findJobById: jest.fn(),
      markJobCompleted: jest.fn(),
      markJobFailed: jest.fn(),
    } as unknown as jest.Mocked<IngestionJobsRepository>;

    mockAppConfig = {
      workerEnabled: false,
      sqsIngestionQueueUrl: 'http://localhost:4566/000000000000/knowledge-engine-ingestion-queue',
      sqsPollWaitTimeSeconds: 20,
      sqsMaxNumberOfMessages: 10,
      sqsVisibilityTimeoutSeconds: 300,
      sqsPollerConcurrency: 1,
    } as unknown as jest.Mocked<AppConfigService>;

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        if (key === 'AWS_REGION') return 'us-east-1';
        return undefined;
      }),
    };

    mockSqsClient = {
      send: jest.fn(),
    };

    pollerService = new SqsIngestionPollerService(
      mockAppConfig,
      mockConfigService,
      mockJobsRepository,
      {
        sqsClient: mockSqsClient,
        queueUrl: 'http://localhost:4566/000000000000/knowledge-engine-ingestion-queue',
        waitTimeSeconds: 1,
        maxNumberOfMessages: 5,
      },
    );
  });

  it('should process claimed SQS message successfully and delete from queue', async () => {
    const message = {
      Body: JSON.stringify({
        eventId: 'evt-1',
        domain: 'INGESTION',
        eventType: 'ingestion.jobs',
        payload: { jobId: 'job-123', documentId: 'doc-456' },
      }),
      ReceiptHandle: 'rh-123',
    };

    mockJobsRepository.claimJobForProcessing.mockResolvedValue({
      claimed: true,
      job: {
        id: 'job-123',
        versionId: 'ver-1',
        status: IngestionJobStatus.PROCESSING,
        stage: IngestionJobStage.PARSING,
        attemptCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: {} as any,
      },
    });

    mockJobsRepository.markJobCompleted.mockResolvedValue();
    mockSqsClient.send.mockResolvedValue({});

    await pollerService.processSqsMessage(message);

    expect(mockJobsRepository.claimJobForProcessing).toHaveBeenCalledWith('job-123');
    expect(mockJobsRepository.markJobCompleted).toHaveBeenCalledWith('job-123');
    expect(mockSqsClient.send).toHaveBeenCalledWith(expect.any(DeleteMessageCommand));
  });

  it('should skip duplicate message when claim fails and delete message from queue', async () => {
    const message = {
      Body: JSON.stringify({
        eventId: 'evt-duplicate',
        payload: { jobId: 'job-dup' },
      }),
      ReceiptHandle: 'rh-duplicate',
    };

    mockJobsRepository.claimJobForProcessing.mockResolvedValue({
      claimed: false,
      job: {
        id: 'job-dup',
        versionId: 'ver-1',
        status: IngestionJobStatus.COMPLETED,
        stage: IngestionJobStage.INDEXING,
        attemptCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: {} as any,
      },
    });

    mockSqsClient.send.mockResolvedValue({});

    await pollerService.processSqsMessage(message);

    expect(mockJobsRepository.claimJobForProcessing).toHaveBeenCalledWith('job-dup');
    expect(mockJobsRepository.markJobCompleted).not.toHaveBeenCalled();
    /* Verify duplicate SQS message is deleted to acknowledge queue */
    expect(mockSqsClient.send).toHaveBeenCalledWith(expect.any(DeleteMessageCommand));
  });

  it('should mark job failed and NOT delete SQS message on processing failure', async () => {
    const message = {
      Body: JSON.stringify({
        eventId: 'evt-error',
        payload: { jobId: 'job-err' },
      }),
      ReceiptHandle: 'rh-err',
    };

    mockJobsRepository.claimJobForProcessing.mockResolvedValue({
      claimed: true,
      job: {
        id: 'job-err',
        versionId: 'ver-1',
        status: IngestionJobStatus.PROCESSING,
        stage: IngestionJobStage.PARSING,
        attemptCount: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        version: {} as any,
      },
    });

    /* Mock processing failure by forcing markJobCompleted or pipeline to throw */
    jest.spyOn(pollerService as any, 'executeJobPipeline').mockRejectedValue(new Error('Pipeline execution failed'));

    await expect(pollerService.processSqsMessage(message)).rejects.toThrow('Pipeline execution failed');

    expect(mockJobsRepository.markJobFailed).toHaveBeenCalledWith('job-err', 'Pipeline execution failed');
    /* Verify DeleteMessageCommand was NOT sent so message remains for visibility timeout / retry */
    expect(mockSqsClient.send).not.toHaveBeenCalledWith(expect.any(DeleteMessageCommand));
  });

  it('should handle unparseable JSON payload by deleting message from queue', async () => {
    const message = {
      Body: 'INVALID_JSON',
      ReceiptHandle: 'rh-invalid',
    };

    mockSqsClient.send.mockResolvedValue({});

    await pollerService.processSqsMessage(message);

    expect(mockJobsRepository.claimJobForProcessing).not.toHaveBeenCalled();
    expect(mockSqsClient.send).toHaveBeenCalledWith(expect.any(DeleteMessageCommand));
  });
});
