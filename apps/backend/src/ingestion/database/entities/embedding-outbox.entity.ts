import { Entity } from 'typeorm';
import { BaseOutboxEntity } from './base-outbox.entity';

@Entity('embedding_outbox')
export class EmbeddingOutboxEntity extends BaseOutboxEntity {}
