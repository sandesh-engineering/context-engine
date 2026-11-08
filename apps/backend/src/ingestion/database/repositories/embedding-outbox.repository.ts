import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { EmbeddingOutboxEntity } from '../entities/embedding-outbox.entity';
import { OutboxRepositoryBase } from './outbox-store';

/**
 * Access to the `embedding_outbox` table (chunked versions waiting to be sent to the embedding queue).
 */
@Injectable()
export class EmbeddingOutboxRepository extends OutboxRepositoryBase<EmbeddingOutboxEntity> {
  constructor(dataSource: DataSource) {
    super(dataSource, EmbeddingOutboxEntity);
  }
}
