import { Injectable } from '@nestjs/common';
import { DataSource, Repository } from 'typeorm';
import { IngestionOutboxEntity } from '../entities/ingestion-outbox.entity';

@Injectable()
export class OutboxRepository {
  private readonly repository: Repository<IngestionOutboxEntity>;

  constructor(private readonly dataSource: DataSource) {
    this.repository = this.dataSource.getRepository(IngestionOutboxEntity);
  }

  /**
   * Queries pending outbox events from PostgreSQL ordered by creation timestamp up to batch limit.
   *
   * @remarks
   * - Filters for records where `processed = false`.
   * - Orders by `created_at ASC` to ensure FIFO processing sequence.
   * - Restricts output using configurable `batchSize`.
   *
   * @param {number} [batchSize=10] - Maximum number of outbox events to retrieve
   * @returns {Promise<IngestionOutboxEntity[]>} Array of pending outbox event entities
   * @throws {Error} Throws if database query execution fails
   *
   * @example
   * ```ts
   * const pending = await outboxRepository.fetchPendingOutboxEvents(10);
   * ```
   */
  async fetchPendingOutboxEvents(batchSize = 10): Promise<IngestionOutboxEntity[]> {
    return this.repository.find({
      where: { processed: false },
      order: { created_at: 'ASC' },
      take: batchSize,
    });
  }

  /**
   * Updates specified outbox event records as successfully processed.
   *
   * @remarks
   * - Sets `processed = true`.
   * - Employs database-native `CURRENT_TIMESTAMP` for `processed_at` to prevent application-to-database clock drift.
   *
   * @param {string[]} eventIds - List of event_id strings to mark as processed
   * @returns {Promise<void>}
   *
   * @example
   * ```ts
   * await outboxRepository.markEventsProcessed(['evt_1', 'evt_2']);
   * ```
   */
  async markEventsProcessed(eventIds: string[]): Promise<void> {
    if (!eventIds || eventIds.length === 0) return;
    await this.repository
      .createQueryBuilder()
      .update(IngestionOutboxEntity)
      .set({
        processed: true,
        processed_at: () => 'CURRENT_TIMESTAMP',
      })
      .where('event_id IN (:...eventIds)', { eventIds })
      .execute();
  }

  /**
   * Increments the retry attempt counter for specified outbox events on relay publishing failure.
   *
   * @param {string[]} eventIds - List of event_id strings to increment retry counter
   * @returns {Promise<void>}
   */
  async incrementRetries(eventIds: string[]): Promise<void> {
    if (!eventIds || eventIds.length === 0) return;
    await this.repository
      .createQueryBuilder()
      .update(IngestionOutboxEntity)
      .set({
        retries: () => 'retries + 1',
      })
      .where('event_id IN (:...eventIds)', { eventIds })
      .execute();
  }

  /**
   * Updates specified outbox event records as failed and rerouted to Dead-Letter Queue (DLQ).
   *
   * @remarks
   * - Sets `processed = true` to remove the event from active poller queries.
   * - Employs database-native `CURRENT_TIMESTAMP` for `failed_at` to prevent clock drift inconsistencies.
   *
   * @param {string[]} eventIds - List of event_id strings to mark as failed
   * @returns {Promise<void>}
   *
   * @example
   * ```ts
   * await outboxRepository.markEventsFailedDlq(['evt_1']);
   * ```
   */
  async markEventsFailedDlq(eventIds: string[]): Promise<void> {
    if (!eventIds || eventIds.length === 0) return;
    await this.repository
      .createQueryBuilder()
      .update(IngestionOutboxEntity)
      .set({
        processed: true,
        failed_at: () => 'CURRENT_TIMESTAMP',
      })
      .where('event_id IN (:...eventIds)', { eventIds })
      .execute();
  }
}

