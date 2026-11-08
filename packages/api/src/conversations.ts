import { AxiosInstance } from 'axios';
import { Conversation, PaginatedMessagesResponse, ChatMessage } from './types';

export class ConversationsApi {
  constructor(private readonly http: AxiosInstance) {}

  /**
   * Get list of conversations.
   */
  async getConversations(options?: {
    page?: number;
    limit?: number;
    userId?: string;
    signal?: AbortSignal;
  }): Promise<Conversation[]> {
    /* Errors propagate so callers can tell "no conversations" from "backend unreachable" */
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
    if (data && Array.isArray(data.data)) {
      return data.data;
    }
    if (data && Array.isArray(data.items)) {
      return data.items;
    }
    return [];
  }

  /**
   * Create a new conversation thread.
   */
  async createConversation(
    title?: string,
    options?: { signal?: AbortSignal; userId?: string },
  ): Promise<Conversation> {
    const response = await this.http.post<Conversation>(
      '/conversations',
      {
        title: title || 'New Conversation',
        userId: options?.userId,
      },
      { signal: options?.signal },
    );
    return response.data;
  }

  /**
   * Get single conversation details with its messages.
   */
  async getConversation(
    conversationId: string,
    options?: { signal?: AbortSignal },
  ): Promise<Conversation> {
    const response = await this.http.get<any>(`/conversations/${conversationId}`, {
      signal: options?.signal,
    });
    const conv = response.data;
    if (conv && Array.isArray(conv.messages)) {
      conv.messages = conv.messages.map((m: any) => ({
        ...m,
        role: String(m.role || 'assistant').toLowerCase() as 'user' | 'assistant' | 'system',
      }));
    }
    return conv;
  }

  /**
   * Get paginated messages for a conversation.
   */
  async getMessages(
    conversationId: string,
    params?: { beforeCursor?: string; limit?: number },
    options?: { signal?: AbortSignal },
  ): Promise<PaginatedMessagesResponse> {
    try {
      const conv = await this.getConversation(conversationId, options);
      const rawMessages: ChatMessage[] = conv.messages || [];

      return {
        messages: rawMessages,
        hasMore: false,
      };
    } catch {
      return {
        messages: [],
        hasMore: false,
      };
    }
  }
}
