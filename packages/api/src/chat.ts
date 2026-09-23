import { AxiosInstance } from 'axios';
import { SendMessageRequest, SendMessageResponse } from './types';

export class ChatApi {
  constructor(private readonly http: AxiosInstance) {}

  /**
   * Send a chat message and receive synchronous or streamed response.
   */
  async sendMessage(
    request: SendMessageRequest,
    options?: { signal?: AbortSignal },
  ): Promise<SendMessageResponse> {
    const response = await this.http.post<SendMessageResponse>(
      '/chat',
      request,
      {
        signal: options?.signal,
      },
    );
    return response.data;
  }
}
