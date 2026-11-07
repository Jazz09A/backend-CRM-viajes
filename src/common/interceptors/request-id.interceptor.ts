import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Observable } from 'rxjs';

type Req = FastifyRequest & { requestId?: string };

/** Asigna X-Request-Id a cada petición (spec 3: trazabilidad). */
@Injectable()
export class RequestIdInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const http = context.switchToHttp();
    const request = http.getRequest<Req>();
    const reply = http.getResponse<FastifyReply>();

    const incoming = request.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
    request.requestId = requestId;
    void reply.header('X-Request-Id', requestId);

    return next.handle();
  }
}
