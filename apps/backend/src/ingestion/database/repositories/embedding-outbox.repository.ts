import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { EmbeddingOutboxEntity } from '../entities/embedding-outbox.entity';

@Injectable()
export class EmbeddingOutboxRepository {
  private readonly repository: Repository<EmbeddingOutboxEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.repository = this.dataSource.getRepository(EmbeddingOutboxEntity);
  }

  /**
   * Queries pending embedding outbox events from PostgreSQL ordered by creation timestamp up to batch limit.
   *
   * @param {number} [batchSize=10] - Maximum number of outbox events to retrieve
   * @returns {Promise<EmbeddingOutboxEntity[]>} Array of pending outbox event entities
   */
  async fetchPendingOutboxEvents(batchSize = 10): Promise<EmbeddingOutboxEntity[]> {
    return this.repository.find({
      where: { processed: false },
      order: { created_at: 'ASC' },
      take: batchSize,
    });
  }

  /**
   * Updates specified embedding outbox event records as successfully processed.
   *
   * @param {string[]} eventIds - List of event_id strings to mark as processed
   * @returns {Promise<void>}
   */
  async markEventsProcessed(eventIds: string[]): Promise<void> {
    if (!eventIds || eventIds.length === 0) return;
    await this.repository
      .createQueryBuilder()
      .update(EmbeddingOutboxEntity)
      .set({
        processed: true,
        processed_at: () => 'CURRENT_TIMESTAMP',
      })
      .where('event_id IN (:...eventIds)', { eventIds })
      .execute();
  }

  /**
   * Increments the retry attempt counter for specified embedding outbox events on publishing failure.
   *
   * @param {string[]} eventIds - List of event_id strings to increment retry counter
   * @returns {Promise<void>}
   */
  async incrementRetries(eventIds: string[]): Promise<void> {
    if (!eventIds || eventIds.length === 0) return;
    await this.repository
      .createQueryBuilder()
      .update(EmbeddingOutboxEntity)
      .set({
        retries: () => 'retries + 1',
      })
      .where('event_id IN (:...eventIds)', { eventIds })
      .execute();
  }

  /**
   * Updates specified embedding outbox event records as failed and rerouted to DLQ.
   *
   * @param {string[]} eventIds - List of event_id strings to mark as failed
   * @returns {Promise<void>}
   */
  async markEventsFailedDlq(eventIds: string[]): Promise<void> {
    if (!eventIds || eventIds.length === 0) return;
    await this.repository
      .createQueryBuilder()
      .update(EmbeddingOutboxEntity)
      .set({
        processed: true,
        failed_at: () => 'CURRENT_TIMESTAMP',
      })
      .where('event_id IN (:...eventIds)', { eventIds })
      .execute();
  }
}
