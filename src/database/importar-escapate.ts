/**
 * Importador del catálogo de **Escapate Tours**.
 *
 * Lee `data/catalogo-escapate.json` (fuente de verdad transcrita del chat de
 * WhatsApp) y lo carga en la base de datos: políticas de cancelación,
 * términos, catálogo global de puntos de salida, tours con sus puntos de
 * abordaje y formulario publicado, y las fechas con sus tarifas.
 *
 * Es **idempotente**: se puede reejecutar sin duplicar nada.
 *   - Tour      → por `nombre`
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
import { createHash } from 'crypto';
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
import {
  Configuracion,
  FechaTour,
  PlantillaTerminos,
  PlantillaTerminosVersion,
  PuntoSalida,
  PoliticaCancelacion,
  Tarifa,
  Tour,
  TourFormVersion,
  TourPuntoAbordaje,
  Usuario,
} from './entities';

// ---------------------------------------------------------------------------
// Tipos del catálogo
// ---------------------------------------------------------------------------

type TipoTour = 'full_day' | 'fin_de_semana' | 'multi_dia';

interface CatalogoPunto {
  clave: string;
  ciudad: string;
  nombre: string;
  referencia: string;
  /**
   * `false` = sólo referencia en el formulario (no lo elige el cliente).
   * Los puntos de Caracas se confirman después por el grupo de viaje /
   * WhatsApp, por lo que viajan con `seleccionable: false`.
   */
  seleccionable?: boolean;
}

interface CatalogoTour {
  clave: string;
  nombre: string;
  tipo: TipoTour;
  familia: string;
  politica: string;
  hora_salida: string;
  reserva_usd: number;
  cupos: number;
  descripcion: string;
  incluye: string[];
  no_incluye: string[];
  itinerario: { titulo: string; detalle: string }[];
  puntos: { clave: string; hora: string }[];
  precios: { adulto: number; nino: number; tercera_edad: number; infante: number };
  fechas: string[];
  notas: string[];
}

interface Catalogo {
  version: number;
  origen: string;
  reglas: string[];
  anomalias?: { tema: string; detalle: string; impacto?: string }[];
  politicas: {
    clave: string;
    nombre: string;
    tramos: { dias_min: number; dias_max: number | null; reembolso_pct: number }[];
  }[];
  terminos: { nombre: string; contenido: string };
  puntos_salida: CatalogoPunto[];
  tours: CatalogoTour[];
}

/** Tours de la semilla demo: se pueden archivar para no ensuciar las pruebas. */
const TOURS_DEMO = ['Full Day Los Roques', 'Fin de Semana Mérida', 'Colonia Tovar', 'La Costa'];

const CATEGORIAS = ['adulto', 'nino', 'tercera_edad', 'infante'] as const;
const RANGOS: Record<(typeof CATEGORIAS)[number], { min: number; max: number }> = {
  adulto: { min: 18, max: 120 },
  nino: { min: 5, max: 11 },
  tercera_edad: { min: 61, max: 120 },
  // Política de la agencia: hasta 4 años viaja gratis, en piernas de su
  // representante (sin cupo y sin costo).
  infante: { min: 0, max: 4 },
};

// ---------------------------------------------------------------------------
// Utilidades
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

function cargarCatalogo(ruta?: string): Catalogo {
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
    return JSON.parse(crudo) as Catalogo;
  } catch (e) {
    throw new Error(`El catálogo no es JSON válido: ${(e as Error).message}`);
  }
}

/** Validación estructural: si algo falla, no se escribe nada. */
function validarCatalogo(catalogo: Catalogo): void {
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
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(tour.hora_salida ?? '')) {
      errores.push(`${ref}: hora_salida inválida (${tour.hora_salida}).`);
    }
    if (!clavesPolitica.has(tour.politica)) {
      errores.push(`${ref}: política desconocida (${tour.politica}).`);
    }
    if (claves.has(tour.nombre)) errores.push(`${ref}: nombre de tour duplicado.`);
    claves.add(tour.nombre);
    if (!Number.isFinite(tour.cupos) || tour.cupos < 1) {
      errores.push(`${ref}: cupos inválidos (${tour.cupos}).`);
    }
    for (const categoria of CATEGORIAS) {
      const precio = tour.precios?.[categoria];
      if (!Number.isFinite(precio) || precio < 0) {
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
// Reporte
// ---------------------------------------------------------------------------

interface Reporte {
  politicas: string[];
  terminos: string[];
  puntos: string[];
  tours: string[];
  formularios: string[];
  fechas: string[];
  tarifas: number;
  archivados: string[];
  avisos: string[];
}

function reporteVacio(): Reporte {
  return {
    politicas: [],
    terminos: [],
    puntos: [],
    tours: [],
    formularios: [],
    fechas: [],
    tarifas: 0,
    archivados: [],
    avisos: [],
  };
}

// ---------------------------------------------------------------------------
// Importación
// ---------------------------------------------------------------------------

/** Definición de formulario por tour: punto de abordaje, comida y avisos. */
function definicionFormulario(tour: CatalogoTour, puntos: CatalogoPunto[]) {
  const campos: Record<string, unknown>[] = [];

  campos.push({
    id: 'punto_abordaje',
    label: 'Punto de salida',
    ayuda:
      'Elige dónde subes al bus. El punto de retorno es el mismo. En Caracas el punto no se elige aquí: se confirma en el grupo de viaje por WhatsApp. Cada pasajero puede salir de un punto distinto.',
    tipo: 'select',
    alcance: 'por_reserva',
    // Salidas personalizadas: el titular puede fijar un punto para todos
    // o responder por pasajero (los grupos salen de distintos lugares).
    permite_por_pasajero: true,
    obligatorio: true,
    fuente: 'puntos_salida',
    // Sólo los puntos `seleccionable` entran al selector; el resto los
    // agrega el servidor en `puntos_referencia` (bloque informativo).
    opciones: puntos.filter((p) => p.seleccionable !== false).map((p) => ({ valor: p.clave, label: p.nombre })),
  });

  const tieneComidas = tour.incluye.some((i) => /almuerzo|desayuno|merienda|cena/i.test(i));
  if (tieneComidas) {
    campos.push({
      id: 'almuerzo',
      label: 'Selección de almuerzo',
      ayuda: 'El menú se sirve al mediodía, en el destino.',
      tipo: 'select',
      alcance: 'por_pasajero',
      obligatorio: true,
      aplica_a: ['Adulto', 'Tercera Edad', 'Niño'],
      opciones: [
        { valor: 'pescado', label: 'Pescado frito' },
        { valor: 'pollo', label: 'Pollo frito' },
        { valor: 'vegetariano', label: 'Vegetariano' },
      ],
    });
  }

  campos.push({
    id: 'tiene_alergias',
    label: '¿Tiene alergias o condiciones médicas?',
    ayuda: 'Marca la casilla si hay alguna alergia, intolerancia o condición a considerar.',
    tipo: 'checkbox',
    alcance: 'por_pasajero',
    obligatorio: false,
  });
  campos.push({
    id: 'detalle_alergias',
    label: 'Describa cuáles',
    ayuda: 'Indique el alérgeno y la forma en que se presenta.',
    tipo: 'text',
    alcance: 'por_pasajero',
    obligatorio: true,
    visible_si: { campo: 'tiene_alergias', igual_a: true },
  });
  campos.push({
    id: 'comentarios',
    label: 'Comentarios',
    ayuda: 'Cualquier dato que debamos saber (movilidad, acompañante, equipaje especial).',
    tipo: 'textarea',
    alcance: 'por_reserva',
    obligatorio: false,
    max_length: 1000,
  });

  return { campos };
}

async function procesar(ds: DataSource, catalogo: Catalogo, opciones: Opciones): Promise<Reporte> {
  const reporte = reporteVacio();
  const escribir = !opciones.dryRun;

  const ejecutar = async (fn: (em: EntityManager) => Promise<void>) => {
    if (!escribir) {
      await fn(ds.manager);
      return;
    }
    await ds.transaction(async (em) => {
      await fn(em);
    });
  };

  await ejecutar(async (em) => {
    // ── políticas de cancelación ─────────────────────────────────────────
    const repoPoliticas = em.getRepository(PoliticaCancelacion);
    const mapaPoliticas = new Map<string, string>();
    for (const p of catalogo.politicas) {
      let pol = await repoPoliticas.findOne({ where: { nombre: p.nombre } });
      if (!pol) {
        pol = repoPoliticas.create({ nombre: p.nombre, tramos: p.tramos });
        if (escribir) pol = await repoPoliticas.save(pol);
        reporte.politicas.push(`${p.nombre} (creada)`);
      } else {
        reporte.politicas.push(`${p.nombre} (ya existía)`);
      }
      mapaPoliticas.set(p.clave, pol.id ?? `__nuevo_${p.clave}`);
    }

    // ── términos y condiciones ────────────────────────────────────────────
    const repoPlantillas = em.getRepository(PlantillaTerminos);
    const repoVersiones = em.getRepository(PlantillaTerminosVersion);
    let plantilla = await repoPlantillas.findOne({ where: { nombre: catalogo.terminos.nombre } });
    if (!plantilla) {
      plantilla = repoPlantillas.create({ nombre: catalogo.terminos.nombre });
      if (escribir) plantilla = await repoPlantillas.save(plantilla);
      reporte.terminos.push(`${catalogo.terminos.nombre} (creada)`);
    } else {
      reporte.terminos.push(`${catalogo.terminos.nombre} (ya existía)`);
    }
    const publicada = await repoVersiones.findOne({
      where: { plantilla_id: plantilla.id, estado: 'publicada' },
    });
    if (!publicada) {
      // El dominio elige los términos vigentes por `version DESC` (no por
      // fecha), así que la versión nueva debe ir por encima de cualquier
      // otra plantilla publicada para que sea la que ve el cliente.
      const maxVersion = Math.max(0, ...(await repoVersiones.find()).map((v) => v.version));
      const hash = createHash('sha256').update(catalogo.terminos.contenido).digest('hex');
      const version = repoVersiones.create({
        plantilla_id: plantilla.id,
        version: maxVersion + 1,
        contenido: catalogo.terminos.contenido,
        hash_sha256: hash,
        estado: 'publicada',
        publicada_en: new Date(),
      });
      if (escribir) await repoVersiones.save(version);
      reporte.terminos.push(`versión ${maxVersion + 1} publicada (queda vigente)`);
    } else {
      const maxVersion = Math.max(0, ...(await repoVersiones.find()).map((v) => v.version));
      if (publicada.version < maxVersion) {
        // Otra plantilla tiene una versión mayor: se sube la nuestra para que
        // los términos del catálogo sean los vigentes.
        publicada.version = maxVersion + 1;
        if (escribir) await repoVersiones.save(publicada);
        reporte.terminos.push(`versión elevada a ${maxVersion + 1} (queda vigente)`);
      } else {
        reporte.terminos.push('ya hay una versión publicada (se conserva)');
      }
    }
    const plantillaId = plantilla.id;

    // ── catálogo global de puntos de salida ──────────────────────────────
    const repoPuntos = em.getRepository(PuntoSalida);
    for (const [i, p] of catalogo.puntos_salida.entries()) {
      let punto = await repoPuntos.findOne({ where: { clave: p.clave } });
      const hora = await horaDeReferencia(catalogo, p.clave);
      if (!punto) {
        punto = repoPuntos.create({
          clave: p.clave,
          nombre: p.nombre,
          hora,
          referencia: p.referencia,
          ciudad: p.ciudad,
          seleccionable: p.seleccionable !== false,
          orden: i,
          activo: true,
        });
        if (escribir) await repoPuntos.save(punto);
        reporte.puntos.push(
          `${p.nombre} (creado, hora de referencia ${hora}${p.seleccionable === false ? ', sólo referencia' : ''})`,
        );
      } else {
        punto.nombre = p.nombre;
        punto.referencia = p.referencia;
        punto.ciudad = p.ciudad;
        punto.seleccionable = p.seleccionable !== false;
        punto.orden = i;
        punto.activo = true;
        if (escribir) await repoPuntos.save(punto);
        reporte.puntos.push(
          `${p.nombre} (actualizado${p.seleccionable === false ? ', sólo referencia' : ''})`,
        );
      }
    }

    // Los puntos que no están en el catálogo (p. ej. los genéricos de la
    // semilla demo) se desactivan: si no, el cliente vería duplicados.
    const clavesCatalogo = new Set(catalogo.puntos_salida.map((p) => p.clave));
    for (const punto of await repoPuntos.find({ where: { activo: true } })) {
      if (clavesCatalogo.has(punto.clave)) continue;
      punto.activo = false;
      if (escribir) await repoPuntos.save(punto);
      reporte.avisos.push(`Punto de salida desactivado (no está en el catálogo): ${punto.nombre}`);
    }

    // ── administrador que figura como autor ───────────────────────────────
    const admin = (await em.getRepository(Usuario).find()).find((u) =>
      (u.roles ?? []).includes('superadmin'),
    );
    const autorId = admin?.id ?? null;

    // ── tours ─────────────────────────────────────────────────────────────
    const repoTours = em.getRepository(Tour);
    const repoPuntosTour = em.getRepository(TourPuntoAbordaje);
    const repoFormularios = em.getRepository(TourFormVersion);
    const repoFechas = em.getRepository(FechaTour);
    const repoTarifas = em.getRepository(Tarifa);

    for (const tour of catalogo.tours) {
      const politicaId = mapaPoliticas.get(tour.politica) ?? null;
      let fila = await repoTours.findOne({ where: { nombre: tour.nombre } });
      const nuevo = !fila;
      if (!fila) {
        fila = repoTours.create({
          nombre: tour.nombre,
          tipo: tour.tipo,
          descripcion: tour.descripcion,
          itinerario: tour.itinerario,
          incluye: tour.incluye,
          no_incluye: tour.no_incluye,
          imagenes: [],
          politica_cancelacion_id: politicaId,
          plantilla_terminos_id: plantillaId,
          requiere_autorizacion_menores: true,
          documento_menores: 'requerido',
          max_pasajeros_reserva: 10,
          estado: 'borrador',
          creado_por: autorId,
        });
      } else {
        fila.tipo = tour.tipo;
        fila.descripcion = tour.descripcion;
        fila.itinerario = tour.itinerario;
        fila.incluye = tour.incluye;
        fila.no_incluye = tour.no_incluye;
        if (politicaId && !fila.politica_cancelacion_id) fila.politica_cancelacion_id = politicaId;
        if (!fila.plantilla_terminos_id) fila.plantilla_terminos_id = plantillaId;
      }
      if (escribir) fila = await repoTours.save(fila);
      // En simulación el tour nuevo no tiene id: se usa uno sintético (válido
      // para Postgres) que no coincide con ninguna fila real.
      const tourId = fila.id ?? uuidv7();
      reporte.tours.push(`${tour.nombre} (${nuevo ? 'creado' : 'actualizado'})`);

      // Puntos de abordaje del tour (vista por tour en el panel).
      if (escribir) await repoPuntosTour.delete({ tour_id: tourId });
      const catalogoPuntos = catalogo.puntos_salida.filter((p) =>
        tour.puntos.some((tp) => tp.clave === p.clave),
      );
      for (const [i, tp] of tour.puntos.entries()) {
        const ref = catalogoPuntos.find((p) => p.clave === tp.clave);
        const punto = repoPuntosTour.create({
          tour_id: tourId,
          clave: tp.clave,
          nombre: ref?.nombre ?? tp.clave,
          hora: tp.hora,
          referencia: ref?.referencia ?? null,
          orden: i,
          activo: true,
        });
        if (escribir) await repoPuntosTour.save(punto);
      }

      // Formulario publicado (imprescindible para activar el tour).
      const formPublicado = await repoFormularios.findOne({
        where: { tour_id: tourId, estado: 'publicada' },
      });
      if (!formPublicado) {
        const definicion = definicionFormulario(tour, catalogoPuntos);
        const version = repoFormularios.create({
          tour_id: tourId,
          version: 1,
          estado: 'publicada',
          definicion,
          hash: createHash('sha256').update(JSON.stringify(definicion)).digest('hex'),
          publicada_en: new Date(),
          publicada_por: autorId,
        });
        if (escribir) await repoFormularios.save(version);
        reporte.formularios.push(`${tour.nombre} (formulario v1 publicado)`);
      } else {
        // Si la definición del punto de salida cambió (salidas personalizadas
        // por pasajero, opciones de Caracas fuera del selector…), se publica
        // una versión nueva: el snapshot anterior queda archivado.
        const definicion = definicionFormulario(tour, catalogoPuntos);
        const camposActuales = ((formPublicado.definicion ?? {}) as { campos?: Record<string, unknown>[] }).campos ?? [];
        const campoActual = camposActuales.find((c) => c?.id === 'punto_abordaje');
        const campoNuevo = (definicion.campos as Record<string, unknown>[]).find((c) => c?.id === 'punto_abordaje');
        const proyectar = (c: Record<string, unknown> | undefined) =>
          JSON.stringify(
            c
              ? { label: c.label, ayuda: c.ayuda, permite_por_pasajero: c.permite_por_pasajero, opciones: c.opciones }
              : null,
          );
        if (proyectar(campoActual) !== proyectar(campoNuevo)) {
          const todas = await repoFormularios.find({ where: { tour_id: tourId } });
          const maxVersion = Math.max(0, ...todas.map((v) => v.version));
          formPublicado.estado = 'archivada';
          if (escribir) await repoFormularios.save(formPublicado);
          const version = repoFormularios.create({
            tour_id: tourId,
            version: maxVersion + 1,
            estado: 'publicada',
            definicion,
            hash: createHash('sha256').update(JSON.stringify(definicion)).digest('hex'),
            publicada_en: new Date(),
            publicada_por: autorId,
          });
          if (escribir) await repoFormularios.save(version);
          reporte.formularios.push(
            `${tour.nombre} (formulario v${maxVersion + 1} publicado: punto de salida actualizado)`,
          );
        } else {
          reporte.formularios.push(`${tour.nombre} (formulario ya publicado)`);
        }
      }

      // Activar el tour (exige política + formulario publicado).
      if (fila.estado === 'borrador') {
        fila.estado = 'activo';
        if (escribir) await repoTours.save(fila);
      }

      // Fechas + tarifas.
      for (const fecha of tour.fechas) {
        let f = await repoFechas.findOne({ where: { tour_id: tourId, fecha_salida: fecha } });
        const nueva = !f;
        if (!f) {
          f = repoFechas.create({
            tour_id: tourId,
            fecha_salida: fecha,
            hora_salida: tour.hora_salida,
            cupos_total: tour.cupos,
            sobrecupo_autorizado: 0,
            cupos_retenidos: 0,
            cupos_vendidos: 0,
            estado: 'borrador',
            corte_venta_horas: 12,
            version: 1,
          });
          if (escribir) f = await repoFechas.save(f);
        } else if (f.estado === 'borrador') {
          f.estado = 'publicada';
          f.version += 1;
          if (escribir) f = await repoFechas.save(f);
        }
        const fechaId = f.id ?? uuidv7();
        reporte.fechas.push(`${tour.nombre} · ${fecha} ${nueva ? '(creada)' : '(ya existía)'}`);

        for (const categoria of CATEGORIAS) {
          // Los menores de 5 años no pagan (viajan en piernas de su
          // representante): la tarifa infante se fuerza a 0.
          const precio = categoria === 'infante' ? '0.00' : tour.precios[categoria].toFixed(2);
          const existente = await repoTarifas.findOne({
            where: { fecha_tour_id: fechaId, categoria },
          });
          if (!existente) {
            const rango = RANGOS[categoria];
            const tarifa = repoTarifas.create({
              fecha_tour_id: fechaId,
              categoria,
              edad_min: rango.min,
              edad_max: rango.max,
              precio_usd: precio,
            });
            if (escribir) await repoTarifas.save(tarifa);
            reporte.tarifas += 1;
          } else if (opciones.actualizarPrecios && existente.precio_usd !== precio) {
            existente.precio_usd = precio;
            if (escribir) await repoTarifas.save(existente);
          }
        }

        // Publicar la fecha (reglas del dominio: tour activo + tarifas).
        if (f.estado === 'borrador') {
          f.estado = 'publicada';
          f.version += 1;
          if (escribir) await repoFechas.save(f);
        }
      }
    }

    // ── archedado de los tours demo (opcional) ───────────────────────────
    if (opciones.archivarDemo) {
      for (const nombre of TOURS_DEMO) {
        const demo = await repoTours.findOne({ where: { nombre } });
        if (demo && demo.estado !== 'archivado') {
          demo.estado = 'archivado';
          if (escribir) await repoTours.save(demo);
          reporte.archivados.push(nombre);
        }
      }
    }

    // ── la selección de comida debe poder mostrarse al cliente ───────────
    const repoConfig = em.getRepository(Configuracion);
    const flag = await repoConfig.findOne({ where: { clave: 'comidas_deshabilitadas' } });
    if (!flag) {
      const nuevo = repoConfig.create({
        clave: 'comidas_deshabilitadas',
        valor: false,
        actualizado_en: new Date(),
      });
      if (escribir) await repoConfig.save(nuevo);
      reporte.avisos.push('Se habilitó la selección de comida en el formulario público (comidas_deshabilitadas=false).');
    } else if (flag.valor !== false) {
      flag.valor = false;
      flag.actualizado_en = new Date();
      if (escribir) await repoConfig.save(flag);
      reporte.avisos.push('Se habilitó la selección de comida en el formulario público (comidas_deshabilitadas=false).');
    }
  });

  return reporte;
}

/**
 * Hora de referencia de un punto en el catálogo global: la más usada por los
 * tours (el sistema guarda una sola hora por punto; la hora exacta de cada
 * tour queda en sus puntos de abordaje y en el itinerario).
 */
async function horaDeReferencia(catalogo: Catalogo, clave: string): Promise<string> {
  const conteo = new Map<string, number>();
  for (const tour of catalogo.tours) {
    for (const p of tour.puntos) {
      if (p.clave !== clave) continue;
      conteo.set(p.hora, (conteo.get(p.hora) ?? 0) + 1);
    }
  }
  let mejor = '';
  let max = -1;
  for (const [hora, n] of conteo) {
    if (n > max) {
      mejor = hora;
      max = n;
    }
  }
  return mejor || '00:00';
}

// ---------------------------------------------------------------------------
// Informe
// ---------------------------------------------------------------------------

function imprimirInforme(catalogo: Catalogo, reporte: Reporte, opciones: Opciones) {
  const titulo = opciones.dryRun ? 'SIMULACIÓN (no se escribió nada)' : 'IMPORTACIÓN';
  // eslint-disable-next-line no-console
  console.log(`\n=== Escapate Tours · ${titulo} ===`);
  // eslint-disable-next-line no-console
  console.log(`Origen: ${catalogo.origen}\n`);

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
  console.log(`\nFechas: ${reporte.fechas.length}`);
  for (const f of reporte.fechas.slice(0, 12)) console.log(`  · ${f}`);
  if (reporte.fechas.length > 12) {
    // eslint-disable-next-line no-console
    console.log(`  · … y ${reporte.fechas.length - 12} más`);
  }
  // eslint-disable-next-line no-console
  console.log(`\nTarifas creadas: ${reporte.tarifas}`);

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
    `\nTotal: ${reporte.tours.length} tours · ${reporte.fechas.length} fechas · ${reporte.tarifas} tarifas nuevas\n`,
  );
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
