import { ApiClient } from './client';
import { DocumentsApi } from './documents';
import { ConversationsApi } from './conversations';
import { ChatApi } from './chat';
import { ApiClientConfig } from './types';

export * from './types';
export * from './client';
export * from './documents';
export * from './conversations';
export * from './chat';

export class KnowledgeEngineApi {
  public readonly client: ApiClient;
  public readonly documents: DocumentsApi;
  public readonly conversations: ConversationsApi;
  public readonly chat: ChatApi;

  constructor(config: ApiClientConfig) {
    this.client = new ApiClient(config);
    this.documents = new DocumentsApi(this.client.http);
    this.conversations = new ConversationsApi(this.client.http);
    this.chat = new ChatApi(
      this.client.http,
      () => config.baseURL,
      () => this.client.getTenantId(),
    );
  }

  setTenantId(tenantId: string): void {
    this.client.setTenantId(tenantId);
  }
}

export function createApiClient(config: ApiClientConfig): KnowledgeEngineApi {
  return new KnowledgeEngineApi(config);
}
