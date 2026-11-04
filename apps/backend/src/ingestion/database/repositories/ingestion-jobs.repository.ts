import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { IngestionJobEntity } from '../entities/ingestion-job.entity';
import { DocumentVersionEntity } from '../entities/document-version.entity';
import { IngestionJobStage, IngestionJobStatus } from '../../common/enums';

/**
 * Result structure returned by atomic job claim operation.
 */
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
   * Atomically claims an ingestion job for processing by updating stage from AVAILABLE to PARSING.
   *
   * @remarks
   * - Restricts stage transition exclusively to records where `stage = 'AVAILABLE'` to enforce pipeline stage requirements.
   * - Employs atomic SQL `UPDATE ... WHERE id = :jobId AND stage = 'AVAILABLE'` to guarantee exactly-once execution across distributed workers.
   * - Uses database-native `CURRENT_TIMESTAMP` for `updated_at` to prevent application-to-database clock drift.
   *
   * @param {string} jobId - Primary key identifier of target ingestion job
   * @returns {Promise<ClaimJobResult>} Object containing `claimed` boolean status and fetched job entity
   * @throws {Error} Throws if database update query fails
   *
   * @example
   * ```ts
   * const { claimed, job } = await repo.claimJobForProcessing('job-123');
   * if (!claimed) {
   *   // Duplicate, not in AVAILABLE stage, or already claimed by another worker instance
   * }
   * ```
   */
  async claimJobForProcessing(jobId: string): Promise<ClaimJobResult> {
    const result = await this.repository
      .createQueryBuilder()
      .update(IngestionJobEntity)
      .set({
        stage: IngestionJobStage.PARSING,
        status: IngestionJobStatus.PROCESSING,
        updatedAt: () => 'CURRENT_TIMESTAMP',
      })
      .where('id = :jobId AND stage = :stage', {
        jobId,
        stage: IngestionJobStage.SOURCE_READY,
      })
      .execute();

    const job = await this.repository.findOne({
      where: { id: jobId },
      relations: ['version'],
    });

    if (result.affected && result.affected > 0) {
      return { claimed: true, job };
    }

    return { claimed: false, job };
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
