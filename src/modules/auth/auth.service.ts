import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { IsNull, Repository } from 'typeorm';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { AppConfig } from '../../config/configuration';
import { Usuario, Sesion, UsuarioRecoveryCode } from '../../database/entities';
import { ApiError } from '../../common/errors';
import { hashPassword, sha256Hex, verificarPassword } from '../../common/crypto.util';
import { descifrarONull } from '../../common/datos-sensibles';
import { verificarTotp } from '../../common/totp.util';
import { Rol } from '../../common/decorators/roles.decorator';
import { LoginDto } from './auth.dto';

const MAX_INTENTOS = 5;
const VENTANA_BLOQUEO_MS = 15 * 60 * 1000;

/**
 * Ventana de gracia tras una rotación de refresh token (ms).
 *
 * Los refrescos concurrentes (ráfaga de 401, dos pestañas, dos proveedores de
 * sesión montados a la vez) compiten con el mismo cookie: el ganador rota el
 * token y el perdedor llega con uno ya revocado. Dentro de esta ventana eso se
 * trata como carrera benigna; fuera de ella es reutilización → robo → se
 * revoca la familia entera (spec 6.1).
 */
const GRACE_ROTACION_MS = Number(process.env.REFRESH_REUSE_GRACE_MS ?? 30_000);

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    @InjectRepository(Sesion) private readonly sesiones: Repository<Sesion>,
    @InjectRepository(UsuarioRecoveryCode) private readonly recoveryCodes: Repository<UsuarioRecoveryCode>,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async login(dto: LoginDto, ip?: string, userAgent?: string) {
    const correo = dto.correo.toLowerCase();
    const usuario = await this.usuarios.findOne({ where: { correo } });

    // Respuesta uniforme para no revelar si el correo existe (10.4).
    if (!usuario || !usuario.activo) {
      await this.registrarIntentoFallido(ip, correo);
      throw ApiError.noAutenticado('Credenciales inválidas');
    }
    if (usuario.bloqueado_hasta && usuario.bloqueado_hasta > new Date()) {
      throw ApiError.noAutenticado('Cuenta bloqueada temporalmente. Intenta más tarde.');
    }
    if (!verificarPassword(dto.password, usuario.password_hash)) {
      await this.registrarIntentoFallido(ip, correo, usuario);
      throw ApiError.noAutenticado('Credenciales inválidas');
    }

    usuario.intentos_fallidos = 0;
    usuario.bloqueado_hasta = null;
    usuario.ultimo_login_en = new Date();
    await this.usuarios.save(usuario);

    return this.emitirSesiones(usuario, ip, userAgent);
  }

  async refresh(refreshToken: string | undefined, ip?: string, userAgent?: string) {
    if (!refreshToken) throw ApiError.noAutenticado();
    const hash = sha256Hex(refreshToken);
    const sesion = await this.sesiones.findOne({ where: { refresh_hash: hash } });

    if (!sesion) throw ApiError.noAutenticado('Sesión inválida');

    if (sesion.revocada_en) {
      // El token ya fue usado y rotado. Fuera de la ventana de gracia es
      // reutilización → revocar toda la familia (spec 6.1). Dentro, es la
      // carrera benigna de refreshes concurrentes: se devuelve un access token
      // sin rotar otra vez (el cookie del navegador ya apunta al hijo vivo).
      const viva = await this.descendienteVivoEnGracia(sesion);
      if (viva) {
        const usuario = await this.usuarios.findOne({ where: { id: viva.usuario_id } });
        if (usuario?.activo) {
          return { access_token: await this.firmarAccess(usuario) };
        }
      }
      await this.revocarFamilia(sesion.familia_id);
      throw ApiError.noAutenticado('Sesión inválida');
    }
    if (sesion.expira_en < new Date()) {
      sesion.revocada_en = new Date();
      await this.sesiones.save(sesion);
      throw ApiError.noAutenticado('Sesión expirada');
    }

    const usuario = await this.usuarios.findOne({ where: { id: sesion.usuario_id } });
    if (!usuario?.activo) throw ApiError.noAutenticado();

    // Rotación: el refresh viejo queda revocado y se emite uno nuevo en la familia.
    const nueva = await this.crearSesion(usuario.id, sesion.familia_id, ip, userAgent);
    sesion.revocada_en = new Date();
    sesion.reemplazada_por = nueva.id;
    await this.sesiones.save(sesion);

    const access = await this.firmarAccess(usuario);
    return { access_token: access, refresh_token: nueva.token };
  }

  async logout(refreshToken: string | undefined) {
    if (!refreshToken) return { ok: true };
    const sesion = await this.sesiones.findOne({
      where: { refresh_hash: sha256Hex(refreshToken) },
    });
    if (sesion && !sesion.revocada_en) {
      sesion.revocada_en = new Date();
      await this.sesiones.save(sesion);
    }
    return { ok: true };
  }

  async yo(usuarioId: string) {
    const usuario = await this.usuarios.findOne({ where: { id: usuarioId } });
    if (!usuario) throw ApiError.noAutenticado();
    const { password_hash, totp_secret_enc, ...resto } = usuario;
    return resto;
  }

  // ── internos ──────────────────────────────────────────────────────────

  /**
   * Descendiente aún vivo si la reutilización del refresh ocurre dentro de la
   * ventana de gracia tras su rotación: carrera benigna de refreshes
   * concurrentes, no un robo (spec 6.1). Camina la cadena de rotaciones
   * (hijo, nieto, …) hasta el eslabón vivo; `null` si no lo hay o la ventana
   * ya venció (reutilización real del token).
   */
  private async descendienteVivoEnGracia(origen: Sesion): Promise<Sesion | null> {
    if (!origen.revocada_en || !origen.reemplazada_por) return null;
    const edad = Date.now() - origen.revocada_en.getTime();
    if (edad < 0 || edad > GRACE_ROTACION_MS) return null;
    let hija = await this.sesiones.findOne({ where: { id: origen.reemplazada_por } });
    for (let profundidad = 0; hija && profundidad < 8; profundidad++) {
      const viva = !hija.revocada_en && hija.expira_en > new Date();
      if (viva) return hija;
      if (!hija.reemplazada_por) return null;
      hija = await this.sesiones.findOne({ where: { id: hija.reemplazada_por } });
    }
    return null;
  }

  private async emitirSesiones(usuario: Usuario, ip?: string, userAgent?: string) {
    const familiaId = randomUUID();
    const sesion = await this.crearSesion(usuario.id, familiaId, ip, userAgent);
    const access = await this.firmarAccess(usuario);
    return {
      access_token: access,
      refresh_token: sesion.token,
      usuario: {
        id: usuario.id,
        nombre: usuario.nombre,
        correo: usuario.correo,
        roles: usuario.roles,
      },
    };
  }

  private async firmarAccess(usuario: Usuario) {
    return this.jwt.signAsync({
      sub: usuario.id,
      correo: usuario.correo,
      roles: usuario.roles,
    });
  }

  private async crearSesion(usuarioId: string, familiaId: string, ip?: string, userAgent?: string) {
    const refresh = randomBytes(48).toString('base64url');
    const ttlDias = this.config.get('jwtRefreshTtlDays', { infer: true });
    const sesion = this.sesiones.create({
      usuario_id: usuarioId,
      familia_id: familiaId,
      refresh_hash: sha256Hex(refresh),
      ip: ip ?? null,
      user_agent: userAgent?.slice(0, 500) ?? null,
      creada_en: new Date(),
      expira_en: new Date(Date.now() + ttlDias * 24 * 3600 * 1000),
    });
    const guardada = await this.sesiones.save(sesion);
    return { ...guardada, token: refresh };
  }

  private async revocarFamilia(familiaId: string) {
    await this.sesiones.update(
      { familia_id: familiaId, revocada_en: IsNull() },
      { revocada_en: new Date() },
    );
  }

  private async registrarIntentoFallido(ip: string | undefined, correo: string, usuario?: Usuario) {
    if (usuario) {
      usuario.intentos_fallidos += 1;
      if (usuario.intentos_fallidos >= MAX_INTENTOS) {
        usuario.bloqueado_hasta = new Date(Date.now() + VENTANA_BLOQUEO_MS);
        usuario.intentos_fallidos = 0;
      }
      await this.usuarios.save(usuario);
    }
    // En producción: rate limit distribuido por IP+cuenta en Redis (spec 10.9).
    void ip;
    void correo;
    void createHash; // placeholder para futura ventana por IP
  }
}
