import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { RetrievalQueryValidator } from './services/retrieval-query-validator.service';
import { RetrievalService } from './services/retrieval.service';
import { VectorSearchRepository } from './repositories/vector-search.repository';
import { DocumentChunkEntity } from '../ingestion/database/entities/document-chunk.entity';
import { EMBEDDING_PROVIDER } from '../ingestion/embeddings/interfaces/embedding-provider.interface';
import { OllamaEmbeddingProvider } from '../ingestion/embeddings/providers/ollama-embedding.provider';
import { GeminiEmbeddingProvider } from '../ingestion/embeddings/providers/gemini-embedding.provider';
import { AppConfigService } from '../config/app-config.service';
import { RERANKER_PROVIDER } from './interfaces/reranker-provider.interface';
import { HttpQwenRerankerProvider } from './providers/http-qwen-reranker.provider';
import { HttpTeiRerankerProvider } from './providers/http-tei-reranker.provider';

@Module({
  imports: [
    ConfigModule,
    TypeOrmModule.forFeature([DocumentChunkEntity]),
  ],
  providers: [
    AppConfigService,
    RetrievalQueryValidator,
    VectorSearchRepository,
    RetrievalService,
    OllamaEmbeddingProvider,
    GeminiEmbeddingProvider,
    {
      provide: EMBEDDING_PROVIDER,
      useClass: OllamaEmbeddingProvider,
    },
    HttpQwenRerankerProvider,
    HttpTeiRerankerProvider,
    {
      provide: RERANKER_PROVIDER,
      useFactory: (appConfig: AppConfigService) => {
        if (appConfig.rerankerProviderType === 'ollama') {
          return new HttpQwenRerankerProvider(appConfig);
        }
        return new HttpTeiRerankerProvider(appConfig);
      },
      inject: [AppConfigService],
    },
  ],
  exports: [
    RetrievalService,
    RetrievalQueryValidator,
    VectorSearchRepository,
    RERANKER_PROVIDER,
  ],
})
export class RetrievalModule {}
