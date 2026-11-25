import { Injectable, OnModuleInit } from '@nestjs/common';
import client from 'prom-client';
import { lastValueFrom } from 'rxjs';

@Injectable()
export class MetricsService implements OnModuleInit {
  readonly registry = new client.Registry();

  constructor() {
    // Collect default Node.js metrics (event loop latency, memory, uptime)
    client.collectDefaultMetrics({ register: this.registry, timeout: 30000 });
  }

  onModuleInit() {
    // Garantizar que las métricas de default se registren tras el connect a DB, etc.
    // Las métricas de negocio se registran bajo demanda en el controller
  }

  /** HTTP request counter - ya está registrado en el registry por el interceptor */
  getHttpRequestCounter() {
    return this.registry.getSingleMetric('http_requests_total');
  }

  /** HTTP request duration histogram - ya está registrado en el registry por el interceptor */
  getHttpRequestDurationHistogram() {
    return this.registry.getSingleMetric('http_request_duration_seconds');
  }

  /** Métricas de negocio - Reservas */
  getReservasConflictoCounter() {
    return this.registry.getSingleMetric('reservas_conflicto_total') || new client.Counter({
      name: 'reservas_conflicto_total',
      help: 'Total de conflictos de cupo/reserva por código',
      labelNames: ['codigo'],
    });
  }

  getReservasCreadasCounter() {
    return this.registry.getSingleMetric('reservas_creadas_total') || new client.Counter({
      name: 'reservas_creadas_total',
      help: 'Total de reservas creadas',
    });
  }

  getReservasPorEstadoGauge() {
    return this.registry.getSingleMetric('reservas_por_estado') || new client.Gauge({
      name: 'reservas_por_estado',
      help: 'Número actual de reservas por estado',
      labelNames: ['estado'],
    });
  }

  /** Métricas de negocio - Vouchers */
  getVouchersGeneradosCounter() {
    return this.registry.getSingleMetric('vouchers_generados_total') || new client.Counter({
      name: 'vouchers_generados_total',
      help: 'Total de vouchers generados por resultado',
      labelNames: ['resultado'],
    });
  }

  getVoucherGeneracionHistogram() {
    return this.registry.getSingleMetric('voucher_generacion_seconds') || new client.Histogram({
      name: 'voucher_generacion_seconds',
      help: 'Duración de generación de voucher en segundos',
      buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600],
    });
  }

  /** Métricas de negocio - Emails */
  getEmailsTotalCounter() {
    return this.registry.getSingleMetric('emails_total') || new client.Counter({
      name: 'emails_total',
      help: 'Total de emails enviados por resultado',
      labelNames: ['resultado'],
    });
  }

  /** Métricas de negocio - Outbox */
  getOutboxPendienteGauge() {
    return this.registry.getSingleMetric('outbox_pendiente') || new client.Gauge({
      name: 'outbox_pendiente',
      help: 'Número de mensajes pendientes en outbox',
    });
  }

  /** Métricas de proceso Node */
  getEventLoopLagGauge() {
    return this.registry.getSingleMetric('event_loop_legacy_lag_seconds') || new client.Gauge({
      name: 'event_loop_legacy_lag_seconds',
      help: 'Lag del event loop de Node.js en segundos',
    });
  }

  /** Obtener el cuerpo de exposición Prometheus */
  async getMetrics(): Promise<string> {
    return await this.registry.metrics();
  }
}