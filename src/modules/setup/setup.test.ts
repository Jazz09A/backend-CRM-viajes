import assert from 'node:assert/strict';
import { describe, it, before, after, beforeEach } from 'node:test';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  AuditLog,
  Configuracion,
  Sesion,
  Usuario,
  UsuarioRecoveryCode,
} from '../../database/entities';
import { AppConfig } from '../../config/configuration';
import { verificarPassword } from '../../common/crypto.util';
import { AuthService } from '../auth/auth.service';
import { AuditoriaService } from '../auditoria/auditoria.service';
import { SetupService } from './setup.service';

/**
 * Onboarding del primer arranque.
 *
 * Lo que se verifica es la regla de negocio —"sólo la primera vez se crea un
 * administrador"— y no el detalle de la implementación: si el servicio
 * dejara de reclamar `setup_completado` de forma atómica, estas pruebas
 * fallarían.
 */
describe('SetupService (onboarding)', () => {
  let ds: DataSource;
  let service: SetupService;

  const configStub = {
    get: (clave: string) => (clave === 'jwtRefreshTtlDays' ? 30 : undefined),
  } as unknown as ConfigService<AppConfig, true>;
  const jwtStub = {
    signAsync: async () => 'access-token-falso',
  } as unknown as JwtService;

  const dto = {
    nombre: 'Ana Pérez',
    correo: 'Ana@Agencia.com',
    password: 'una-clave-larga-123',
    agencia: {
      nombre: 'Mi Agencia de Viajes',
      email: 'hola@miagencia.com',
      whatsapp: '+584121234567',
      direccion: 'Caracas',
      zona_horaria: 'America/Caracas',
    },
  };

  before(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [Usuario, Sesion, UsuarioRecoveryCode, Configuracion, AuditLog],
      synchronize: true,
    });
    await ds.initialize();
  });

  after(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.getRepository(Usuario).clear();
    await ds.getRepository(Sesion).clear();
    await ds.getRepository(Configuracion).clear();
    await ds.getRepository(AuditLog).clear();

    const auth = new AuthService(
      ds.getRepository(Usuario),
      ds.getRepository(Sesion),
      ds.getRepository(UsuarioRecoveryCode),
      jwtStub,
      configStub,
    );
    const auditoria = new AuditoriaService(ds.getRepository(AuditLog));
    service = new SetupService(
      ds,
      ds.getRepository(Usuario),
      ds.getRepository(Configuracion),
      auth,
      auditoria,
    );
  });

  it('indica que hace falta onboarding mientras no haya administrador', async () => {
    const estado = await service.estado();
    assert.equal(estado.requiere_onboarding, true);
  });

  it('crea el primer administrador con su contraseña cifrada y deja sesión abierta', async () => {
    const res = await service.iniciar(dto);

    const usuarios = await ds.getRepository(Usuario).find();
    assert.equal(usuarios.length, 1);
    const admin = usuarios[0]!;
    assert.equal(admin.correo, 'ana@agencia.com');
    assert.deepEqual(admin.roles, ['superadmin']);
    assert.equal(admin.activo, true);
    // La contraseña no se guarda en claro: se verifica contra el hash.
    assert.notEqual(admin.password_hash, dto.password);
    assert.equal(verificarPassword(dto.password, admin.password_hash), true);
    assert.equal(verificarPassword('otra-clave', admin.password_hash), false);

    // Sesión emitida: el usuario entra al panel sin volver a autenticarse.
    assert.ok(res.access_token);
    assert.ok(res.refresh_token);
    assert.equal(res.usuario.correo, 'ana@agencia.com');
  });

  it('guarda los datos de la agencia para personalizar la instalación', async () => {
    await service.iniciar(dto);

    const config = ds.getRepository(Configuracion);
    assert.equal((await config.findOneBy({ clave: 'agencia_nombre' }))?.valor, 'Mi Agencia de Viajes');
    assert.equal((await config.findOneBy({ clave: 'agencia_email' }))?.valor, 'hola@miagencia.com');
    assert.equal((await config.findOneBy({ clave: 'whatsapp_agencia' }))?.valor, '+584121234567');
    assert.equal((await config.findOneBy({ clave: 'zona_horaria' }))?.valor, 'America/Caracas');
  });

  it('deja de pedir onboarding una vez creado el administrador', async () => {
    await service.iniciar(dto);
    const estado = await service.estado();
    assert.equal(estado.requiere_onboarding, false);
  });

  it('rechaza un segundo alta con 409 y no crea otro usuario', async () => {
    await service.iniciar(dto);

    await assert.rejects(
      () => service.iniciar({ ...dto, correo: 'otro@agencia.com' }),
      (error: { codigo?: string; status?: number }) => {
        assert.equal(error.codigo, 'SETUP_YA_COMPLETADO');
        assert.equal(error.status, 409);
        return true;
      },
    );

    assert.equal(await ds.getRepository(Usuario).count(), 1);
  });

  it('rechaza el alta si otra instalación ya reclamó el arranque', async () => {
    // Simula la carrera: otra petición insertó la marca antes que la nuestra.
    // `insert()` no dispara el hook `@BeforeInsert`, así que el id va explícito
    // (igual que hace el servicio).
    await ds.getRepository(Configuracion).insert({
      id: uuidv7(),
      clave: 'setup_completado',
      valor: true,
      actualizado_en: new Date(),
    });

    await assert.rejects(
      () => service.iniciar(dto),
      (error: { codigo?: string }) => {
        assert.equal(error.codigo, 'SETUP_YA_COMPLETADO');
        return true;
      },
    );
    assert.equal(await ds.getRepository(Usuario).count(), 0);
  });

  it('no deja el arranque a medias si el alta falla', async () => {
    // Correo duplicado: la transacción se revierte y no queda la marca.
    await ds.getRepository(Usuario).save(
      ds.getRepository(Usuario).create({
        nombre: 'Otro',
        correo: 'ana@agencia.com',
        password_hash: 'x',
        roles: ['operador'],
        activo: true,
      }),
    );

    await assert.rejects(() => service.iniciar(dto));
    assert.equal(await ds.getRepository(Configuracion).findOneBy({ clave: 'setup_completado' }), null);
  });
});
