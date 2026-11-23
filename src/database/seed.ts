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
import { TODAS_ENTIDADES, PuntoSalida } from './entities';
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
  /**
   * Selección de comida en los formularios. `true` la oculta en el formulario
   * público (sin borrar los campos); se reactiva con un cambio de este flag.
   */
  comidas_deshabilitadas: true,
  /**
   * Reporte de pago desde el formulario del cliente. `false` oculta el paso
   * de pago del cliente: la agencia anota los datos del pago desde la reserva.
   * No se borra el flujo: basta volver a `true` para reactivarlo.
   */
  reporte_pago_cliente: false,
};

/** Puntos de salida globales con los que arranca toda instalación. */
export const PUNTOS_SALIDA_INICIALES = [
  { clave: 'guatire', nombre: 'Guatire', ciudad: 'Guatire', hora: '06:00', referencia: 'Punto de encuentro en el centro de Guatire.', seleccionable: true, orden: 0 },
  { clave: 'guarenas', nombre: 'Guarenas', ciudad: 'Guarenas', hora: '06:30', referencia: 'Punto de encuentro en el centro de Guarenas.', seleccionable: true, orden: 1 },
  // En Caracas el punto no lo elige el cliente: se confirma por WhatsApp.
  { clave: 'caracas', nombre: 'Caracas', ciudad: 'Caracas', hora: '07:00', referencia: 'Punto de encuentro en Caracas.', seleccionable: false, orden: 2 },
];

export async function ejecutarSeed(ds: DataSource): Promise<void> {
  const repoConfig = ds.getRepository(Configuracion);
  const repoUsuario = ds.getRepository(Usuario);
  const repoPuntos = ds.getRepository(PuntoSalida);

  for (const [clave, valor] of Object.entries(CONFIG_POR_DEFECTO)) {
    const existe = await repoConfig.findOne({ where: { clave } });
    if (!existe) {
      await repoConfig.save(repoConfig.create({ clave, valor, actualizado_en: new Date() }));
    }
  }

  // Puntos de salida globales: se crean si no existen; nunca se pisan los
  // que la agencia ya creó o editó desde el panel.
  for (const punto of PUNTOS_SALIDA_INICIALES) {
    const existe = await repoPuntos.findOne({ where: { clave: punto.clave } });
    if (!existe) {
      await repoPuntos.save(repoPuntos.create({ ...punto, activo: true }));
    }
  }

  // El administrador NO se crea por defecto: la primera vez se hace por el
  // onboarding (`POST /setup/iniciar`), que además personaliza la agencia.
  // Semilla explícita sólo para desarrollo/pruebas, y nunca en producción
  // (evita credenciales conocidas en una instalación real).
  const correoAdmin = process.env.SEED_ADMIN_CORREO?.toLowerCase();
  const passwordAdmin = process.env.SEED_ADMIN_PASSWORD;
  if (process.env.NODE_ENV !== 'production' && correoAdmin && passwordAdmin) {
    const admin = await repoUsuario.findOne({ where: { correo: correoAdmin } });
    if (!admin) {
      await repoUsuario.save(
        repoUsuario.create({
          nombre: 'Super Administrador',
          correo: correoAdmin,
          password_hash: hashPassword(passwordAdmin),
          roles: ['superadmin'],
          activo: true,
        }),
      );
      // eslint-disable-next-line no-console
      console.log(`Usuario admin creado: ${correoAdmin} (sólo desarrollo)`);
    }
  }
}

/** Permite correr `pnpm seed` de forma independiente. */
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
