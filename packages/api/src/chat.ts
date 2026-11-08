import { AxiosInstance } from 'axios';
import { SendMessageRequest, SendMessageResponse, CitationMetadata } from './types';

/** Pulls Nest's `{ message }` out of an error response, falling back to the status text. */
async function readErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  try {
    const body = JSON.parse(text) as { message?: string | string[] };
    if (Array.isArray(body.message)) return body.message.join(', ');
    if (body.message) return body.message;
  } catch {
    /* Not JSON */
  }
  return text || `Request failed (${response.status} ${response.statusText})`;
}

export class ChatApi {
  constructor(
    private readonly http: AxiosInstance,
    private readonly getBaseURL?: () => string,
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
      },
      body: JSON.stringify(payload),
      signal: options?.signal,
    });

    if (!response.ok) {
      throw new Error(await readErrorMessage(response));
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
    let streamError: string | undefined;

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
              /* The server ends a failed stream with { error, isComplete: true } */
              if (typeof eventPayload.error === 'string') {
                streamError = eventPayload.error;
              }
              /* Report the id before the first token so the caller can create its thread first */
              if (eventPayload.conversationId && eventPayload.conversationId !== finalConversationId) {
                finalConversationId = eventPayload.conversationId;
                request.onConversationId?.(finalConversationId);
              }
              if (eventPayload.token) {
                accumulatedText += eventPayload.token;
                request.onToken?.(eventPayload.token);
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

    if (streamError) {
      throw new Error(streamError);
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
