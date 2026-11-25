import { Controller, Get, Header } from '@nestjs/common';
import { Public } from '../../common/decorators/roles.decorator';
import { MetricsService } from './metrics.service';

/** Endpoint de exposición Prometheus. Bloqueado en nginx; scrape por loopback. */
@Public()
@Controller()
export class MetricsController {
  constructor(private readonly metricsService: MetricsService) {}

  @Get('metrics')
  @Header('Content-Type', 'text/plain; version=0.0.4; charset=utf-8')
  async getMetrics(): Promise<string> {
    return this.metricsService.getMetrics();
  }
}
