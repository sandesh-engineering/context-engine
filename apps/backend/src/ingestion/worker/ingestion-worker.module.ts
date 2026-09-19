import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AppConfigService } from '../../config/app-config.service';
import { IngestionJobEntity, DocumentChunkEntity } from '../database/entities';
import { IngestionJobsRepository, DocumentChunksRepository } from '../database/repositories';
import { SqsIngestionPollerService } from './sqs-ingestion-poller.service';
import { SqsEmbeddingPollerService } from './sqs-embedding-poller.service';
import { TempStorageManager } from '../services/temp-storage-manager.service';
import { PdfParserAdapter } from '../parsing/adapters/pdf-parser.adapter';
import { DOCUMENT_CHUNKER } from '../chunking/interfaces/document-chunker.interface';
import { StructureAwareChunker } from '../chunking/structure-aware-chunker';
import {
  EMBEDDING_PROVIDER,
  type IEmbeddingProvider,
} from '../embeddings/interfaces/embedding-provider.interface';
import { OllamaEmbeddingProvider } from '../embeddings/providers/ollama-embedding.provider';
import { IngestionPipelineExecutor } from '../pipeline/ingestion-pipeline.executor';
import { OBJECT_STORAGE_SERVICE } from '../storage/interfaces/object-storage.interface';
import { S3StorageAdapter } from '../storage/adapters/s3-storage.adapter';

/**
 * NestJS worker feature module registering SQS poller services, pipeline executors, and job repositories.
 *
 * @remarks
 * Can be imported into main `AppModule` for in-process execution (`WORKER_ENABLED=true`)
 * or bootstrapped independently via `src/main-worker.ts` for dedicated ECS container scaling.
 */
@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([IngestionJobEntity, DocumentChunkEntity]),
  ],
  providers: [
    AppConfigService,
    IngestionJobsRepository,
    DocumentChunksRepository,
    TempStorageManager,
    PdfParserAdapter,
    StructureAwareChunker,
    {
      provide: DOCUMENT_CHUNKER,
      useClass: StructureAwareChunker,
    },
    IngestionPipelineExecutor,
    {
      provide: OBJECT_STORAGE_SERVICE,
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const bucketName = configService.get<string>('AWS_S3_BUCKET') || 'knowledge-engine-docs';
        return new S3StorageAdapter({ bucketName });
      },
    },
    {
      provide: EMBEDDING_PROVIDER,
      useClass: OllamaEmbeddingProvider,
    },
    {
      provide: SqsIngestionPollerService,
      inject: [
        AppConfigService,
        ConfigService,
        IngestionJobsRepository,
        IngestionPipelineExecutor,
      ],
      useFactory: (
        appConfig: AppConfigService,
        configService: ConfigService,
        jobsRepository: IngestionJobsRepository,
        pipelineExecutor: IngestionPipelineExecutor,
      ) => {
        return new SqsIngestionPollerService(appConfig, configService, jobsRepository, {
          pipelineExecutor,
        });
      },
    },
    {
      provide: SqsEmbeddingPollerService,
      inject: [
        AppConfigService,
        ConfigService,
        IngestionJobsRepository,
        DocumentChunksRepository,
        EMBEDDING_PROVIDER,
      ],
      useFactory: (
        appConfig: AppConfigService,
        configService: ConfigService,
        jobsRepository: IngestionJobsRepository,
        chunksRepository: DocumentChunksRepository,
        embeddingProvider: IEmbeddingProvider,
      ) => {
        return new SqsEmbeddingPollerService(
          appConfig,
          configService,
          jobsRepository,
          chunksRepository,
          embeddingProvider,
        );
      },
    },
  ],
  exports: [
    IngestionJobsRepository,
    DocumentChunksRepository,
    SqsIngestionPollerService,
    SqsEmbeddingPollerService,
    IngestionPipelineExecutor,
  ],
})
export class IngestionWorkerModule { }
