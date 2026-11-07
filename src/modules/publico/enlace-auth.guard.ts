import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { ApiError } from '../../common/errors';
import { ReservaStateMachine } from '../reservas/reserva-state-machine';
import { Reserva } from '../../database/entities';

/**
 * Autenticación del cliente por enlace (spec 7): header `X-Enlace-Token`.
 * El token nunca va en la URL de la API ni en la ruta — la reserva se
 * resuelve desde el hash, por lo que no hay superficie IDOR.
 */
@Injectable()
export class EnlaceAuthGuard implements CanActivate {
  constructor(private readonly stateMachine: ReservaStateMachine) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest & { reserva?: Reserva }>();
    const token = request.headers['x-enlace-token'];
    if (typeof token !== 'string' || !token) throw ApiError.enlaceInvalido();

    const { reserva } = await this.stateMachine.resolverPorToken(token);
    request.reserva = reserva;
    return true;
  }
}
