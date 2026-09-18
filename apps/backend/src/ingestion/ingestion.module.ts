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
  OutboxEventEntity,
} from './database/entities';
import { OBJECT_STORAGE_SERVICE } from './storage/interfaces/object-storage.interface';
import { S3StorageAdapter } from './storage/adapters/s3-storage.adapter';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([
      DocumentEntity,
      DocumentVersionEntity,
      IngestionJobEntity,
      OutboxEventEntity,
    ]),
  ],
  controllers: [IngestionController],
  providers: [
    IngestionService,
    IngestionPersistenceService,
    StoragePathBuilder,
    {
      provide: OBJECT_STORAGE_SERVICE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const bucketName = configService.get<string>('AWS_S3_BUCKET') || 'knowledge-engine-docs';
        return new S3StorageAdapter({ bucketName });
      },
    },
  ],
  exports: [
    IngestionService,
    IngestionPersistenceService,
    StoragePathBuilder,
    OBJECT_STORAGE_SERVICE,
  ],
})
export class IngestionModule {}
