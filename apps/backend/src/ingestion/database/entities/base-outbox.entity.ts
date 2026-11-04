import {
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { Domain } from '../../common/enums';

export abstract class BaseOutboxEntity {
  /* Database-generated primary identifier for outbox event record */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /* Idempotency event identifier ensuring deduplicated consumer processing */
  @Column({ type: 'varchar' })
  event_id!: string;

  /* Destination message broker topic or event routing key */
  @Column({ type: 'varchar' })
  topic!: string;

  /* Schema version of the event payload for backwards-compatible evolution */
  @Column({ type: 'int', default: 0 })
  version!: number;

  /* Domain category defining message origin and processing scope */
  @Column({ type: 'enum', enum: Domain, default: Domain.DOCUMENT })
  domain!: Domain;

  /* Complete immutable payload passed to downstream consumers */
  @Column({ type: 'jsonb' })
  payload!: Record<string, unknown>;

  /* Retry attempt count by outbox relay publisher */
  @Column({ type: 'int', default: 0 })
  retries!: number;

  /* Flag indicating whether the event has been durably published to SQS/EventBridge */
  @Index()
  @Column({ type: 'boolean', default: false })
  processed!: boolean;

  /* Timestamp when the relay successfully published the event */
  @Column({ type: 'timestamp', nullable: true })
  processed_at!: Date | null;

  /* Timestamp of terminal failure before escalation to Dead-Letter Queue (DLQ) */
  @Column({ type: 'timestamp', nullable: true })
  failed_at!: Date | null;

  /* Distributed tracing context (traceparent) and operational metadata */
  @Column({ type: 'jsonb', nullable: true })
  metadata!: Record<string, unknown> | null;

  /* Timestamp when outbox record was atomically written inside database transaction */
  @CreateDateColumn({ type: 'timestamp' })
  created_at!: Date;
}
