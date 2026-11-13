import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ConversationEntity } from './conversation.entity';

export enum MessageRole {
  USER = 'USER',
  ASSISTANT = 'ASSISTANT',
  SYSTEM = 'SYSTEM',
}

export interface CitationMetadata {
  chunkId: string;
  versionId?: string;
  documentTitle?: string;
  chunkIndex?: number;
  headingPath?: string;
  /* First page of the cited chunk, when the source format has pages */
  pageStart?: number;
  similarity?: number;
}

@Entity('messages')
@Index(['conversationId', 'createdAt'])
export class MessageEntity {
  /* Primary identifier for message turn */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /* Foreign key reference to parent conversation */
  @Column({ name: 'conversation_id', type: 'uuid' })
  conversationId!: string;

  /* Message role (USER | ASSISTANT | SYSTEM) */
  @Column({ type: 'enum', enum: MessageRole, default: MessageRole.USER })
  role!: MessageRole;

  /* Message text content */
  @Column({ type: 'text' })
  content!: string;

  /* Retrieved chunk reference IDs associated with response */
  @Column({ name: 'evidence_chunk_ids', type: 'jsonb', nullable: true })
  evidenceChunkIds?: string[];

  /* Structured citation metadata */
  @Column({ type: 'jsonb', nullable: true })
  citations?: CitationMetadata[];

  /* Flag indicating retrieval yielded zero evidence matching threshold */
  @Column({ name: 'insufficient_evidence', type: 'boolean', default: false })
  insufficientEvidence!: boolean;

  /* Extended execution metadata (traceId, aborted status, etc.) */
  @Column({ name: 'metadata_json', type: 'jsonb', nullable: true })
  metadataJson?: Record<string, unknown>;

  /* Message timestamp */
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  /* Parent conversation relationship */
  @ManyToOne(() => ConversationEntity, (conv) => conv.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'conversation_id' })
  conversation!: ConversationEntity;
}
