import { Controller, Get, Res, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { MetricsService } from './metrics.service';

@ApiTags('Observability')
@Controller({ path: ['metrics', 'api/metrics'], version: VERSION_NEUTRAL })
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  /**
   * Exposes Prometheus metrics for ResLab and scrapers.
   */
  @Get()
  @ApiExcludeEndpoint()
  async getMetrics(@Res() res: Response): Promise<void> {
    const contentType = this.metricsService.getContentType();
    const metrics = await this.metricsService.getMetrics();

    res.setHeader('Content-Type', contentType);
    res.status(200).send(metrics);
  }
}
