import { Logger } from '@nestjs/common';
import { TraceContextPropagator } from '../telemetry/trace-context.propagator';
import { LogEvent } from './log-events';
import { ErrorClassifier, ErrorCategory } from '../../ingestion/resilience/error-classifier';

export interface LogContext {
  event?: LogEvent;
  traceId?: string;
  spanId?: string;
  requestId?: string;
  jobId?: string;
  documentId?: string;
  versionId?: string;
  chunkId?: string;
  eventId?: string;
  messageId?: string;
  workerName?: string;
  stage?: string;
  attempt?: number;
  durationMs?: number;
  errorType?: string;
  errorMessage?: string;
  retryable?: boolean;
  [key: string]: unknown;
}

export interface StructuredLogEntry extends LogContext {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  event?: LogEvent;
  service: string;
  contextName: string;
}

export class StructuredLogger {
  private readonly nestLogger: Logger;
  private readonly contextName: string;
  private readonly serviceName: string;

  constructor(contextName: string, serviceName = 'knowledge-engine') {
    this.contextName = contextName;
    this.serviceName = serviceName;
    this.nestLogger = new Logger(contextName);
  }

  private normalizeArgs(
    arg1: string | LogContext,
    arg2?: unknown,
    arg3?: LogContext,
  ): { message: string; event?: LogEvent; error?: unknown; context: LogContext } {
    let message = '';
    let event: LogEvent | undefined;
    let error: unknown = undefined;
    let context: LogContext = {};

    if (typeof arg1 === 'string') {
      message = arg1;
      if (arg2 instanceof Error) {
        error = arg2;
        context = arg3 || {};
      } else if (arg2 && typeof arg2 === 'object') {
        const obj = arg2 as LogContext;
        if (obj.error) {
          error = obj.error;
        }
        context = { ...obj };
      }
    } else if (arg1 && typeof arg1 === 'object') {
      context = { ...arg1 };
      if (context.error) {
        error = context.error;
      }
      if (typeof arg2 === 'string') {
        message = arg2;
      } else if (context.message && typeof context.message === 'string') {
        message = context.message;
      } else if (context.event) {
        message = String(context.event);
      }
    }

    if (context.event) {
      event = context.event;
    } else if (message.includes('.') && !message.includes(' ')) {
      event = message as LogEvent;
    }

    return { message, event, error, context };
  }

  private buildEntry(
    level: 'info' | 'warn' | 'error' | 'debug',
    message: string,
    event?: LogEvent,
    error?: unknown,
    ctx: LogContext = {},
  ): StructuredLogEntry {
    const traceInfo = TraceContextPropagator.getActiveTraceInfo();

    let errorType: string | undefined = ctx.errorType;
    let errorMessage: string | undefined = ctx.errorMessage;
    let retryable: boolean | undefined = ctx.retryable;

    if (error) {
      if (!errorType) {
        errorType = ErrorClassifier.classify(error);
      }
      if (retryable === undefined) {
        retryable = ErrorClassifier.isRetryable(error);
      }
      if (!errorMessage) {
        errorMessage = error instanceof Error ? error.message : String(error);
      }
    }

    const cleanCtx = { ...ctx };
    delete cleanCtx.error; // Avoid dumping raw error object if serialized

    return {
      timestamp: new Date().toISOString(),
      level,
      message: message || (event ? String(event) : ''),
      event,
      service: this.serviceName,
      contextName: this.contextName,
      traceId: cleanCtx.traceId || traceInfo.traceId,
      spanId: cleanCtx.spanId || traceInfo.spanId,
      ...cleanCtx,
      ...(errorType ? { errorType } : {}),
      ...(errorMessage ? { errorMessage } : {}),
      ...(retryable !== undefined ? { retryable } : {}),
    };
  }

  log(messageOrContext: string | LogContext, contextOrMessage?: LogContext | string): void {
    this.info(messageOrContext, contextOrMessage);
  }

  info(messageOrContext: string | LogContext, contextOrMessage?: LogContext | string): void {
    const { message, event, error, context } = this.normalizeArgs(
      messageOrContext,
      contextOrMessage,
    );
    const entry = this.buildEntry('info', message, event, error, context);
    this.nestLogger.log(JSON.stringify(entry));
  }

  logEvent(event: LogEvent, context: LogContext = {}): void {
    const entry = this.buildEntry('info', (context.message as string) || event, event, undefined, {
      ...context,
      event,
    });
    this.nestLogger.log(JSON.stringify(entry));
  }

  warn(
    messageOrContext: string | LogContext,
    contextOrMessage?: LogContext | string,
  ): void {
    const { message, event, error, context } = this.normalizeArgs(
      messageOrContext,
      contextOrMessage,
    );
    const entry = this.buildEntry('warn', message, event, error, context);
    this.nestLogger.warn(JSON.stringify(entry));
  }

  warnEvent(event: LogEvent, context: LogContext = {}): void {
    const entry = this.buildEntry('warn', (context.message as string) || event, event, undefined, {
      ...context,
      event,
    });
    this.nestLogger.warn(JSON.stringify(entry));
  }

  debug(
    messageOrContext: string | LogContext,
    contextOrMessage?: LogContext | string,
  ): void {
    const { message, event, error, context } = this.normalizeArgs(
      messageOrContext,
      contextOrMessage,
    );
    const entry = this.buildEntry('debug', message, event, error, context);
    this.nestLogger.debug(JSON.stringify(entry));
  }

  debugEvent(event: LogEvent, context: LogContext = {}): void {
    const entry = this.buildEntry('debug', (context.message as string) || event, event, undefined, {
      ...context,
      event,
    });
    this.nestLogger.debug(JSON.stringify(entry));
  }

  logError(event: LogEvent, error: unknown, context: LogContext = {}): void {
    const entry = this.buildEntry(
      'error',
      (context.message as string) || event,
      event,
      error,
      { ...context, event },
    );
    this.nestLogger.error(
      JSON.stringify(entry),
      error instanceof Error ? error.stack : undefined,
    );
  }

  error(
    messageOrContext: string | LogContext,
    errorOrContextOrMessage?: unknown,
    context?: LogContext,
  ): void {
    const {
      message,
      event,
      error,
      context: normCtx,
    } = this.normalizeArgs(messageOrContext, errorOrContextOrMessage, context);
    const entry = this.buildEntry('error', message, event, error, normCtx);
    this.nestLogger.error(
      JSON.stringify(entry),
      error instanceof Error ? error.stack : undefined,
    );
  }
}
