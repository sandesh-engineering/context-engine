import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { IngestionJobEntity } from '../entities/ingestion-job.entity';
import { DocumentVersionEntity } from '../entities/document-version.entity';
import { IngestionJobStage, IngestionJobStatus } from '../../common/enums';

/**
 * Result structure returned by atomic job claim operation.
 */
/* Stages the ingestion worker owns; later stages belong to the embedding worker */
const CLAIMABLE_STAGES = [
  IngestionJobStage.SOURCE_READY,
  IngestionJobStage.PARSING,
  IngestionJobStage.CHUNKING,
];

export interface ClaimJobResult {
  /* Indicates whether atomic stage transition succeeded */
  claimed: boolean;
  /* Current state of ingestion job entity, or null if job not found */
  job: IngestionJobEntity | null;
}

/**
 * Dedicated repository abstraction for managing IngestionJob database persistence.
 */
@Injectable()
export class IngestionJobsRepository {
  private readonly repository: Repository<IngestionJobEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.repository = this.dataSource.getRepository(IngestionJobEntity);
  }

  /**
   * Atomically claims an ingestion job for (re)processing.
   *
   * @remarks
   * A job can be claimed when it is in a parse/chunk stage and either:
   * - has not started yet (`PENDING`),
   * - failed earlier (`FAILED`) and its SQS message was redelivered for a retry, or
   * - is `PROCESSING` but has not been touched for `staleAfterSeconds` (its worker crashed).
   *
   * Fresh jobs move from `SOURCE_READY` to `PARSING`; resumed jobs keep their checkpoint stage so
   * finished stages are not repeated. `attempt_count` is incremented on every claim. The single
   * `UPDATE ... WHERE` makes the claim atomic across workers.
   *
   * @param {string} jobId - Primary key of the ingestion job
   * @param {number} staleAfterSeconds - Age after which a PROCESSING job counts as abandoned
   * @returns {Promise<ClaimJobResult>} Whether the claim succeeded, plus the job's current state
   */
  async claimJobForProcessing(jobId: string, staleAfterSeconds: number): Promise<ClaimJobResult> {
    const result = await this.repository
      .createQueryBuilder()
      .update(IngestionJobEntity)
      .set({
        stage: () =>
          `CASE WHEN "stage" = 'SOURCE_READY' THEN 'PARSING'::"public"."ingestion_jobs_stage_enum" ELSE "stage" END`,
        status: IngestionJobStatus.PROCESSING,
        attemptCount: () => '"attempt_count" + 1',
        errorMessage: () => 'NULL',
        updatedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('id = :jobId', { jobId })
      .andWhere('stage IN (:...claimableStages)', {
        claimableStages: CLAIMABLE_STAGES,
      })
      .andWhere(
        `(status IN (:...idleStatuses) OR (status = :processing AND updated_at < CURRENT_TIMESTAMP - make_interval(secs => :staleAfterSeconds)))`,
        {
          idleStatuses: [IngestionJobStatus.PENDING, IngestionJobStatus.FAILED],
          processing: IngestionJobStatus.PROCESSING,
          staleAfterSeconds,
        },
      )
      .execute();

    const job = await this.repository.findOne({
      where: { id: jobId },
      relations: ['version'],
    });

    return { claimed: Boolean(result.affected && result.affected > 0), job };
  }

  /**
   * Refreshes `updated_at` so a long-running job is not treated as abandoned.
   *
   * @param {string} jobId - Primary key of the ingestion job
   */
  async touchJob(jobId: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(IngestionJobEntity)
      .set({ updatedAt: () => 'CURRENT_TIMESTAMP' })
      .where('id = :jobId AND status = :processing', {
        jobId,
        processing: IngestionJobStatus.PROCESSING,
      })
      .execute();
  }

  /**
   * Retrieves an ingestion job entity by its primary UUID key with version relation loaded.
   *
   * @param {string} jobId - Primary key of ingestion job
   * @returns {Promise<IngestionJobEntity | null>} Ingestion job entity or null if not found
   * @throws {Error} Throws if database lookup fails
   *
   * @example
   * ```ts
   * const job = await repo.findJobById('job-123');
   * ```
   */
  async findJobById(jobId: string): Promise<IngestionJobEntity | null> {
    return this.repository.findOne({
      where: { id: jobId },
      relations: ['version'],
    });
  }

  /**
   * Retrieves an ingestion job entity by document version UUID.
   *
   * @param {string} versionId - Document version UUID
   * @returns {Promise<IngestionJobEntity | null>} Ingestion job entity or null if not found
   */
  async findJobByVersionId(versionId: string): Promise<IngestionJobEntity | null> {
    return this.repository.findOne({
      where: { versionId },
      relations: ['version'],
    });
  }
  /**
   * Updates an ingestion job status to COMPLETED and sets final pipeline stage to INDEXING.
   *
   * @remarks
   * - Uses database-native `CURRENT_TIMESTAMP` for `updated_at` to prevent clock drift.
   *
   * @param {string} jobId - Primary key of ingestion job
   * @returns {Promise<void>}
   * @throws {Error} Throws if database update fails
   *
   * @example
   * ```ts
   * await repo.markJobCompleted('job-123');
   * ```
   */
  async markJobCompleted(jobId: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(IngestionJobEntity)
      .set({
        status: IngestionJobStatus.COMPLETED,
        stage: IngestionJobStage.INDEXING,
        /* A retry that succeeds clears the error left by an earlier attempt */
        errorMessage: () => 'NULL',
        updatedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('id = :jobId', { jobId })
      .execute();
  }

  /**
   * Updates an ingestion job status to FAILED with associated diagnostic error message.
   *
   * @remarks
   * - Uses database-native `CURRENT_TIMESTAMP` for `updated_at` to prevent clock drift.
   *
   * @param {string} jobId - Primary key of ingestion job
   * @param {string} errorMessage - Detailed failure description
   * @returns {Promise<void>}
   * @throws {Error} Throws if database update fails
   *
   * @example
   * ```ts
   * await repo.markJobFailed('job-123', 'Document parsing timeout');
   * ```
   */
  async markJobFailed(jobId: string, errorMessage: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(IngestionJobEntity)
      .set({
        status: IngestionJobStatus.FAILED,
        errorMessage,
        updatedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('id = :jobId', { jobId })
      .execute();
  }

  /**
   * Updates an ingestion job stage checkpoint in PostgreSQL.
   *
   * @param {string} jobId - Primary key of ingestion job
   * @param {IngestionJobStage} stage - Target pipeline stage
   * @returns {Promise<void>}
   */
  async updateJobStage(jobId: string, stage: IngestionJobStage): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .update(IngestionJobEntity)
      .set({
        stage,
        updatedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('id = :jobId', { jobId })
      .execute();
  }

  /**
   * Retrieves recent ingestion jobs with version and document relations.
   *
   * @param {number} limit - Maximum number of jobs to return
   * @returns {Promise<IngestionJobEntity[]>} List of recent jobs
   */
  async findRecentJobs(limit: number = 30): Promise<IngestionJobEntity[]> {
    return this.repository
      .createQueryBuilder('job')
      .innerJoinAndSelect('job.version', 'version')
      .innerJoinAndSelect('version.document', 'document')
      .orderBy('job.createdAt', 'DESC')
      .take(limit)
      .getMany();
  }

  /**
   * Finds the newest job (with version and document) for content with this SHA-256, ignoring failed jobs.
   *
   * @remarks
   * Used to make re-uploading identical bytes return the existing document instead of indexing a duplicate.
   *
   * @param {string} sha256Digest - Hex SHA-256 of the uploaded bytes
   * @returns {Promise<IngestionJobEntity | null>} The reusable job, or null when none exists
   */
  async findReusableJobByDigest(sha256Digest: string): Promise<IngestionJobEntity | null> {
    return this.repository
      .createQueryBuilder('job')
      .innerJoinAndSelect('job.version', 'version')
      .innerJoinAndSelect('version.document', 'document')
      .where('version.sha256Digest = :sha256Digest', { sha256Digest })
      .andWhere('job.status != :failed', { failed: IngestionJobStatus.FAILED })
      .orderBy('job.createdAt', 'DESC')
      .getOne();
  }

  /**
   * Finds a document version with its parent document.
   *
   * @param {string} versionId - Document version identifier
   * @returns {Promise<DocumentVersionEntity | null>} Version with its document, or null if not found
   */
  async findVersionById(versionId: string): Promise<DocumentVersionEntity | null> {
    return this.dataSource
      .getRepository(DocumentVersionEntity)
      .createQueryBuilder('version')
      .innerJoinAndSelect('version.document', 'document')
      .where('version.id = :versionId', { versionId })
      .getOne();
  }
}
