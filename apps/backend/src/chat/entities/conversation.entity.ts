import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  OneToMany,
} from 'typeorm';
import { MessageEntity } from './message.entity';

@Entity('conversations')
export class ConversationEntity {
  /* Primary identifier for conversation session */
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  /* User/Tenant owner identifier */
  @Column({ name: 'user_id', type: 'varchar', nullable: true })
  userId?: string;

  /* Human-readable title of chat session */
  @Column({ type: 'varchar', default: 'New Conversation' })
  title!: string;

  /* External LLM provider history/session ID (e.g. qwen/ollama context ID) */
  @Column({ name: 'provider_session_id', type: 'varchar', nullable: true })
  providerSessionId?: string;

  /* Raw model token context state for continuing chat turns */
  @Column({ name: 'context_state', type: 'jsonb', nullable: true })
  contextState?: number[];

  /* Session creation timestamp */
  @CreateDateColumn({ name: 'created_at', type: 'timestamp' })
  createdAt!: Date;

  /* Session last update timestamp */
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamp' })
  updatedAt!: Date;

  /* One-to-many relationship with conversation message turns */
  @OneToMany(() => MessageEntity, (message) => message.conversation, {
    cascade: true,
  })
  messages!: MessageEntity[];
}
