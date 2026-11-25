import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';
import { MetricsService } from './metrics.service';

/**
 * Mide duración y resultados de cada petición HTTP.
 * Usa el registry de MetricsService para que las métricas aparezcan
 * en GET /metrics junto con las de negocio y las de proceso.
 */
@Injectable()
export class MetricsInterceptor implements NestInterceptor {
  constructor(private readonly metrics: MetricsService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<{ method?: string; url?: string }>();
    const reply = http.getResponse<{ statusCode: number }>();

    const start = process.hrtime.bigint();
    const method = request.method ?? 'UNKNOWN';

    // finalize corre al completar (o fallar) el handler. El status de error
    // lo asigna el exception filter después, así que se lee en un setImmediate.
    return next.handle().pipe(
      finalize(() => {
        setImmediate(() => {
          const durationSeconds = Number(process.hrtime.bigint() - start) / 1e9;
          this.metrics.observeHttp({
            method,
            route: this.normalizeRoute(request.url ?? ''),
            status: reply.statusCode,
            durationSeconds,
          });
        });
      }),
    );
  }

  /**
   * Normaliza la ruta para controlar la cardinalidad de las etiquetas:
   * quita query string y sustituye IDs/UUIDs por placeholders.
   */
  private normalizeRoute(url: string): string {
    let route = url.split('?')[0];

    // UUIDs → {id}
    route = route.replace(
      /[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g,
      '{id}',
    );
    // Segmentos numéricos largos (≥4 dígitos) → {id}
    route = route.replace(/\/\d{4,}(?=\/|$)/g, '/{id}');
    // Rutas tipo /api/v1/tours/:id/fechas (si Fastify expone la plantilla)
    route = route.replace(/:[\w]+/g, '{param}');

    return route || '/';
  }
}
