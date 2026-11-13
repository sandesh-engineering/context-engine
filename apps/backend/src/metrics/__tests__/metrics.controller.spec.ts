jest.mock('@nestjs/swagger', () => ({
  ApiExcludeEndpoint: () => () => {},
  ApiTags: () => () => {},
}));

import { Test, TestingModule } from '@nestjs/testing';
import { MetricsController } from '../metrics.controller';
import { MetricsService } from '../metrics.service';
import type { Response } from 'express';

describe('MetricsController', () => {
  let controller: MetricsController;
  let service: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [MetricsController],
      providers: [
        {
          provide: MetricsService,
          useValue: {
            getContentType: jest.fn().mockReturnValue('text/plain; version=0.0.4; charset=utf-8'),
            getMetrics: jest.fn().mockResolvedValue('# HELP http_requests_total\nhttp_requests_total 1\n'),
          },
        },
      ],
    }).compile();

    controller = module.get<MetricsController>(MetricsController);
    service = module.get<MetricsService>(MetricsService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('should output metrics and set proper header', async () => {
    const mockRes = {
      setHeader: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn(),
    } as unknown as Response;

    await controller.getMetrics(mockRes);

    expect(service.getContentType).toHaveBeenCalled();
    expect(service.getMetrics).toHaveBeenCalled();
    expect(mockRes.setHeader).toHaveBeenCalledWith(
      'Content-Type',
      'text/plain; version=0.0.4; charset=utf-8',
    );
    expect(mockRes.status).toHaveBeenCalledWith(200);
    expect(mockRes.send).toHaveBeenCalledWith(
      expect.stringContaining('http_requests_total'),
    );
  });
});
