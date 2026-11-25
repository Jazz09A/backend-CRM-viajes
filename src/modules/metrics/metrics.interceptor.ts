import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable } from 'rxjs';
import { client, Registry, Counter, Histogram } from 'prom-client';

@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  private readonly registry: Registry;
  private readonly httpRequestCounter: Counter;
  private readonly httpRequestDuration: Histogram;

  constructor() {
    // Usamos el mismo registry que MetricsService
    this.registry = new client.Registry();

    // Contadores y histogramas que se compartirán con MetricsService
    this.httpRequestCounter = new client.Counter({
      name: 'http_requests_total',
      help: 'Total de peticiones HTTP, count por método y ruta (etiquetas: method, route, status)',
      labelNames: ['method', 'route', 'status'],
    });

    this.httpRequestDuration = new client.Histogram({
      name: 'http_request_duration_seconds',
      help: 'Duración de peticiones HTTP en segundos',
      labelNames: ['method', 'route'],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
    });

    // Registrar en el registry para que queden disponibles en /metrics
    this.registry.registerMetric(this.httpRequestCounter);
    this.registry.registerMetric(this.httpRequestDuration);
  }

  intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    const http = context.switchToHttp();
    const request = http.getRequest();
    const reply = http.getResponse();

    const start = Date.now();

    try {
      return next.handle();
    } finally {
      const duration = (Date.now() - start) / 1000;
      const method = (request as any).method;
      const url = (request as any).url || '';
      const status = reply.statusCode;

      // Normalizar la ruta para controlar cardinalidad
      const routeTemplate = this.normalizeRoute(url);

      // Etiquetas seguras: sin IDs ni query strings que provoquen cardinalidad infinita
      const safeRoute = routeTemplate
        .replace(/\/[0-9]+$/, '/{id}')
        .replace(/\/[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}/g, '/{id}');

      // Incrementar counter en el registry
      this.httpRequestCounter.inc({ method, route: safeRoute, status });

      // Observar histograma en el registry
      this.httpRequestDuration.observe({ method, route: safeRoute, value: duration });
    }
  }

  /** Normaliza la ruta eliminando parámetros dinámicos para controlar cardinalidad */
  private normalizeRoute(url: string): string {
    let normalized = url;

    // Reemplazar :param y parámetros opcionales
    normalized = normalized.replace(/:[\w]+??(\/|$)/g, '{param}$1');

    // Reemplazar UUIDs por {id}
    normalized = normalized.replace(
      /\/\d{8}(-\d{4}){3}-\d{12}/g,
      '/{id}'
    );

    // Reemplazar números de identificación largos
    normalized = normalized.replace(/\/[0-9]{6,}/g, '/{id}');

    // Eliminar query strings
    normalized = normalized.split('?')[0];

    return normalized;
  }
}