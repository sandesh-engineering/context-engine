import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { DocumentVersionEntity } from './document-version.entity';

@Entity('document_chunks')
@Index(['versionId', 'chunkIndex'], { unique: true })
/* Expression indexes managed by hand-written migrations; synchronize: false keeps migration:generate from dropping them */
@Index('IDX_document_chunks_content_tsv', { synchronize: false })
@Index('idx_document_chunks_embedding_hnsw', { synchronize: false })
export class DocumentChunkEntity {
  /* Database-generated primary identifier for chunk */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /* Foreign key reference to parent document version */
  @Column({ name: 'version_id', type: 'uuid' })
  versionId!: string;

  /* Zero-based sequential chunk index within document version */
  @Column({ name: 'chunk_index', type: 'int' })
  chunkIndex!: number;

  /* Raw chunk text content */
  @Column({ type: 'text' })
  content!: string;

  /* Structural heading context path (e.g. Title > Section A) */
  @Column({ name: 'heading_path', type: 'varchar', nullable: true })
  headingPath?: string;

  /* Starting source page number (1-indexed) */
  @Column({ name: 'page_start', type: 'int', nullable: true })
  pageStart?: number;

  /* Ending source page number (1-indexed) */
  @Column({ name: 'page_end', type: 'int', nullable: true })
  pageEnd?: number;

  /* Token count for chunk length bounding */
  @Column({ name: 'token_count', type: 'int', default: 0 })
  tokenCount!: number;

  /* Starting character offset in raw text */
  @Column({ name: 'start_char_offset', type: 'int', default: 0 })
  startCharOffset!: number;

  /* Ending character offset in raw text */
  @Column({ name: 'end_char_offset', type: 'int', default: 0 })
  endCharOffset!: number;

  /* 768-dimensional dense vector embedding float array */
  @Column({ type: 'vector', nullable: true, length: 768 })
  embedding?: number[];

  /* Flexible metadata JSON */
  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson?: Record<string, unknown>;

  /* Timestamp when chunk record was created */
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  /* Parent document version relationship */
  @ManyToOne(() => DocumentVersionEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'version_id' })
  version!: DocumentVersionEntity;
}
