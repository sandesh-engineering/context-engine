import { AxiosInstance } from 'axios';
import { Conversation, PaginatedMessagesResponse, ChatMessage } from './types';

export class ConversationsApi {
  constructor(private readonly http: AxiosInstance) {}

  /**
   * Get list of conversations for tenant.
   */
  async getConversations(options?: {
    page?: number;
    limit?: number;
    userId?: string;
    signal?: AbortSignal;
  }): Promise<Conversation[]> {
    try {
      const response = await this.http.get<any>('/conversations', {
        params: {
          page: options?.page,
          limit: options?.limit,
          userId: options?.userId,
        },
        signal: options?.signal,
      });
      const data = response.data;
      if (Array.isArray(data)) {
        return data;
      }
      if (data && Array.isArray(data.items)) {
        return data.items;
      }
      return [];
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
