import { DataSource, DataSourceOptions } from 'typeorm';
import { loadEnvFiles } from '../config/env-loader';
import {
  DocumentEntity,
  DocumentVersionEntity,
  IngestionJobEntity,
  IngestionOutboxEntity,
  EmbeddingOutboxEntity,
  DocumentChunkEntity,
} from '../ingestion/database/entities';
import {
  ConversationEntity,
  MessageEntity,
} from '../chat/entities';

loadEnvFiles();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT) || 5432,
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  database: process.env.DB_NAME || 'knowledge_engine',
  synchronize: false,
  logging: process.env.NODE_ENV === 'development',
  entities: [
    DocumentEntity,
    DocumentVersionEntity,
    IngestionJobEntity,
    IngestionOutboxEntity,
    EmbeddingOutboxEntity,
    DocumentChunkEntity,
    ConversationEntity,
    MessageEntity,
  ],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  subscribers: [],
};

export const AppDataSource = new DataSource(dataSourceOptions);
