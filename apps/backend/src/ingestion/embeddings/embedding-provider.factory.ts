import type { Provider } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { EMBEDDING_PROVIDER, type IEmbeddingProvider } from './interfaces/embedding-provider.interface';
import { GeminiEmbeddingProvider } from './providers/gemini-embedding.provider';
import { OllamaEmbeddingProvider } from './providers/ollama-embedding.provider';

/**
 * Binds EMBEDDING_PROVIDER to the adapter named by EMBEDDING_PROVIDER (`ollama` | `gemini`).
 *
 * @remarks
 * Ingestion (worker) and retrieval (API) must embed with the same model, so both modules use this
 * one definition. Switching provider or model requires re-embedding every stored chunk.
 */
export const embeddingProviderDefinition: Provider = {
  provide: EMBEDDING_PROVIDER,
  inject: [AppConfigService],
  useFactory: (appConfig: AppConfigService): IEmbeddingProvider =>
    appConfig.embeddingProviderType === 'gemini'
      ? new GeminiEmbeddingProvider(appConfig)
      : new OllamaEmbeddingProvider(appConfig),
};
