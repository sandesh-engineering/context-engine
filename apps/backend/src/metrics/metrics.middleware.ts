import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { MetricsService } from './metrics.service';

@Injectable()
export class MetricsMiddleware implements NestMiddleware {
  constructor(private readonly metricsService: MetricsService) {}

  use(req: Request, res: Response, next: NextFunction): void {
    const rawPath = req.path || req.originalUrl || req.url || '';

    // Exclude /metrics endpoint from its own telemetry to avoid skewing request counts
    if (rawPath === '/metrics' || rawPath.endsWith('/metrics')) {
      return next();
    }

    const start = process.hrtime();
    const method = req.method;

    this.metricsService.incrementActiveRequests(method);

    res.on('finish', () => {
      this.metricsService.decrementActiveRequests(method);

      const diff = process.hrtime(start);
      const durationSeconds = diff[0] + diff[1] / 1e9;

      // Normalize route pattern to avoid high cardinality metrics
      const route = req.route?.path
        ? `${req.baseUrl || ''}${req.route.path}`
        : res.statusCode === 404
          ? 'not_found'
          : req.baseUrl || req.path || 'unknown';

      const status = String(res.statusCode);

      this.metricsService.recordHttpRequest(
        method,
        route,
        status,
        durationSeconds,
      );
    });

    next();
  }
}
