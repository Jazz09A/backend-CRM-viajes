import { ConfigService } from '@nestjs/config';
import { FastifyReply } from 'fastify';
import { AppConfig } from '../config/configuration';

/** Vigencia de la cookie de refresh: 30 días (mismo TTL que `Sesion`). */
export const MAX_AGE_REFRESH_SEGUNDOS = 30 * 24 * 3600;

/**
 * Escribe (o borra) la cookie HttpOnly con el refresh token.
 *
 * `COOKIE_SAMESITE=none` para frontend y API en dominios distintos
 * (Vercel ↔ Koyeb): el navegador rechaza cookies cross-site con Lax/Strict
 * y exige Secure junto a None.
 */
export function escribirCookieRefresh(
  reply: FastifyReply,
  token: string | undefined,
  maxAgeSegundos: number,
  config: ConfigService<AppConfig, true>,
): void {
  const samesite = config.get('cookieSameSite', { infer: true });
  const etiqueta = samesite === 'none' ? 'None' : samesite === 'strict' ? 'Strict' : 'Lax';
  const secure =
    samesite === 'none' || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  if (!token) {
    reply.header(
      'set-cookie',
      `refresh_token=; Path=/api/v1/auth; HttpOnly; SameSite=${etiqueta}; Max-Age=0${secure}`,
    );
    return;
  }
  reply.header(
    'set-cookie',
    `refresh_token=${encodeURIComponent(token)}; Path=/api/v1/auth; HttpOnly; SameSite=${etiqueta}; Max-Age=${maxAgeSegundos}${secure}`,
  );
}
