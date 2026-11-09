import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ApiError } from '../errors';

/**
 * Limitador de intentos en memoria, por IP.
 *
 * Sirve para las rutas públicas que pueden abusarse (alta del administrador
 * inicial). Es deliberadamente simple: un `Map` por
 * proceso. En producción con varias instancias habría que moverlo a Redis
 * (mismo TODO que el rate limit de `AuthService`).
 */
@Injectable()
export class LimiteIntentosGuard implements CanActivate {
  private readonly intentos = new Map<string, { contador: number; reiniciaEn: number }>();

  constructor(
    private readonly max: number,
    private readonly ventanaMs: number,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const clave = request.ip ?? 'desconocido';
    const ahora = Date.now();

    const previo = this.intentos.get(clave);
    if (!previo || previo.reiniciaEn <= ahora) {
      this.intentos.set(clave, { contador: 1, reiniciaEn: ahora + this.ventanaMs });
      return true;
    }

    if (previo.contador >= this.max) {
      const segundos = Math.max(1, Math.ceil((previo.reiniciaEn - ahora) / 1000));
      throw ApiError.demasiadasSolicitudes(
        'Demasiados intentos. Espera un momento antes de volver a intentarlo.',
        segundos,
      );
    }

    previo.contador += 1;
    return true;
  }
}
