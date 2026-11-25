import { Injectable } from '@nestjs/common';
import {
  Registry,
  collectDefaultMetrics,
  Counter,
  Histogram,
  Gauge,
} from 'prom-client';

/**
 * Dueño único del registry de Prometheus y de todas las métricas.
 * El interceptor HTTP llama a observeHttp(); los módulos de negocio
 * incrementan los contadores/gauges expuestos por los getters.
 */
@Injectable()
export class MetricsService {
  readonly registry = new Registry();

  // ── HTTP ────────────────────────────────────────────────────────────────
  private readonly httpRequestsTotal: Counter<'method' | 'route' | 'status'>;
  private readonly httpDuration: Histogram<'method' | 'route'>;

  // ── Negocio (spec 12.1) ─────────────────────────────────────────────────
  private readonly reservasConflictoTotal: Counter<'codigo'>;
  private readonly reservasCreadasTotal: Counter<string>;
  private readonly reservasPorEstado: Gauge<'estado'>;
  private readonly vouchersGeneradosTotal: Counter<'resultado'>;
  private readonly voucherGeneracionSeconds: Histogram<string>;
  private readonly emailsTotal: Counter<'resultado'>;
  private readonly outboxPendiente: Gauge<string>;

  constructor() {
    // Métricas de proceso Node (event loop, memoria, uptime, GC…)
    collectDefaultMetrics({ register: this.registry });

    // ── HTTP ──────────────────────────────────────────────────────────────
    this.httpRequestsTotal = new Counter({
      name: 'http_requests_total',
      help: 'Total de peticiones HTTP por método, ruta y status',
      labelNames: ['method', 'route', 'status'],
    });
    this.registry.registerMetric(this.httpRequestsTotal);

    this.httpDuration = new Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duración de peticiones HTTP en segundos',
      labelNames: ['method', 'route'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    });
    this.registry.registerMetric(this.httpDuration);

    // ── Negocio ───────────────────────────────────────────────────────────
    this.reservasConflictoTotal = new Counter({
      name: 'reservas_conflicto_total',
      help: 'Conflictos de cupo/reserva por código (SIN_CUPO, OPCION_AGOTADA, …)',
      labelNames: ['codigo'],
    });
    this.registry.registerMetric(this.reservasConflictoTotal);

    this.reservasCreadasTotal = new Counter({
      name: 'reservas_creadas_total',
      help: 'Total de reservas creadas',
    });
    this.registry.registerMetric(this.reservasCreadasTotal);

    this.reservasPorEstado = new Gauge({
      name: 'reservas_por_estado',
      help: 'Número actual de reservas por estado',
      labelNames: ['estado'],
    });
    this.registry.registerMetric(this.reservasPorEstado);

    this.vouchersGeneradosTotal = new Counter({
      name: 'vouchers_generados_total',
      help: 'Total de vouchers generados por resultado (ok, error)',
      labelNames: ['resultado'],
    });
    this.registry.registerMetric(this.vouchersGeneradosTotal);

    this.voucherGeneracionSeconds = new Histogram({
      name: 'voucher_generacion_seconds',
      help: 'Duración de generación de voucher en segundos',
      buckets: [1, 5, 10, 30, 60, 120, 300, 600, 1800, 3600],
    });
    this.registry.registerMetric(this.voucherGeneracionSeconds);

    this.emailsTotal = new Counter({
      name: 'emails_total',
      help: 'Total de emails por resultado (enviado, rebotado, error)',
      labelNames: ['resultado'],
    });
    this.registry.registerMetric(this.emailsTotal);

    this.outboxPendiente = new Gauge({
      name: 'outbox_pendiente',
      help: 'Mensajes pendientes en el outbox',
    });
    this.registry.registerMetric(this.outboxPendiente);
  }

  /** Registra una petición HTTP (lo llama MetricsInterceptor). */
  observeHttp(params: {
    method: string;
    route: string;
    status: number;
    durationSeconds: number;
  }): void {
    const { method, route, status, durationSeconds } = params;
    this.httpRequestsTotal.inc({ method, route, status: String(status) });
    this.httpDuration.observe({ method, route }, durationSeconds);
  }

  // ── Getters de negocio ──────────────────────────────────────────────────
  getReservasConflictoCounter(): Counter<'codigo'> {
    return this.reservasConflictoTotal;
  }

  getReservasCreadasCounter(): Counter<string> {
    return this.reservasCreadasTotal;
  }

  getReservasPorEstadoGauge(): Gauge<'estado'> {
    return this.reservasPorEstado;
  }

  getVouchersGeneradosCounter(): Counter<'resultado'> {
    return this.vouchersGeneradosTotal;
  }

  getVoucherGeneracionHistogram(): Histogram<string> {
    return this.voucherGeneracionSeconds;
  }

  getEmailsTotalCounter(): Counter<'resultado'> {
    return this.emailsTotal;
  }

  getOutboxPendienteGauge(): Gauge<string> {
    return this.outboxPendiente;
  }

  /** Cuerpo exposition-format para GET /metrics. */
  async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }
}
