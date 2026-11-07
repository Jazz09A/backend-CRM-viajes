import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { ApiError } from '../errors';

interface ProblemBody {
  tipo: string;
  codigo: string;
  mensaje: string;
  detalles?: unknown;
  request_id?: string;
}

/** Renderiza todos los errores con el formato RFC 7807 adaptado (spec 3.1). */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest & { requestId?: string }>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let body: ProblemBody;

    if (exception instanceof ApiError) {
      status = exception.getStatus();
      const res = exception.getResponse() as ProblemBody;
      body = { ...res, request_id: request.requestId };
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'object' && res !== null && 'codigo' in res) {
        body = { ...(res as ProblemBody), request_id: request.requestId };
      } else {
        const message =
          typeof res === 'string' ? res : ((res as { message?: string | string[] }).message ?? exception.message);
        body = {
          tipo: `https://agencia-viajes.local/errores/ERROR`,
          codigo: this.codigoPorStatus(status),
          mensaje: Array.isArray(message) ? message.join(', ') : String(message),
          request_id: request.requestId,
        };
      }
    } else {
      const err = exception as Error;
      this.logger.error(`Error no controlado: ${err?.message}`, err?.stack);
      body = {
        tipo: 'https://agencia-viajes.local/errores/ERROR_INTERNO',
        codigo: 'ERROR_INTERNO',
        mensaje: 'Ocurrió un error inesperado. Intenta de nuevo.',
        request_id: request.requestId,
      };
    }

    if (status >= 500) {
      this.logger.error(`HTTP ${status} ${request.method} ${request.url}`, (exception as Error)?.stack);
    }

    void reply.status(status).send(body);
  }

  private codigoPorStatus(status: number): string {
    switch (status) {
      case 400:
        return 'JSON_INVALIDO';
      case 401:
        return 'NO_AUTENTICADO';
      case 403:
        return 'SIN_PERMISO';
      case 404:
        return 'NO_ENCONTRADO';
      case 409:
        return 'CONFLICTO';
      case 410:
        return 'ENLACE_VENCIDO';
      case 413:
        return 'ARCHIVO_GRANDE';
      case 415:
        return 'ARCHIVO_TIPO_INVALIDO';
      case 422:
        return 'VALIDACION';
      case 429:
        return 'DEMASIADAS_SOLICITUDES';
      default:
        return 'ERROR_INTERNO';
    }
  }
}
