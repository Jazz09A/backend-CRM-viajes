import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { FastifyRequest } from 'fastify';
import { ApiError } from '../errors';
import { UsuarioActual } from '../decorators/current-user.decorator';
import { ROLES_KEY, Rol } from '../decorators/roles.decorator';

export const ES_PUBLICO_KEY = 'esPublico';

/** Guard JWT para la API admin. Rutas marcadas con @Public() lo omiten. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const esPublico = this.reflector.getAllAndOverride<boolean>(ES_PUBLICO_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (esPublico) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw ApiError.noAutenticado();

    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; correo: string; roles: Rol[] }>(token);
      request.user = {
        id: payload.sub,
        correo: payload.correo,
        nombre: payload.correo,
        roles: payload.roles ?? [],
      } satisfies UsuarioActual;
      return true;
    } catch {
      throw ApiError.noAutenticado('Sesión inválida o expirada');
    }
  }
}

/** Guard de roles RBAC (spec 7.2). Se usa junto a JwtAuthGuard. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Rol[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!roles?.length) return true;

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const userRoles = request.user?.roles ?? [];
    const ok = roles.some((r) => userRoles.includes(r));
    if (!ok) throw ApiError.sinPermiso(roles.join(' o '));
    return true;
  }
}

export { UnauthorizedException };
