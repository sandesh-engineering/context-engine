import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  OneToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { DocumentEntity } from './document.entity';
import { IngestionJobEntity } from './ingestion-job.entity';

/* One row per upload of a document; version_number is unique within the document */
@Entity('document_versions')
@Index('UQ_document_versions_document_version', ['documentId', 'versionNumber'], { unique: true })
export class DocumentVersionEntity {
  /* Database-generated primary identifier for physical document version */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /* Foreign key reference to parent logical document */
  @Column({ name: 'document_id', type: 'uuid' })
  documentId!: string;

  /* Monotonically increasing revision number for document iterations */
  @Column({ name: 'version_number', type: 'int', default: 1 })
  versionNumber!: number;

  /* S3/object storage key path where raw immutable binary file is persisted */
  @Column({ name: 'storage_key', type: 'varchar' })
  storageKey!: string;

  /* Cryptographic SHA-256 hash verifying binary payload integrity */
  @Column({ name: 'sha256_digest', type: 'varchar' })
  sha256Digest!: string;

  /* Precise file size in bytes for quota tracking and transfer verification */
  @Column({ name: 'byte_size', type: 'bigint' })
  byteSize!: number;

  /* Verified MIME type of document (e.g. application/pdf) */
  @Column({ name: 'mime_type', type: 'varchar', default: 'application/pdf' })
  mimeType!: string;

  /* Original uploaded file name preserved for display and download headers */
  @Column({ name: 'original_filename', type: 'varchar' })
  originalFilename!: string;

  /* Timestamp when this specific immutable version was created */
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  /* Parent logical document relationship */
  @ManyToOne(() => DocumentEntity, (document) => document.versions, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'document_id' })
  document!: DocumentEntity;

  /* Associated ingestion pipeline job tracking processing progress */
  @OneToOne(() => IngestionJobEntity, (job) => job.version)
  job!: IngestionJobEntity;
}
