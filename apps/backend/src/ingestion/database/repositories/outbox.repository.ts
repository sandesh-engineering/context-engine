import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { IngestionOutboxEntity } from '../entities/ingestion-outbox.entity';
import { OutboxRepositoryBase } from './outbox-store';

/**
 * Access to the `ingestion_outbox` table (document uploads waiting to be sent to the ingestion queue).
 */
@Injectable()
export class OutboxRepository extends OutboxRepositoryBase<IngestionOutboxEntity> {
  constructor(dataSource: DataSource) {
    super(dataSource, IngestionOutboxEntity);
  }
}
