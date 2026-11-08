import type { Provider } from '@nestjs/common';
import { AppConfigService } from '../../config/app-config.service';
import { LLM_PROVIDER, type ILlmProvider } from '../interfaces/llm-provider.interface';
import { GeminiLlmProvider } from './gemini-llm.provider';
import { OllamaLlmProvider } from './ollama-llm.provider';

/**
 * Binds LLM_PROVIDER to the adapter named by LLM_PROVIDER (`ollama` | `gemini`).
 */
export const llmProviderDefinition: Provider = {
  provide: LLM_PROVIDER,
  inject: [AppConfigService],
  useFactory: (appConfig: AppConfigService): ILlmProvider =>
    appConfig.llmProviderType === 'gemini'
      ? new GeminiLlmProvider(appConfig)
      : new OllamaLlmProvider(appConfig),
};
