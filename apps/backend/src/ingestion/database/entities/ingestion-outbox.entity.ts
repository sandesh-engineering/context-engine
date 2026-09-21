import { Entity } from 'typeorm';
import { BaseOutboxEntity } from './base-outbox.entity';

@Entity('ingestion_outbox')
export class IngestionOutboxEntity extends BaseOutboxEntity {}

