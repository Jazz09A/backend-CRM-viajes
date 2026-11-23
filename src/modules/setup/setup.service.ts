import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { Configuracion, Usuario } from '../../database/entities';
import { ApiError } from '../../common/errors';
import { hashPassword } from '../../common/crypto.util';
import { AuthService } from '../auth/auth.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { IniciarSetupDto } from './setup.dto';

/**
 * Marca de "el primer arranque ya se completó".
 *
 * La clave es única en `configuracion`: insertarla reclama el arranque de
 * forma atómica. Dos peticiones concurrentes ⇒ una inserta y la otra recibe una
 * violación de unicidad → 409. Así el onboarding sólo ocurre una vez.
 */
const CLAVE_SETUP = 'setup_completado';

/** `true` si el error es una violación de unicidad (Postgres 23505 / SQLite). */
function esViolacionUnico(error: unknown): boolean {
  const codigo = (error as { code?: string } | null)?.code;
  if (codigo === '23505' || codigo === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  const mensaje = (error as { message?: string } | null)?.message ?? '';
  return /UNIQUE constraint failed|duplicate key value/i.test(mensaje);
}

@Injectable()
export class SetupService {
  constructor(
    private readonly ds: DataSource,
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    @InjectRepository(Configuracion) private readonly config: Repository<Configuracion>,
    private readonly auth: AuthService,
    private readonly auditoria: AuditoriaService,
  ) {}

  /**
   * ¿Hace falta el onboarding?
   *
   * `true` mientras no exista ningún administrador activo. Sólo un booleano:
   * no revela nada sobre los usuarios ni sus correos.
   */
  async estado() {
    return { requiere_onboarding: !(await this.haySuperadminActivo(this.usuarios)) };
  }

  /**
   * Crea el primer administrador y personaliza la agencia.
   *
   * Todo ocurre en una transacción: si algo falla, no queda ni el
   * administrador ni los datos de la agencia (tampoco la marca de setup).
   */
  async iniciar(dto: IniciarSetupDto, ip?: string, userAgent?: string) {
    const correo = dto.correo.trim().toLowerCase();
    const nombre = dto.nombre.trim();

    const usuario = await this.ds.transaction(async (em) => {
      const repoConfig = em.getRepository(Configuracion);
      const repoUsuario = em.getRepository(Usuario);

      // Reclamación atómica del primer arranque (índice único en `clave`).
      try {
        await repoConfig.insert({
          id: uuidv7(),
          clave: CLAVE_SETUP,
          valor: true,
          actualizado_en: new Date(),
        });
      } catch (error) {
        if (esViolacionUnico(error)) throw ApiError.setupYaCompletado();
        throw error;
      }

      // Defensa en profundidad: si ya hay un administrador activo, no se continúa.
      if (await this.haySuperadminActivo(repoUsuario)) {
        throw ApiError.setupYaCompletado();
      }

      if (await repoUsuario.findOne({ where: { correo } })) {
        throw ApiError.validacion('Ya existe un usuario con ese correo', [
          { campo: 'correo', codigo: 'DUPLICADO', mensaje: 'Correo ya registrado' },
        ]);
      }

      const nuevo = await repoUsuario.save(
        repoUsuario.create({
          nombre,
          correo,
          password_hash: hashPassword(dto.password),
          roles: ['superadmin'],
          activo: true,
        }),
      );

      const datosAgencia: Record<string, unknown> = {
        agencia_nombre: dto.agencia.nombre.trim(),
        agencia_email: dto.agencia.email?.trim() || null,
        agencia_direccion: dto.agencia.direccion?.trim() || null,
        whatsapp_agencia: dto.agencia.whatsapp?.trim() || null,
        zona_horaria: dto.agencia.zona_horaria?.trim() || null,
        agencia_configurada_en: new Date().toISOString(),
      };
      for (const [clave, valor] of Object.entries(datosAgencia)) {
        // Upsert por clave: el seed ya crea `agencia_*` en toda instalación,
        // así que un INSERT a ciegas chocaba con el índice único (500).
        const fila = await repoConfig.findOne({ where: { clave } });
        if (fila) {
          fila.valor = valor;
          fila.actualizado_en = new Date();
          await repoConfig.save(fila);
        } else {
          await repoConfig.save(repoConfig.create({ clave, valor, actualizado_en: new Date() }));
        }
      }

      return nuevo;
    });

    // Auditoría fuera de la transacción: si falla, el alta ya está firme y
    // sólo se pierde el asiento de auditoría (queda en el log).
    try {
      await this.auditoria.registrar({
        actorTipo: 'sistema',
        usuarioId: usuario.id,
        ip: ip ?? null,
        entidad: 'configuracion',
        entidadId: CLAVE_SETUP,
        accion: 'setup.completado',
        valorNuevo: { correo: usuario.correo, rol: 'superadmin' },
      });
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('Onboarding completado, pero no se pudo registrar la auditoría', error);
    }

    // Sesión iniciada de inmediato: el usuario entra al panel sin volver a
    // escribir sus credenciales.
    return this.auth.emitirSesiones(usuario, ip, userAgent);
  }

  /** ¿Existe algún usuario activo con rol `superadmin`? */
  private async haySuperadminActivo(repo: Repository<Usuario>): Promise<boolean> {
    const total = await repo
      .createQueryBuilder('u')
      .where('u.activo = :activo', { activo: true })
      .andWhere("u.roles LIKE :rol", { rol: '%"superadmin"%' })
      .getCount();
    return total > 0;
  }
}
