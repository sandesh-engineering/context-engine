import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { DocumentVersionEntity } from './document-version.entity';
import { IngestionJobStatus, IngestionJobStage } from '../../common/enums';

@Entity('ingestion_jobs')
export class IngestionJobEntity {
  /* Database-generated primary identifier for ingestion job */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /* Foreign key reference to the document version being processed */
  @Column({ name: 'version_id', type: 'uuid' })
  versionId!: string;

  /* High-level processing status of the job */
  @Column({
    type: 'enum',
    enum: IngestionJobStatus,
    default: IngestionJobStatus.PENDING,
  })
  status!: IngestionJobStatus;

  /* Current pipeline checkpoint stage enabling workers to resume failed jobs without repeating work */
  @Column({
    type: 'enum',
    enum: IngestionJobStage,
    default: IngestionJobStage.AVAILABLE,
  })
  stage!: IngestionJobStage;

  /* Number of execution attempts for bounded retry tracking and dead-letter queue escalation */
  @Column({ name: 'attempt_count', type: 'int', default: 0 })
  attemptCount!: number;

  /* Diagnostic error message and failure category if job terminates in failed state */
  @Column({ name: 'error_message', type: 'text', nullable: true })
  errorMessage?: string;

  /* Timestamp when ingestion job was initiated */
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  /* Timestamp of last stage transition or heartbeat update */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  /* Document version entity relationship */
  @OneToOne(() => DocumentVersionEntity, (version) => version.job, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'version_id' })
  version!: DocumentVersionEntity;
}
