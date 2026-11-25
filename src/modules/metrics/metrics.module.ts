import { Global, Module } from '@nestjs/common';
import { MetricsService } from './metrics.service';
import { MetricsController } from './metrics.controller';

/**
 * Módulo global de métricas Prometheus.
 * - Expone GET /metrics (fuera del prefijo api/v1, marcado @Public).
 * - MetricsService es inyectable desde cualquier otro módulo para
 *   incrementar métricas de negocio (reservas, vouchers, emails, outbox).
 */
@Global()
@Module({
  controllers: [MetricsController],
  providers: [MetricsService],
  exports: [MetricsService],
})
export class MetricsModule {}
