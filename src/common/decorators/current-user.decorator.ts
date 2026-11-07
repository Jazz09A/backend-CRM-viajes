import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Rol } from './roles.decorator';

export interface UsuarioActual {
  id: string;
  correo: string;
  nombre: string;
  roles: Rol[];
}

declare module 'fastify' {
  interface FastifyRequest {
    user?: UsuarioActual;
    requestId?: string;
  }
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): UsuarioActual | undefined =>
    ctx.switchToHttp().getRequest<FastifyRequest>().user,
);
