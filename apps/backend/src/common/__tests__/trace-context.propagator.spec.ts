import { context, trace, SpanKind } from '@opentelemetry/api';
import { TraceContextPropagator, AppTracer, SemanticAttributes } from '../telemetry';

describe('TraceContextPropagator', () => {
  it('should inject and extract traceparent to/from a plain carrier', async () => {
    await AppTracer.traceSpan('test.root.span', {}, async (span) => {
      const activeTrace = TraceContextPropagator.getActiveTraceInfo();
      expect(activeTrace.traceId).toBeDefined();
      expect(activeTrace.spanId).toBeDefined();

      const carrier: Record<string, unknown> = {};
      TraceContextPropagator.injectToCarrier(carrier);

      expect(carrier.traceparent).toBeDefined();
      expect(carrier.traceparent).toContain(activeTrace.traceId);

      // Extract into a new context
      const extractedCtx = TraceContextPropagator.extractFromCarrier(carrier);
      const extractedSpan = trace.getSpan(extractedCtx);
      expect(extractedSpan).toBeDefined();
      expect(extractedSpan?.spanContext().traceId).toBe(activeTrace.traceId);
    });
  });

  it('should inject and extract W3C trace context to/from SQS MessageAttributes', async () => {
    await AppTracer.traceSpan('test.producer.span', { kind: SpanKind.PRODUCER }, async (span) => {
      const activeTrace = TraceContextPropagator.getActiveTraceInfo();
      const sqsAttributes = TraceContextPropagator.injectToSqsAttributes({});

      expect(sqsAttributes.traceparent).toBeDefined();
      expect(sqsAttributes.traceparent?.DataType).toBe('String');
      expect(sqsAttributes.traceparent?.StringValue).toContain(activeTrace.traceId);
      expect(sqsAttributes.traceId?.StringValue).toBe(activeTrace.traceId);

      // Consumer side extraction
      const extractedCtx = TraceContextPropagator.extractFromSqsAttributes(sqsAttributes);
      const extractedSpan = trace.getSpan(extractedCtx);
      expect(extractedSpan?.spanContext().traceId).toBe(activeTrace.traceId);
    });
  });

  it('should execute consumer span preserving parent trace context', async () => {
    let parentTraceId = '';

    await AppTracer.traceSpan('test.upstream.service', {}, async (parentSpan) => {
      parentTraceId = parentSpan.spanContext().traceId;
      const sqsAttributes = TraceContextPropagator.injectToSqsAttributes({});

      // Simulate consumer worker receiving SQS message in another process/context
      await context.with(context.active(), async () => {
        await AppTracer.traceConsumer(
          'test.downstream.worker',
          sqsAttributes,
          async (consumerSpan) => {
            expect(consumerSpan.spanContext().traceId).toBe(parentTraceId);
            expect(consumerSpan.spanContext().spanId).not.toBe(parentSpan.spanContext().spanId);
          },
        );
      });
    });
  });
});
