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
  ],
  exports: [
    RetrievalService,
    RetrievalQueryValidator,
    VectorSearchRepository,
  ],
})
export class RetrievalModule {}
