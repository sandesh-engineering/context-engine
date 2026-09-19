import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IngestionController } from './ingestion.controller';
import { IngestionService } from './ingestion.service';
import { IngestionPersistenceService } from './services/ingestion-persistence.service';
import { StoragePathBuilder } from './services/storage-path-builder.service';
import {
  DocumentEntity,
  DocumentVersionEntity,
  IngestionJobEntity,
  IngestionOutboxEntity,
  EmbeddingOutboxEntity,
} from './database/entities';
import { OBJECT_STORAGE_SERVICE } from './storage/interfaces/object-storage.interface';
import { S3StorageAdapter } from './storage/adapters/s3-storage.adapter';

import { OutboxRepository, EmbeddingOutboxRepository, IngestionJobsRepository } from './database/repositories';
import { MESSAGE_PUBLISHER } from './messaging/interfaces/message-publisher.interface';
import { SqsMessagePublisher } from './messaging/publishers/sqs-message.publisher';
import { IngestionOutboxPollerService } from './messaging/services/ingestion-outbox-poller.service';
import { EmbeddingOutboxPollerService } from './messaging/services/embedding-outbox-poller.service';
import { DOCUMENT_CHUNKER } from './chunking/interfaces/document-chunker.interface';
import { StructureAwareChunker } from './chunking/structure-aware-chunker';
import { AppConfigService } from '../config/app-config.service';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      DocumentEntity,
      DocumentVersionEntity,
      IngestionJobEntity,
      IngestionOutboxEntity,
      EmbeddingOutboxEntity,
    ]),
  ],
  controllers: [IngestionController],
  providers: [
    AppConfigService,
    IngestionService,
    IngestionPersistenceService,
    OutboxRepository,
    EmbeddingOutboxRepository,
    IngestionJobsRepository,
    StoragePathBuilder,
    SqsMessagePublisher,
    IngestionOutboxPollerService,
    EmbeddingOutboxPollerService,
    StructureAwareChunker,
    {
      provide: DOCUMENT_CHUNKER,
      useClass: StructureAwareChunker,
    },
    {
      provide: OBJECT_STORAGE_SERVICE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const bucketName = configService.get<string>('AWS_S3_BUCKET') || 'knowledge-engine-docs';
        return new S3StorageAdapter({ bucketName });
      },
    },
    {
      provide: MESSAGE_PUBLISHER,
      useClass: SqsMessagePublisher,
    },
  ],
  exports: [
    IngestionService,
    IngestionPersistenceService,
    OutboxRepository,
    EmbeddingOutboxRepository,
    IngestionJobsRepository,
    StoragePathBuilder,
    OBJECT_STORAGE_SERVICE,
    MESSAGE_PUBLISHER,
    SqsMessagePublisher,
    IngestionOutboxPollerService,
    EmbeddingOutboxPollerService,
  ],
})
export class IngestionModule { }
