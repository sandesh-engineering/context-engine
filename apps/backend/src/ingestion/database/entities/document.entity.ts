import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { DocumentVersionEntity } from './document-version.entity';
import { DocumentSourceType } from '../../common/enums';

@Entity('documents')
export class DocumentEntity {
  /* Database-generated primary identifier for logical document */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /* Multi-tenant partition boundary identifier ensuring complete tenant data isolation */
  @Column({ name: 'tenant_id', type: 'varchar' })
  tenantId!: string;

  /* User-facing human-readable title of the document */
  @Column({ type: 'varchar' })
  title!: string;

  /* Ingestion intake channel origin (direct upload, external url, or s3 copy) */
  @Column({
    name: 'source_type',
    type: 'enum',
    enum: DocumentSourceType,
    default: DocumentSourceType.DIRECT_UPLOAD,
  })
  sourceType!: DocumentSourceType;

  /* Timestamp when the logical document record was initially created */
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  /* Timestamp when any top-level metadata of the document was last updated */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  /* Relation to all immutable physical versions belonging to this document */
  @OneToMany(() => DocumentVersionEntity, (version) => version.document)
  versions!: DocumentVersionEntity[];
}
