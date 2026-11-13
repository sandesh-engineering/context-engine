import { Test, TestingModule } from '@nestjs/testing';
import { MetricsService } from '../metrics.service';
import { METRICS_CONSTANTS } from '../metrics.constants';

describe('MetricsService', () => {
  let service: MetricsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [MetricsService],
    }).compile();

    service = module.get<MetricsService>(MetricsService);
    service.onModuleInit();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should provide prometheus content type', () => {
    const contentType = service.getContentType();
    expect(contentType).toBeDefined();
    expect(contentType).toContain('text/plain');
  });

  it('should collect metrics including default Node.js and custom HTTP metrics', async () => {
    service.recordHttpRequest('GET', '/api/v1/documents', '200', 0.042);

    const metrics = await service.getMetrics();
    expect(metrics).toContain(METRICS_CONSTANTS.HTTP_REQUESTS_TOTAL);
    expect(metrics).toContain(METRICS_CONSTANTS.HTTP_REQUEST_DURATION_SECONDS);
    expect(metrics).toContain('nodejs_heap_size_used_bytes');
    expect(metrics).toContain('process_cpu_user_seconds_total');
  });

  it('should increment and decrement active requests gauge', async () => {
    service.incrementActiveRequests('POST');
    service.incrementActiveRequests('POST');
    service.decrementActiveRequests('POST');

    const metrics = await service.getMetrics();
    expect(metrics).toContain(METRICS_CONSTANTS.HTTP_ACTIVE_REQUESTS);
  });
});
