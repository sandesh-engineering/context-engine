export interface OutboxMessagePayload {
  eventId: string;
  eventType: string;
  timestamp: string;
  traceId?: string;
  traceparent?: string;
  tracestate?: string;
  metadata?: Record<string, unknown>;
  payload: Record<string, any>;
}

export interface PublishBatchItemResult {
  eventId: string;
  messageId?: string;
  success: boolean;
  error?: string;
}

export interface PublishBatchResult {
  successful: PublishBatchItemResult[];
  failed: PublishBatchItemResult[];
}

export interface IMessagePublisher {
  publishBatch(messages: OutboxMessagePayload[]): Promise<PublishBatchResult>;
  publishToDlq(messages: OutboxMessagePayload[], errorReason: string): Promise<PublishBatchResult>;
}

export const MESSAGE_PUBLISHER = 'MESSAGE_PUBLISHER';
