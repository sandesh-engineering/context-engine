import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { IngestionJobEntity } from '../entities/ingestion-job.entity';
import { IngestionJobStage, IngestionJobStatus } from '../../common/enums';

export interface ClaimJobResult {
  claimed: boolean;
  job: IngestionJobEntity | null;
}

@Injectable()
export class IngestionJobsRepository {
  private readonly repository: Repository<IngestionJobEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.repository = this.dataSource.getRepository(IngestionJobEntity);
  }

  /**
   * Atomically claims an ingestion job for processing by updating stage from AVAILABLE to PROCESSING.
   *
   * @remarks
   * - Employs atomic SQL `UPDATE ... WHERE id = :jobId AND stage = 'AVAILABLE'` to guarantee exactly-once execution across distributed workers.
   * - Uses database-native `CURRENT_TIMESTAMP` for `updated_at` to prevent application-to-database clock drift.
   *
   * @param {string} jobId - Primary key identifier of target ingestion job
   * @returns {Promise<ClaimJobResult>} Object containing `claimed` boolean status and fetched job entity
   *
   * @example
   * ```ts
   * const { claimed, job } = await repo.claimJobForProcessing('job-123');
   * if (!claimed) {
   *   // Duplicate or already claimed by another worker instance
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
        stage: IngestionJobStage.AVAILABLE,
      })
      .execute();

    const job = await this.repository.findOne({ where: { id: jobId } });

    if (result.affected && result.affected > 0) {
      return { claimed: true, job };
    }

    return { claimed: false, job };
  }

  /**
   * Retrieves an ingestion job entity by its primary UUID key.
   *
   * @param {string} jobId - Primary key of ingestion job
   * @returns {Promise<IngestionJobEntity | null>} Ingestion job entity or null if not found
   */
  async findJobById(jobId: string): Promise<IngestionJobEntity | null> {
    return this.repository.findOne({ where: { id: jobId } });
  }

  /**
   * Updates an ingestion job status to COMPLETED and sets final pipeline stage.
   *
   * @param {string} jobId - Primary key of ingestion job
   * @returns {Promise<void>}
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
   * @param {string} jobId - Primary key of ingestion job
   * @param {string} errorMessage - Detailed failure description
   * @returns {Promise<void>}
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
}
