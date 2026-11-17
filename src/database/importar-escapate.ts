/**
 * Importador del catálogo de **Escapate Tours**.
 *
 * Lee `catalogo-escapate.json` (fuente de verdad transcrita del chat de
 * WhatsApp) y lo carga en la base de datos.
 *
 * La lógica de mapeo **no vive aquí**: está en `modules/catalogo/documento.ts`,
 * que es la misma que usa el panel cuando se crea un tour. Así el importador
 * y el alta manual aplican exactamente las mismas reglas.
 *
 * Es **idempotente**: se puede reejecutar sin duplicar nada.
 *   - Tour      → por `clave` (y por `nombre` como respaldo)
 *   - Fecha     → por (`tour_id`, `fecha_salida`)
 *   - Tarifa    → por (`fecha_tour_id`, `categoria`)
 *
 * Uso:
 *   npm run importar:escapate -- --dry-run     # simula, no escribe
 *   npm run importar:escapate                  # importa
 *   npm run importar:escapate -- --archivar-demo
 *   npm run importar:escapate -- --archivar-demo --actualizar-precios
 */
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

// El script corre fuera de Nest: cargar .env para que las claves de
// cifrado coincidan con las del servidor.
if (existsSync('.env')) {
  for (const linea of readFileSync('.env', 'utf8').split('\n')) {
    const m = linea.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !linea.trim().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
    }
  }
}

import { loadConfig } from '../config/configuration';
import { crearDataSource } from './data-source';
import { Tour } from './entities';
import { aplicarCatalogo } from '../modules/catalogo/documento';
import type { DocumentoCatalogo } from '../modules/catalogo/documento';

/** Tours de la semilla demo: se pueden archivar para no ensuciar las pruebas. */
const TOURS_DEMO = ['Full Day Los Roques', 'Fin de Semana Mérida', 'Colonia Tovar', 'La Costa'];

// ---------------------------------------------------------------------------
// Opciones y carga del archivo
// ---------------------------------------------------------------------------

interface Opciones {
  dryRun: boolean;
  archivarDemo: boolean;
  actualizarPrecios: boolean;
  archivo?: string | undefined;
}

function parseArgs(argv: string[]): Opciones {
  const opciones: Opciones = {
    dryRun: false,
    archivarDemo: false,
    actualizarPrecios: false,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') opciones.dryRun = true;
    else if (arg === '--archivar-demo') opciones.archivarDemo = true;
    else if (arg === '--actualizar-precios') opciones.actualizarPrecios = true;
    else if (arg.startsWith('--file=')) opciones.archivo = arg.slice('--file='.length);
  }
  return opciones;
}

function cargarCatalogo(ruta?: string): DocumentoCatalogo {
  // El catálogo vive en la raíz del backend (versionado). Se acepta una ruta
  // explícita para cargar otro archivo.
  const candidatas = ruta
    ? [resolve(ruta)]
    : [resolve('catalogo-escapate.json'), resolve('data/catalogo-escapate.json')];
  const archivo = candidatas.find((c) => existsSync(c));
  if (!archivo) {
    throw new Error(
      `No existe el archivo de catálogo (busqué: ${candidatas.join(', ')}). ` +
        'Pásalo con --file=<ruta>.',
    );
  }
  const crudo = readFileSync(archivo, 'utf8');
  try {
    return JSON.parse(crudo) as DocumentoCatalogo;
  } catch (e) {
    throw new Error(`El catálogo no es JSON válido: ${(e as Error).message}`);
  }
}

/** Validación estructural: si algo falla, no se escribe nada. */
function validarCatalogo(catalogo: DocumentoCatalogo): void {
  const errores: string[] = [];
  if (!catalogo || typeof catalogo !== 'object') throw new Error('El catálogo está vacío.');
  if (!Array.isArray(catalogo.tours) || catalogo.tours.length === 0) {
    errores.push('El catálogo no tiene tours.');
  }
  if (!catalogo.politicas?.length) errores.push('El catálogo no tiene políticas de cancelación.');
  if (!catalogo.terminos?.contenido) errores.push('El catálogo no tiene términos y condiciones.');
  if (!catalogo.puntos_salida?.length) errores.push('El catálogo no tiene puntos de salida.');

  const claves = new Set<string>();
  const clavesPolitica = new Set((catalogo.politicas ?? []).map((p) => p.clave));
  const clavesPunto = new Set((catalogo.puntos_salida ?? []).map((p) => p.clave));

  for (const tour of catalogo.tours ?? []) {
    const ref = tour.clave || tour.nombre;
    if (!tour.nombre) errores.push(`${ref}: falta el nombre.`);
    if (!['full_day', 'fin_de_semana', 'multi_dia'].includes(tour.tipo)) {
      errores.push(`${ref}: tipo de tour inválido (${tour.tipo}).`);
    }
    if (tour.hora_salida && !/^([01]\d|2[0-3]):[0-5]\d$/.test(tour.hora_salida)) {
      errores.push(`${ref}: hora_salida inválida (${tour.hora_salida}).`);
    }
    if (tour.politica && !clavesPolitica.has(tour.politica)) {
      errores.push(`${ref}: política desconocida (${tour.politica}).`);
    }
    if (claves.has(tour.clave || tour.nombre)) errores.push(`${ref}: tour duplicado.`);
    claves.add(tour.clave || tour.nombre);
    if (!Number.isFinite(tour.cupos ?? NaN) || (tour.cupos ?? 0) < 1) {
      errores.push(`${ref}: cupos inválidos (${tour.cupos}).`);
    }
    for (const categoria of ['adulto', 'nino', 'tercera_edad', 'infante']) {
      const precio = tour.precios?.[categoria as 'adulto'];
      if (precio === undefined || !Number.isFinite(Number(precio)) || Number(precio) < 0) {
        errores.push(`${ref}: precio inválido para ${categoria} (${precio}).`);
      }
    }
    for (const punto of tour.puntos ?? []) {
      if (!clavesPunto.has(punto.clave)) {
        errores.push(`${ref}: punto de salida desconocido (${punto.clave}).`);
      }
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(punto.hora ?? '')) {
        errores.push(`${ref}: hora inválida en el punto ${punto.clave} (${punto.hora}).`);
      }
    }
    if (!tour.puntos?.length) errores.push(`${ref}: el tour no tiene puntos de abordaje.`);
    for (const fecha of tour.fechas ?? []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) {
        errores.push(`${ref}: fecha inválida (${fecha}).`);
      }
    }
  }

  if (errores.length) {
    throw new Error(`El catálogo tiene ${errores.length} problema(s):\n  - ${errores.join('\n  - ')}`);
  }
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

interface Reporte {
  politicas: string[];
  terminos: string[];
  puntos: string[];
  tours: string[];
  formularios: string[];
  fechas: number;
  tarifas: number;
  archivados: string[];
  avisos: string[];
}

function imprimirInforme(catalogo: DocumentoCatalogo, reporte: Reporte, opciones: Opciones) {
  const titulo = opciones.dryRun ? 'SIMULACIÓN (no se escribió nada)' : 'IMPORTACIÓN';
  // eslint-disable-next-line no-console
  console.log(`\n=== Escapate Tours · ${titulo} ===`);
  // eslint-disable-next-line no-console
  console.log(`Origen: ${catalogo.origen ?? '—'}\n`);

  // eslint-disable-next-line no-console
  console.log(`Políticas de cancelación: ${reporte.politicas.length}`);
  for (const p of reporte.politicas) console.log(`  · ${p}`);
  // eslint-disable-next-line no-console
  console.log(`\nTérminos: ${reporte.terminos.length}`);
  for (const t of reporte.terminos) console.log(`  · ${t}`);
  // eslint-disable-next-line no-console
  console.log(`\nPuntos de salida (catálogo global): ${reporte.puntos.length}`);
  for (const p of reporte.puntos) console.log(`  · ${p}`);
  // eslint-disable-next-line no-console
  console.log(`\nTours: ${reporte.tours.length}`);
  for (const t of reporte.tours) console.log(`  · ${t}`);
  // eslint-disable-next-line no-console
  console.log(`\nFormularios: ${reporte.formularios.length}`);
  for (const f of reporte.formularios) console.log(`  · ${f}`);
  // eslint-disable-next-line no-console
  console.log(`\nFechas nuevas: ${reporte.fechas}`);
  // eslint-disable-next-line no-console
  console.log(`Tarifas nuevas: ${reporte.tarifas}`);

  if (reporte.archivados.length) {
    // eslint-disable-next-line no-console
    console.log(`\nTours demo archivados: ${reporte.archivados.join(', ')}`);
  }
  if (reporte.avisos.length) {
    // eslint-disable-next-line no-console
    console.log('\nAvisos:');
    for (const a of reporte.avisos) console.log(`  · ${a}`);
  }

  if (catalogo.anomalias?.length) {
    // eslint-disable-next-line no-console
    console.log('\n=== Anomalías del chat que requieren revisión ===');
    for (const a of catalogo.anomalias) {
      // eslint-disable-next-line no-console
      console.log(`  · [${a.tema}] ${a.detalle}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `\nTotal: ${reporte.tours.length} tours · ${reporte.fechas} fechas · ${reporte.tarifas} tarifas nuevas\n`,
  );
}

// ---------------------------------------------------------------------------
// Proceso
// ---------------------------------------------------------------------------

async function procesar(ds: DataSource, catalogo: DocumentoCatalogo, opciones: Opciones): Promise<Reporte> {
  const escribir = !opciones.dryRun;

  const ejecutar = async <T>(fn: (em: EntityManager) => Promise<T>): Promise<T> => {
    if (!escribir) {
      return fn(ds.manager);
    }
    return ds.transaction(async (em) => fn(em));
  };

  const resultado = await ejecutar(async (em) => {
    const reporte = await aplicarCatalogo(em, catalogo, {
      actualizarPrecios: opciones.actualizarPrecios,
      publicarFechas: true,
      activar: true,
      crearFormulario: true,
    });

    // ── archivado de los tours demo (opcional) ───────────────────────────
    const archivados: string[] = [];
    if (opciones.archivarDemo) {
      const repoTours = em.getRepository(Tour);
      for (const nombre of TOURS_DEMO) {
        const demo = await repoTours.findOne({ where: { nombre } });
        if (demo && demo.estado !== 'archivado') {
          demo.estado = 'archivado';
          await repoTours.save(demo);
          archivados.push(nombre);
        }
      }
    }

    return { ...reporte, archivados };
  });

  return {
    politicas: resultado.politicas,
    terminos: resultado.terminos,
    puntos: resultado.puntos,
    tours: resultado.tours,
    formularios: resultado.formularios,
    fechas: resultado.fechas,
    tarifas: resultado.tarifas,
    archivados: resultado.archivados,
    avisos: resultado.avisos,
  };
}

async function main() {
  const opciones = parseArgs(process.argv.slice(2));
  const catalogo = cargarCatalogo(opciones.archivo);
  validarCatalogo(catalogo);

  const config = loadConfig();
  const ds = crearDataSource(config);
  await ds.initialize();
  if (config.dbDriver === 'sqlite') await ds.synchronize();

  try {
    const reporte = await procesar(ds, catalogo, opciones);
    imprimirInforme(catalogo, reporte, opciones);
  } finally {
    await ds.destroy();
  }
}

if (require.main === module) {
  void main().catch((e: Error) => {
    // eslint-disable-next-line no-console
    console.error(`\nError: ${e.message}\n`);
    process.exit(1);
  });
}

export { uuidv7 };
