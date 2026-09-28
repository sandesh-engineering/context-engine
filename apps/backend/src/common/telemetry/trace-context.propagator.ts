import {
  context,
  propagation,
  trace,
  Context,
  Span,
  SpanStatusCode,
  SpanKind,
  SpanOptions,
  Tracer,
  Link,
} from '@opentelemetry/api';
import type { MessageAttributeValue } from '@aws-sdk/client-sqs';

export interface TraceContextCarrier {
  traceparent?: string;
  tracestate?: string;
  [key: string]: unknown;
}

export interface SqsMessageAttributesMap {
  [key: string]: MessageAttributeValue;
}

/**
 * Standard W3C Trace Context propagation utilities for SQS messaging and database outbox metadata.
 */
export class TraceContextPropagator {
  /**
   * Retrieves the currently active span if one exists.
   */
  static getActiveSpan(): Span | undefined {
    return trace.getActiveSpan();
  }

  /**
   * Returns current active traceId and spanId (or undefined if no active trace context).
   */
  static getActiveTraceInfo(): { traceId?: string; spanId?: string } {
    const activeSpan = trace.getActiveSpan();
    if (!activeSpan) return {};
    const spanCtx = activeSpan.spanContext();
    return {
      traceId: spanCtx.traceId,
      spanId: spanCtx.spanId,
    };
  }

  /**
   * Injects the active (or provided) OpenTelemetry context into a plain carrier object.
   * Produces `traceparent` (and `tracestate` if present).
   */
  static injectToCarrier(
    target: Record<string, unknown> = {},
    ctx: Context = context.active(),
  ): TraceContextCarrier {
    const carrier: Record<string, string> = {};
    propagation.inject(ctx, carrier);

    if (carrier.traceparent) {
      target.traceparent = carrier.traceparent;
    }
    if (carrier.tracestate) {
      target.tracestate = carrier.tracestate;
    }
    return target as TraceContextCarrier;
  }

  /**
   * Extracts OpenTelemetry context from a plain carrier object containing `traceparent` and optional `tracestate`.
   */
  static extractFromCarrier(
    carrier: TraceContextCarrier | null | undefined,
    parentCtx: Context = context.active(),
  ): Context {
    if (!carrier || !carrier.traceparent) {
      return parentCtx;
    }

    const carrierRecord: Record<string, string> = {
      traceparent: String(carrier.traceparent),
    };
    if (carrier.tracestate) {
      carrierRecord.tracestate = String(carrier.tracestate);
    }

    return propagation.extract(parentCtx, carrierRecord);
  }

  /**
   * Injects active context into SQS MessageAttributes for queue publishing.
   */
  static injectToSqsAttributes(
    attributes: SqsMessageAttributesMap = {},
    ctx: Context = context.active(),
  ): SqsMessageAttributesMap {
    const carrier: Record<string, string> = {};
    propagation.inject(ctx, carrier);

    const activeTrace = this.getActiveTraceInfo();

    if (carrier.traceparent) {
      attributes.traceparent = {
        DataType: 'String',
        StringValue: carrier.traceparent,
      };
    }
    if (carrier.tracestate) {
      attributes.tracestate = {
        DataType: 'String',
        StringValue: carrier.tracestate,
      };
    }
    if (activeTrace.traceId) {
      attributes.traceId = {
        DataType: 'String',
        StringValue: activeTrace.traceId,
      };
    }

    return attributes;
  }

  /**
   * Extracts OpenTelemetry context from SQS MessageAttributes.
   */
  static extractFromSqsAttributes(
    attributes?: SqsMessageAttributesMap | null,
    parentCtx: Context = context.active(),
  ): Context {
    if (!attributes) {
      return parentCtx;
    }

    const carrier: Record<string, string> = {};

    if (attributes.traceparent?.StringValue) {
      carrier.traceparent = attributes.traceparent.StringValue;
    }
    if (attributes.tracestate?.StringValue) {
      carrier.tracestate = attributes.tracestate.StringValue;
    }

    if (!carrier.traceparent) {
      return parentCtx;
    }

    return propagation.extract(parentCtx, carrier);
  }

  /**
   * Creates an OpenTelemetry Link from extracted carrier or SQS attributes for causal tracing.
   */
  static createLinkFromAttributes(
    attributes?: SqsMessageAttributesMap | null,
  ): Link | undefined {
    if (!attributes) return undefined;
    const extractedCtx = this.extractFromSqsAttributes(attributes);
    const span = trace.getSpan(extractedCtx);
    if (!span) return undefined;
    return {
      context: span.spanContext(),
    };
  }
}
