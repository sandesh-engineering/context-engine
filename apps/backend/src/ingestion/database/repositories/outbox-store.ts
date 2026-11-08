import { DataSource, EntityTarget, Repository } from 'typeorm';
import { BaseOutboxEntity } from '../entities/base-outbox.entity';

/**
 * Read/update operations a poller needs on an outbox table.
 */
export interface OutboxStore<E extends BaseOutboxEntity> {
  /** Oldest unprocessed events first, up to `batchSize`. */
  fetchPendingOutboxEvents(batchSize?: number): Promise<E[]>;
  markEventsProcessed(eventIds: string[]): Promise<void>;
  incrementRetries(eventIds: string[]): Promise<void>;
  /** Marks events as processed with `failed_at` set (they were rerouted to the DLQ). */
  markEventsFailedDlq(eventIds: string[]): Promise<void>;
}

/**
 * TypeORM implementation of {@link OutboxStore} for one outbox table.
 *
 * @remarks
 * Reads are not locked: only the worker process runs the outbox pollers, and consumers claim jobs
 * with an atomic conditional UPDATE, so a rare duplicate publish is harmless.
 */
export class TypeOrmOutboxStore<E extends BaseOutboxEntity> implements OutboxStore<E> {
  constructor(private readonly repository: Repository<E>) {}

  async fetchPendingOutboxEvents(batchSize = 10): Promise<E[]> {
    return this.repository
      .createQueryBuilder('outbox')
      .where('outbox.processed = :processed', { processed: false })
      .orderBy('outbox.created_at', 'ASC')
      .limit(batchSize)
      .getMany();
  }

  async markEventsProcessed(eventIds: string[]): Promise<void> {
    await this.updateEvents(eventIds, {
      processed: true,
      processed_at: () => 'CURRENT_TIMESTAMP',
    });
  }

  async incrementRetries(eventIds: string[]): Promise<void> {
    await this.updateEvents(eventIds, { retries: () => 'retries + 1' });
  }

  async markEventsFailedDlq(eventIds: string[]): Promise<void> {
    await this.updateEvents(eventIds, {
      processed: true,
      failed_at: () => 'CURRENT_TIMESTAMP',
    });
  }

  private async updateEvents(eventIds: string[], values: Record<string, unknown>): Promise<void> {
    if (!eventIds || eventIds.length === 0) return;
    await this.repository
      .createQueryBuilder()
      .update(this.repository.target)
      /* Generic E cannot satisfy TypeORM's deep-partial type; the keys are BaseOutboxEntity columns */
      .set(values as any)
      .where('event_id IN (:...eventIds)', { eventIds })
      .execute();
  }
}

/**
 * Base class for the ingestion and embedding outbox repositories.
 */
export abstract class OutboxRepositoryBase<E extends BaseOutboxEntity> extends TypeOrmOutboxStore<E> {
  protected constructor(dataSource: DataSource, entity: EntityTarget<E>) {
    super(dataSource.getRepository(entity));
  }
}
