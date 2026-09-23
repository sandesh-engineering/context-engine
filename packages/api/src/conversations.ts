import { AxiosInstance } from 'axios';
import { Conversation, PaginatedMessagesResponse, ChatMessage } from './types';

export class ConversationsApi {
  constructor(private readonly http: AxiosInstance) {}

  /**
   * Get list of conversations for tenant.
   */
  async getConversations(options?: { signal?: AbortSignal }): Promise<Conversation[]> {
    try {
      const response = await this.http.get<Conversation[]>('/conversations', {
        signal: options?.signal,
      });
      return response.data;
    } catch {
      return [];
    }
  }

  /**
   * Create a new conversation thread.
   */
  async createConversation(
    title?: string,
    options?: { signal?: AbortSignal },
  ): Promise<Conversation> {
    const response = await this.http.post<Conversation>(
      '/conversations',
      { title: title || 'New Conversation' },
      { signal: options?.signal },
    );
    return response.data;
  }

  /**
   * Get paginated messages for a conversation on demand (beforeCursor for upward scroll).
   */
  async getMessages(
    conversationId: string,
    params?: { beforeCursor?: string; limit?: number },
    options?: { signal?: AbortSignal },
  ): Promise<PaginatedMessagesResponse> {
    const response = await this.http.get<PaginatedMessagesResponse>(
      `/conversations/${conversationId}/messages`,
      {
        params: {
          beforeCursor: params?.beforeCursor,
          limit: params?.limit || 20,
        },
        signal: options?.signal,
      },
    );
    return response.data;
  }
}
