import { DataSource } from 'typeorm';
import { existsSync, readFileSync } from 'fs';
import { loadConfig } from '../config/configuration';

// El script corre fuera de Nest: cargar .env para que las claves de
// cifrado (DATA_ENCRYPTION_KEY, etc.) coincidan con las del servidor.
if (existsSync('.env')) {
  for (const linea of readFileSync('.env', 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !linea.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}
import { crearDataSource } from './data-source';
import { TODAS_ENTIDADES } from './entities';
import { Usuario } from './entities/auth.entities';
import { Configuracion } from './entities/config.entities';
import { hashPassword, sha256Hex } from '../common/crypto.util';
import { ejecutarSeedDemo } from './seed-demo';

/** Claves de configuración con valor por defecto (spec 5.4). */
export const CONFIG_POR_DEFECTO: Record<string, unknown> = {
  zona_horaria: 'America/Caracas',
  enlace_vigencia_h: 72,
  inactividad_registro_h: 72,
  hold_horas: 24,
  abono_minimo_pct: 50,
  max_pasajeros_reserva: 10,
  corte_venta_horas_default: 12,
  tolerancia_monto_pct: 1.0,
  segregacion_funciones: true,
  retencion_dias_post_salida: 180,
  recordatorio_horas_antes: 48,
  alerta_cupo_pct: [80, 100],
  whatsapp_agencia: null,
  agencia_nombre: 'Ruta Clara Viajes',
  agencia_email: 'hola@rutaclara.ve',
  agencia_direccion: 'Caracas, Venezuela',
  permite_sobreventa: false,
  Requires_autorizacion_menores: true,
  documento_menores: 'opcional',
  minutos_inactividad: 30,
  tour_activo_default: '',
  firma_empresa_archivo_id: null,
  aviso_privacidad: { texto: '', version: '1.0' },
  captcha_activo: true,
};

export async function ejecutarSeed(ds: DataSource): Promise<void> {
  const repoConfig = ds.getRepository(Configuracion);
  const repoUsuario = ds.getRepository(Usuario);

  for (const [clave, valor] of Object.entries(CONFIG_POR_DEFECTO)) {
    const existe = await repoConfig.findOne({ where: { clave } });
    if (!existe) {
      await repoConfig.save(repoConfig.create({ clave, valor, actualizado_en: new Date() }));
    }
  }

  const adminCorreo = (process.env.SEED_ADMIN_CORREO ?? 'admin@agencia.local').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'admin123';
  const admin = await repoUsuario.findOne({ where: { correo: adminCorreo } });
  if (!admin) {
    await repoUsuario.save(
      repoUsuario.create({
        nombre: 'Super Administrador',
        correo: adminCorreo,
        password_hash: hashPassword(adminPassword),
        roles: ['superadmin', 'operador', 'validador'],
        activo: true,
      }),
    );
    // eslint-disable-next-line no-console
    console.log(`Usuario admin creado: ${adminCorreo} / ${adminPassword} (cambiar en producción)`);
  }
}

/** Permite correr `npm run seed` de forma independiente. */
async function main() {
  const config = loadConfig();
  const ds = crearDataSource(config);
  await ds.initialize();
  if (config.dbDriver === 'sqlite') await ds.synchronize();
  await ejecutarSeed(ds);
  if (config.nodeEnv !== 'production' && process.env.SEED_DEMO !== 'false') {
    await ejecutarSeedDemo(ds);
  }
  await ds.destroy();
  // eslint-disable-next-line no-console
  console.log('Seed completado');
}

if (require.main === module) {
  void main();
}

export { TODAS_ENTIDADES, sha256Hex };
