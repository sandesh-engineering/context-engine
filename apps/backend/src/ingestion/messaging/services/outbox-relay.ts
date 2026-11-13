import type { BaseOutboxEntity } from '../../database/entities/base-outbox.entity';
import type { OutboxStore } from '../../database/repositories/outbox-store';
import type {
  IMessagePublisher,
  OutboxMessagePayload,
} from '../interfaces/message-publisher.interface';
import { StructuredLogger, LogEvents } from '../../../common/logger';

export interface OutboxRelayResult {
  polledCount: number;
  publishedCount: number;
  dlqCount: number;
  failedCount: number;
}

export const EMPTY_RELAY_RESULT: OutboxRelayResult = Object.freeze({
  polledCount: 0,
  publishedCount: 0,
  dlqCount: 0,
  failedCount: 0,
});

export interface OutboxRelayParams<E extends BaseOutboxEntity> {
  store: OutboxStore<E>;
  publisher: IMessagePublisher;
  batchSize: number;
  maxRetries: number;
  logger: StructuredLogger;
  /** Used in log messages, e.g. "ingestion" or "embedding". */
  label: string;
}

/**
 * Publishes one batch of pending outbox events and records the outcome.
 *
 * @remarks
 * - Published events are marked processed.
 * - Failed events get their retry counter bumped; once `maxRetries` is reached they are sent to
 *   the DLQ and marked failed.
 */
export async function relayOutboxBatch<E extends BaseOutboxEntity>(
  params: OutboxRelayParams<E>,
): Promise<OutboxRelayResult> {
  const { store, publisher, batchSize, maxRetries, logger, label } = params;

  const pendingEvents = await store.fetchPendingOutboxEvents(batchSize);
  if (pendingEvents.length === 0) {
    return { ...EMPTY_RELAY_RESULT };
  }

  logger.debugEvent(LogEvents.OUTBOX_POLL_STARTED, { batchSize: pendingEvents.length, outbox: label });

  const messages: OutboxMessagePayload[] = pendingEvents.map((evt) => ({
    eventId: evt.event_id,
    eventType: evt.topic,
    timestamp: evt.created_at ? new Date(evt.created_at).toISOString() : new Date().toISOString(),
    traceId: (evt.metadata?.traceId as string) || undefined,
    traceparent: (evt.metadata?.traceparent as string) || undefined,
    tracestate: (evt.metadata?.tracestate as string) || undefined,
    metadata: evt.metadata || undefined,
    payload: evt.payload || {},
  }));

  const publishResult = await publisher.publishBatch(messages);
  const result: OutboxRelayResult = { ...EMPTY_RELAY_RESULT, polledCount: pendingEvents.length };

  if (publishResult.successful.length > 0) {
    const successIds = publishResult.successful.map((item) => item.eventId);
    await store.markEventsProcessed(successIds);
    result.publishedCount = successIds.length;
  }

  if (publishResult.failed.length > 0) {
    result.failedCount = publishResult.failed.length;
    const retriesById = new Map(pendingEvents.map((evt) => [evt.event_id, evt.retries || 0]));
    const dlqEligibleIds: string[] = [];
    const retryEligibleIds: string[] = [];

    for (const { eventId } of publishResult.failed) {
      if ((retriesById.get(eventId) ?? 0) + 1 >= maxRetries) {
        dlqEligibleIds.push(eventId);
      } else {
        retryEligibleIds.push(eventId);
      }
    }

    if (retryEligibleIds.length > 0) {
      await store.incrementRetries(retryEligibleIds);
      logger.warn(`Incremented ${label} outbox retry attempt counters`, {
        retryCount: retryEligibleIds.length,
        eventIds: retryEligibleIds,
      });
    }

    if (dlqEligibleIds.length > 0) {
      const dlqIds = new Set(dlqEligibleIds);
      try {
        const dlqResult = await publisher.publishToDlq(
          messages.filter((m) => dlqIds.has(m.eventId)),
          `${label} batch publish failed after ${maxRetries} retries`,
        );
        const dlqSuccessIds = dlqResult.successful.map((item) => item.eventId);
        if (dlqSuccessIds.length > 0) {
          await store.markEventsFailedDlq(dlqSuccessIds);
          result.dlqCount = dlqSuccessIds.length;
        }
      } catch (dlqErr) {
        logger.error(`Failed rerouting unprocessable ${label} outbox batch to DLQ`, {
          dlqCount: dlqEligibleIds.length,
          error: dlqErr instanceof Error ? dlqErr.message : String(dlqErr),
        });
      }
    }
  }

  logger.log(`Completed ${label} outbox relay iteration`, { ...result });
  return result;
}
