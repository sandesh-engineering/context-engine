import { AxiosInstance } from 'axios';
import { SendMessageRequest, SendMessageResponse, CitationMetadata } from './types';

export class ChatApi {
  constructor(
    private readonly http: AxiosInstance,
    private readonly getBaseURL?: () => string,
    private readonly getTenantId?: () => string | undefined,
  ) { }

  /**
   * Send a chat message and receive real-time streamed response via SSE.
   */
  async sendMessage(
    request: SendMessageRequest,
    options?: { signal?: AbortSignal },
  ): Promise<SendMessageResponse> {
    const rawBaseURL =
      (this.getBaseURL ? this.getBaseURL() : '') ||
      (this.http.defaults.baseURL as string) ||
      'http://localhost:5001/api/v1';

    const baseURL = rawBaseURL.replace(/\/$/, '');
    const tenantId = this.getTenantId ? this.getTenantId() : undefined;

    const endpoint = request.conversationId
      ? `${baseURL}/conversations/${request.conversationId}/messages`
      : `${baseURL}/conversations/messages`;

    const payload = {
      query: request.message,
      userId: request.userId,
      title: request.title,
      topK: request.topK,
      similarityThreshold: request.similarityThreshold,
    };

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(tenantId ? { 'x-tenant-id': tenantId } : {}),
      },
      body: JSON.stringify(payload),
      signal: options?.signal,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Chat API error (${response.status}): ${errorText || response.statusText}`);
    }

    if (!response.body) {
      throw new Error('Response body is null or streaming is unsupported');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedText = '';
    let finalConversationId = request.conversationId || '';
    let citations: CitationMetadata[] = [];
    let insufficientEvidence = false;
    let messageId = `msg-${Date.now()}`;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data:')) {
            const jsonStr = trimmed.slice(5).trim();
            if (!jsonStr) continue;

            try {
              const eventPayload = JSON.parse(jsonStr);
              if (eventPayload.token) {
                accumulatedText += eventPayload.token;
                request.onToken?.(eventPayload.token);
              }
              if (eventPayload.conversationId) {
                finalConversationId = eventPayload.conversationId;
              }
              if (eventPayload.citations) {
                citations = eventPayload.citations;
                request.onCitation?.(eventPayload.citations);
              }
              if (eventPayload.insufficientEvidence !== undefined) {
                insufficientEvidence = eventPayload.insufficientEvidence;
              }
              if (eventPayload.messageId) {
                messageId = eventPayload.messageId;
              }
            } catch {
              // Ignore partial JSON parse errors
            }
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    return {
      conversationId: finalConversationId,
      citations,
      insufficientEvidence,
      message: {
        id: messageId,
        conversationId: finalConversationId,
        role: 'assistant',
        content: accumulatedText,
        citations,
        insufficientEvidence,
        createdAt: new Date().toISOString(),
      },
    };
  }
}
