import { MetricsMiddleware } from '../metrics.middleware';
import { MetricsService } from '../metrics.service';
import type { Request, Response, NextFunction } from 'express';

describe('MetricsMiddleware', () => {
  let middleware: MetricsMiddleware;
  let mockMetricsService: jest.Mocked<Partial<MetricsService>>;

  beforeEach(() => {
    mockMetricsService = {
      recordHttpRequest: jest.fn(),
      incrementActiveRequests: jest.fn(),
      decrementActiveRequests: jest.fn(),
    };

    middleware = new MetricsMiddleware(
      mockMetricsService as unknown as MetricsService,
    );
  });

  it('should skip /metrics path without recording or active count', () => {
    const req = {
      path: '/metrics',
      method: 'GET',
    } as Request;

    const res = {} as Response;
    const next = jest.fn() as NextFunction;

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockMetricsService.incrementActiveRequests).not.toHaveBeenCalled();
  });

  it('should track active requests and record latency on finish', () => {
    let finishHandler: (() => void) | undefined;

    const req = {
      path: '/api/v1/documents',
      method: 'GET',
      route: { path: '/api/v1/documents' },
    } as unknown as Request;

    const res = {
      statusCode: 200,
      on: jest.fn((event: string, callback: () => void) => {
        if (event === 'finish') {
          finishHandler = callback;
        }
      }),
    } as unknown as Response;

    const next = jest.fn() as NextFunction;

    middleware.use(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(mockMetricsService.incrementActiveRequests).toHaveBeenCalledWith('GET');

    // Simulate response finishing
    expect(finishHandler).toBeDefined();
    finishHandler?.();

    expect(mockMetricsService.decrementActiveRequests).toHaveBeenCalledWith('GET');
    expect(mockMetricsService.recordHttpRequest).toHaveBeenCalledWith(
      'GET',
      '/api/v1/documents',
      '200',
      expect.any(Number),
    );
  });
});
