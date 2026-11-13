import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';
import { MetricsMiddleware } from './metrics.middleware';
import { DatabasePoolMetricsAdapter } from './database-pool-metrics.adapter';

@Module({
  controllers: [MetricsController],
  providers: [MetricsService, MetricsMiddleware, DatabasePoolMetricsAdapter],
  exports: [MetricsService, DatabasePoolMetricsAdapter],
})
export class MetricsModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(MetricsMiddleware).forRoutes('*');
  }
}
