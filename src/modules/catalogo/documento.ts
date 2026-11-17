/**
 * El catálogo como contrato: el **documento de tour**.
 *
 * `catalogo-escapate.json` deja de ser un archivo suelto y pasa a ser la
 * forma con la que se habla de un tour:
 *
 *   UI  ──▶  documento  ──▶  base de datos  ──▶  documento
 *   CLI ──▶  documento  ──▶  base de datos
 *
 * El importador (`database/importar-escapate.ts`) y el panel (adminfx)
 * comparten estas funciones: las reglas de mapeo viven en un solo sitio.
 */
import { createHash } from 'crypto';
import { EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
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
  TourPrecio,
  TourPuntoAbordaje,
  Usuario,
} from '../../database/entities';
import type { CategoriaPasajero, TipoTour } from '../../database/entities';

// ---------------------------------------------------------------------------
// Tipos del documento
// ---------------------------------------------------------------------------

export interface DocumentoPunto {
  /** Clave del catálogo global de puntos (`punto_salida.clave`). */
  clave: string;
  /** Hora de recogida de este tour (HH:MM). */
  hora: string;
  /** `true` = la hora se confirma después (Caracas). */
  confirmar_hora?: boolean;
}

export interface DocumentoItinerario {
  /** Opcional: el catálogo transcribe la hora dentro del `detalle`. */
  hora?: string;
  titulo: string;
  detalle: string;
}

export interface DocumentoDuracion {
  dias?: number | null;
  noches?: number | null;
}

export interface DocumentoTour {
  clave: string;
  nombre: string;
  tipo: TipoTour;
  duracion?: DocumentoDuracion;
  familia?: string | null;
  /** Clave de la política de cancelación (Configuración). */
  politica?: string | null;
  /** Clave de la plantilla de términos (Configuración). */
  terminos?: string | null;
  hora_salida?: string | null;
  reserva_usd?: number | null;
  cupos?: number | null;
  descripcion?: string | null;
  puntos: DocumentoPunto[];
  precios: Partial<Record<CategoriaPasajero, number>>;
  fechas: string[];
  incluye: string[];
  no_incluye: string[];
  itinerario: DocumentoItinerario[];
  notas: string[];
}

export interface DocumentoCatalogo {
  version?: number;
  origen?: string;
  reglas?: string[];
  politicas?: { clave: string; nombre: string; tramos: unknown[] }[];
  terminos?: { clave?: string; nombre: string; contenido: string };
  puntos_salida?: {
    clave: string;
    ciudad?: string;
    nombre: string;
    referencia?: string;
    seleccionable?: boolean;
  }[];
  tours: DocumentoTour[];
  anomalias?: { tema: string; detalle: string; impacto?: string }[];
}

// ---------------------------------------------------------------------------
// Constantes y utilidades
// ---------------------------------------------------------------------------

export const CATEGORIAS: CategoriaPasajero[] = ['adulto', 'nino', 'tercera_edad', 'infante'];

export const RANGOS_EDAD: Record<CategoriaPasajero, { min: number; max: number }> = {
  adulto: { min: 18, max: 120 },
  nino: { min: 5, max: 11 },
  tercera_edad: { min: 61, max: 120 },
  // Los menores de 5 años viajan gratis, en piernas de su representante.
  infante: { min: 0, max: 4 },
};

/** Slug estable a partir de un texto (identidad del tour en el catálogo). */
export function slugify(texto: string): string {
  return String(texto ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

const esHora = (valor: unknown): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(String(valor ?? ''));

/** Normaliza un itinerario del catálogo a `{hora, titulo, detalle}`. */
export function normalizarItinerario(bruto: unknown): DocumentoItinerario[] {
  if (!Array.isArray(bruto)) return [];
  return bruto
    .map((bloque) => {
      const b = (bloque ?? {}) as Record<string, unknown>;
      const hora = esHora(b.hora) ? String(b.hora) : '';
      return {
        hora,
        titulo: String(b.titulo ?? '').trim(),
        detalle: String(b.detalle ?? '').trim(),
      };
    })
    .filter((b) => b.titulo !== '' || b.detalle !== '');
}

// ---------------------------------------------------------------------------
// Formulario base del tour
// ---------------------------------------------------------------------------

/**
 * Definición de formulario por tour: punto de abordaje, selección de
 * almuerzo (si el tour incluye comidas), alergias y comentarios.
 *
 * Sólo entran en el selector los puntos **seleccionables**: los de Caracas
 * son de referencia (el cliente elige «Caracas — punto por confirmar» y el
 * punto exacto se confirma por el grupo de viaje).
 */
export function formularioBase(opts: {
  incluye: string[];
  puntos: {
    clave: string;
    nombre: string;
    ciudad?: string | null;
    seleccionable?: boolean;
  }[];
}): { campos: Record<string, unknown>[] } {
  const campos: Record<string, unknown>[] = [];

  campos.push({
    id: 'punto_abordaje',
    label: 'Punto de salida',
    ayuda:
      'Elige dónde subes al bus. El punto de retorno es el mismo. En Caracas el punto no se elige aquí: se confirma en el grupo de viaje por WhatsApp. Cada pasajero puede salir de un punto distinto.',
    tipo: 'select',
    alcance: 'por_reserva',
    permite_por_pasajero: true,
    obligatorio: true,
    fuente: 'puntos_salida',
    opciones: opts.puntos
      .filter((p) => p.seleccionable !== false)
      .map((p) => ({ valor: p.clave, label: p.nombre })),
  });

  const tieneComidas = opts.incluye.some((i) => /almuerzo|desayuno|merienda|cena/i.test(i));
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

// ---------------------------------------------------------------------------
// Aplicación de un documento
// ---------------------------------------------------------------------------

export interface OpcionesAplicar {
  /** Sobrescribe los precios de las tarifas ya existentes. */
  actualizarPrecios?: boolean;
  /** Publica las fechas creadas (por defecto `true`). */
  publicarFechas?: boolean;
  /** Activa el tour cuando queda listo (por defecto `true`). */
  activar?: boolean;
  /** Crear el formulario base si el tour no tiene ninguno publicado. */
  crearFormulario?: boolean;
}

export interface ContextoAplicar {
  /** Usuario al que se atribuyen los cambios (autor de la importación). */
  autorId?: string | null;
  /** Política de cancelación por clave → id. */
  politicas?: Map<string, string>;
  /** Plantilla de términos por clave → id. */
  terminos?: Map<string, string>;
  /** Puntos de salida por clave (catálogo global). */
  puntos?: Map<string, PuntoSalida>;
}

const hashDefinicion = (definicion: unknown): string =>
  createHash('sha256').update(JSON.stringify(definicion)).digest('hex');

/**
 * Aplica un documento de tour: crea o actualiza el tour, sus puntos, su
 * matriz de precios, su formulario y sus salidas con sus tarifas.
 *
 * Es **idempotente**: se puede reejecutar sin duplicar nada.
 */
export async function aplicarDocumentoTour(
  em: EntityManager,
  doc: DocumentoTour,
  ctx: ContextoAplicar = {},
  opciones: OpcionesAplicar = {},
): Promise<{
  tourId: string;
  creado: boolean;
  fechasCreadas: number;
  tarifasCreadas: number;
  formularioPublicado: boolean;
}> {
  const repoTours = em.getRepository(Tour);
  const repoPuntosTour = em.getRepository(TourPuntoAbordaje);
  const repoFormularios = em.getRepository(TourFormVersion);
  const repoFechas = em.getRepository(FechaTour);
  const repoTarifas = em.getRepository(Tarifa);
  const repoPrecios = em.getRepository(TourPrecio);

  const clave = doc.clave?.trim() || slugify(doc.nombre);
  const politicaId = doc.politica ? ctx.politicas?.get(doc.politica) ?? null : null;
  const terminosId = doc.terminos ? ctx.terminos?.get(doc.terminos) ?? null : null;

  // ── tour ───────────────────────────────────────────────────────────────
  let fila = (await repoTours.findOne({ where: { clave } })) ?? null;
  if (!fila && doc.nombre) {
    fila = await repoTours.findOne({ where: { nombre: doc.nombre } });
  }
  const creado = !fila;

  const datos: Partial<Tour> = {
    clave,
    nombre: doc.nombre,
    tipo: doc.tipo ?? 'full_day',
    familia: doc.familia ?? null,
    duracion_dias: doc.duracion?.dias ?? null,
    duracion_noches: doc.duracion?.noches ?? null,
    hora_salida: esHora(doc.hora_salida) ? doc.hora_salida : null,
    cupos: doc.cupos ?? null,
    reserva_usd:
      doc.reserva_usd === null || doc.reserva_usd === undefined ? null : String(doc.reserva_usd),
    descripcion: doc.descripcion ?? null,
    itinerario: normalizarItinerario(doc.itinerario),
    incluye: doc.incluye ?? [],
    no_incluye: doc.no_incluye ?? [],
    notas: doc.notas ?? [],
    // La política y los términos se referencian por clave (Configuración).
    politica_cancelacion_id: politicaId,
    plantilla_terminos_id: terminosId,
  };

  if (!fila) {
    fila = repoTours.create({
      ...datos,
      estado: 'borrador',
      requiere_autorizacion_menores: true,
      documento_menores: 'requerido',
      max_pasajeros_reserva: 10,
      creado_por: ctx.autorId ?? null,
    } as Tour);
  } else {
    Object.assign(fila, datos);
    // La política y los términos no se pisan si ya están asociados.
    if (politicaId && !fila.politica_cancelacion_id) fila.politica_cancelacion_id = politicaId;
    if (terminosId && !fila.plantilla_terminos_id) fila.plantilla_terminos_id = terminosId;
  }
  fila = await repoTours.save(fila);
  const tourId = fila.id;

  // ── puntos de abordaje (hora de este tour) ─────────────────────────────
  // Los puntos son **siempre los mismos en los formularios** (catálogo
  // global): si el documento no define puntos propios, el tour hereda los
  // activos del catálogo con su hora de referencia (Caracas queda «por
  // confirmar», como siempre).
  const catalogoPuntos = ctx.puntos ?? new Map<string, PuntoSalida>();
  await repoPuntosTour.delete({ tour_id: tourId });
  let puntos = (doc.puntos ?? []).filter((p) => p?.clave);
  if (!puntos.length) {
    const activos = [...catalogoPuntos.values()]
      .filter((p) => p.activo)
      .sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0));
    puntos = activos.map((p) => ({
      clave: p.clave,
      hora: p.hora,
      confirmar_hora:
        (p.ciudad ?? '').toLowerCase().includes('caracas') || p.seleccionable === false,
    }));
  }
  if (puntos.length) {
    const entidades = puntos.map((p, i) => {
      const ref = catalogoPuntos.get(p.clave);
      // Caracas se confirma después (el cliente elige «punto por confirmar»).
      const esCaracas = (ref?.ciudad ?? '').toLowerCase().includes('caracas');
      return repoPuntosTour.create({
        tour_id: tourId,
        clave: p.clave,
        nombre: ref?.nombre ?? p.clave,
        hora: esHora(p.hora) ? p.hora : (ref?.hora ?? '00:00'),
        confirmar_hora: p.confirmar_hora === true || esCaracas,
        referencia: ref?.referencia ?? null,
        orden: i,
        activo: true,
      });
    });
    await repoPuntosTour.save(entidades);
  }

  // ── matriz de precios del tour (plantilla de las salidas) ──────────────
  // El catálogo define **una sola cifra por tour** (regla 4 del catálogo):
  // niño y tercera edad quedan al precio adulto y el infante (0-4 años) en
  // 0.00. Si el documento trae todas las categorías (importador), se respetan.
  const precios: Partial<Record<CategoriaPasajero, number>> = { ...(doc.precios ?? {}) };
  if (precios.adulto !== undefined) {
    if (precios.nino === undefined && precios.tercera_edad === undefined) {
      precios.nino = precios.adulto;
      precios.tercera_edad = precios.adulto;
    }
    // El infante (0-4 años) viaja gratis: siempre 0.
    if (precios.infante === undefined) precios.infante = 0;
  }
  for (const categoria of CATEGORIAS) {
    const precio = precios[categoria];
    if (precio === undefined || precio === null || !Number.isFinite(Number(precio))) continue;
    const rango = RANGOS_EDAD[categoria];
    let existente = await repoPrecios.findOne({ where: { tour_id: tourId, categoria } });
    const valor = categoria === 'infante' ? '0.00' : Number(precio).toFixed(2);
    if (!existente) {
      existente = repoPrecios.create({
        tour_id: tourId,
        categoria,
        edad_min: rango.min,
        edad_max: rango.max,
        precio_usd: valor,
      });
    } else {
      existente.precio_usd = valor;
      existente.edad_min = rango.min;
      existente.edad_max = rango.max;
    }
    await repoPrecios.save(existente);
  }

  // ── formulario (imprescindible para activar) ───────────────────────────
  let formularioPublicado = false;
  if (opciones.crearFormulario !== false) {
    const definicion = formularioBase({
      incluye: doc.incluye ?? [],
      puntos: puntos.map((p) => {
        const ref = catalogoPuntos.get(p.clave);
        return {
          clave: p.clave,
          nombre: ref?.nombre ?? p.clave,
          ciudad: ref?.ciudad ?? null,
          seleccionable: ref?.seleccionable !== false,
        };
      }),
    });
    const publicado = await repoFormularios.findOne({
      where: { tour_id: tourId, estado: 'publicada' },
    });
    if (!publicado) {
      const version = repoFormularios.create({
        tour_id: tourId,
        version: 1,
        estado: 'publicada',
        definicion,
        hash: hashDefinicion(definicion),
        publicada_en: new Date(),
        publicada_por: ctx.autorId ?? null,
      });
      await repoFormularios.save(version);
      formularioPublicado = true;
    } else {
      // Si cambió el punto de salida (salidas personalizadas, Caracas…),
      // se publica una versión nueva y la anterior queda archivada.
      const camposActuales =
        ((publicado.definicion ?? {}) as { campos?: Record<string, unknown>[] }).campos ?? [];
      const proyectar = (c: Record<string, unknown> | undefined) =>
        JSON.stringify(
          c
            ? { label: c.label, ayuda: c.ayuda, permite_por_pasajero: c.permite_por_pasajero, opciones: c.opciones }
            : null,
        );
      const actual = camposActuales.find((c) => c?.id === 'punto_abordaje');
      const nuevo = (definicion.campos as Record<string, unknown>[]).find(
        (c) => c?.id === 'punto_abordaje',
      );
      if (proyectar(actual) !== proyectar(nuevo)) {
        const todas = await repoFormularios.find({ where: { tour_id: tourId } });
        const maxVersion = Math.max(0, ...todas.map((v) => v.version));
        publicado.estado = 'archivada';
        await repoFormularios.save(publicado);
        const version = repoFormularios.create({
          tour_id: tourId,
          version: maxVersion + 1,
          estado: 'publicada',
          definicion,
          hash: hashDefinicion(definicion),
          publicada_en: new Date(),
          publicada_por: ctx.autorId ?? null,
        });
        await repoFormularios.save(version);
        formularioPublicado = true;
      }
    }
  }

  // ── activar (exige política + formulario publicado) ────────────────────
  if (opciones.activar !== false && fila.estado === 'borrador') {
    const lista = await repoFormularios.find({ where: { tour_id: tourId, estado: 'publicada' } });
    if (fila.politica_cancelacion_id && lista.length > 0) {
      fila.estado = 'activo';
      await repoTours.save(fila);
    }
  }

  // ── fechas y tarifas ───────────────────────────────────────────────────
  let fechasCreadas = 0;
  let tarifasCreadas = 0;
  const publicar = opciones.publicarFechas !== false;
  for (const fecha of doc.fechas ?? []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) continue;
    let f = await repoFechas.findOne({ where: { tour_id: tourId, fecha_salida: fecha } });
    if (!f) {
      f = repoFechas.create({
        tour_id: tourId,
        fecha_salida: fecha,
        hora_salida: datos.hora_salida ?? '08:00',
        cupos_total: doc.cupos ?? 20,
        sobrecupo_autorizado: 0,
        cupos_retenidos: 0,
        cupos_vendidos: 0,
        estado: publicar ? 'publicada' : 'borrador',
        corte_venta_horas: 12,
        version: 1,
      });
      await repoFechas.save(f);
      fechasCreadas += 1;
    } else if (opciones.actualizarPrecios) {
      f.cupos_total = doc.cupos ?? f.cupos_total;
      f.hora_salida = datos.hora_salida ?? f.hora_salida;
      f.version += 1;
      await repoFechas.save(f);
    }

    for (const categoria of CATEGORIAS) {
      const precio = precios[categoria];
      if (precio === undefined || precio === null || !Number.isFinite(Number(precio))) continue;
      const valor = categoria === 'infante' ? '0.00' : Number(precio).toFixed(2);
      const existente = await repoTarifas.findOne({
        where: { fecha_tour_id: f.id, categoria },
      });
      if (!existente) {
        const rango = RANGOS_EDAD[categoria];
        await repoTarifas.save(
          repoTarifas.create({
            fecha_tour_id: f.id,
            categoria,
            edad_min: rango.min,
            edad_max: rango.max,
            precio_usd: valor,
          }),
        );
        tarifasCreadas += 1;
      } else if (opciones.actualizarPrecios && existente.precio_usd !== valor) {
        existente.precio_usd = valor;
        await repoTarifas.save(existente);
      }
    }
  }

  return { tourId, creado, fechasCreadas, tarifasCreadas, formularioPublicado };
}

/**
 * Aplica un catálogo completo (el archivo `catalogo-escapate.json`).
 *
 * Es la operación que usa el importador por CLI; el panel usa
 * `aplicarDocumentoTour` para un tour a la vez.
 */
export async function aplicarCatalogo(
  em: EntityManager,
  catalogo: DocumentoCatalogo,
  opciones: OpcionesAplicar = {},
): Promise<{
  politicas: string[];
  terminos: string[];
  puntos: string[];
  tours: string[];
  formularios: string[];
  fechas: number;
  tarifas: number;
  avisos: string[];
}> {
  const reporte = {
    politicas: [] as string[],
    terminos: [] as string[],
    puntos: [] as string[],
    tours: [] as string[],
    formularios: [] as string[],
    fechas: 0,
    tarifas: 0,
    avisos: [] as string[],
  };

  const repoPoliticas = em.getRepository(PoliticaCancelacion);
  const repoPlantillas = em.getRepository(PlantillaTerminos);
  const repoVersiones = em.getRepository(PlantillaTerminosVersion);
  const repoPuntos = em.getRepository(PuntoSalida);
  const repoConfig = em.getRepository(Configuracion);
  const repoTours = em.getRepository(Tour);

  // ── políticas de cancelación ───────────────────────────────────────────
  const mapaPoliticas = new Map<string, string>();
  for (const p of catalogo.politicas ?? []) {
    let pol = await repoPoliticas.findOne({ where: { clave: p.clave } });
    if (!pol) {
      pol = await repoPoliticas.findOne({ where: { nombre: p.nombre } });
    }
    if (!pol) {
      pol = repoPoliticas.create({ clave: p.clave, nombre: p.nombre, tramos: p.tramos as never });
      pol = await repoPoliticas.save(pol);
      reporte.politicas.push(`${p.nombre} (creada)`);
    } else {
      // La clave del catálogo es la fuente de verdad.
      if (pol.clave !== p.clave) {
        pol.clave = p.clave;
        pol = await repoPoliticas.save(pol);
      }
      reporte.politicas.push(`${p.nombre} (ya existía)`);
    }
    mapaPoliticas.set(p.clave, pol.id);
  }

  // ── términos y condiciones ────────────────────────────────────────────
  const mapaTerminos = new Map<string, string>();
  if (catalogo.terminos?.contenido) {
    const clave = catalogo.terminos.clave ?? slugify(catalogo.terminos.nombre);
    let plantilla = await repoPlantillas.findOne({ where: { clave } });
    if (!plantilla) plantilla = await repoPlantillas.findOne({ where: { nombre: catalogo.terminos.nombre } });
    if (!plantilla) {
      plantilla = repoPlantillas.create({ clave, nombre: catalogo.terminos.nombre });
      plantilla = await repoPlantillas.save(plantilla);
      reporte.terminos.push(`${catalogo.terminos.nombre} (creada)`);
    } else {
      // La clave del catálogo es la fuente de verdad.
      if (plantilla.clave !== clave) {
        plantilla.clave = clave;
        plantilla = await repoPlantillas.save(plantilla);
      }
      reporte.terminos.push(`${catalogo.terminos.nombre} (ya existía)`);
    }

    const publicada = await repoVersiones.findOne({
      where: { plantilla_id: plantilla.id, estado: 'publicada' },
    });
    if (!publicada) {
      const maxVersion = Math.max(0, ...(await repoVersiones.find()).map((v) => v.version));
      const version = repoVersiones.create({
        plantilla_id: plantilla.id,
        version: maxVersion + 1,
        contenido: catalogo.terminos.contenido,
        hash_sha256: hashDefinicion(catalogo.terminos.contenido),
        estado: 'publicada',
        publicada_en: new Date(),
      });
      await repoVersiones.save(version);
      reporte.terminos.push(`versión ${maxVersion + 1} publicada (queda vigente)`);
    } else {
      const maxVersion = Math.max(0, ...(await repoVersiones.find()).map((v) => v.version));
      if (publicada.version < maxVersion) {
        publicada.version = maxVersion + 1;
        await repoVersiones.save(publicada);
        reporte.terminos.push(`versión elevada a ${maxVersion + 1} (queda vigente)`);
      } else {
        reporte.terminos.push('ya hay una versión publicada (se conserva)');
      }
    }
    mapaTerminos.set(clave, plantilla.id);
  }

  // ── catálogo global de puntos de salida ───────────────────────────────
  const mapaPuntos = new Map<string, PuntoSalida>();
  for (const [i, p] of (catalogo.puntos_salida ?? []).entries()) {
    const hora = await horaDeReferencia(catalogo, p.clave);
    let punto = await repoPuntos.findOne({ where: { clave: p.clave } });
    if (!punto) {
      punto = repoPuntos.create({
        clave: p.clave,
        nombre: p.nombre,
        hora,
        referencia: p.referencia ?? null,
        ciudad: p.ciudad ?? null,
        seleccionable: p.seleccionable !== false,
        orden: i,
        activo: true,
      });
      await repoPuntos.save(punto);
      reporte.puntos.push(`${p.nombre} (creado, hora de referencia ${hora})`);
    } else {
      punto.nombre = p.nombre;
      punto.referencia = p.referencia ?? null;
      punto.ciudad = p.ciudad ?? null;
      punto.seleccionable = p.seleccionable !== false;
      punto.orden = i;
      punto.activo = true;
      await repoPuntos.save(punto);
      reporte.puntos.push(`${p.nombre} (actualizado)`);
    }
    mapaPuntos.set(p.clave, punto);
  }

  // Los puntos que no están en el catálogo se desactivan (el cliente vería
  // duplicados); los que son referencia siguen visibles como referencia.
  const clavesCatalogo = new Set((catalogo.puntos_salida ?? []).map((p) => p.clave));
  for (const punto of await repoPuntos.find({ where: { activo: true } })) {
    if (clavesCatalogo.has(punto.clave)) continue;
    punto.activo = false;
    await repoPuntos.save(punto);
    reporte.avisos.push(`Punto de salida desactivado (no está en el catálogo): ${punto.nombre}`);
  }

  // ── autor de la importación ───────────────────────────────────────────
  const admin = (await em.getRepository(Usuario).find()).find((u) =>
    (u.roles ?? []).includes('superadmin'),
  );
  const autorId = admin?.id ?? null;

  const ctx: ContextoAplicar = {
    autorId,
    politicas: mapaPoliticas,
    terminos: mapaTerminos,
    puntos: mapaPuntos,
  };

  // ── tours ─────────────────────────────────────────────────────────────
  for (const doc of catalogo.tours ?? []) {
    const resultado = await aplicarDocumentoTour(em, doc, ctx, opciones);
    const nombre = doc.nombre;
    reporte.tours.push(`${nombre} (${resultado.creado ? 'creado' : 'actualizado'})`);
    if (resultado.formularioPublicado) {
      reporte.formularios.push(`${nombre} (formulario publicado)`);
    }
    reporte.fechas += resultado.fechasCreadas;
    reporte.tarifas += resultado.tarifasCreadas;
  }

  // ── la selección de comida debe poder mostrarse al cliente ────────────
  const flag = await repoConfig.findOne({ where: { clave: 'comidas_deshabilitadas' } });
  if (!flag) {
    await repoConfig.save(
      repoConfig.create({ clave: 'comidas_deshabilitadas', valor: false, actualizado_en: new Date() }),
    );
    reporte.avisos.push('Se habilitó la selección de comida en el formulario público.');
  } else if (flag.valor !== false) {
    flag.valor = false;
    flag.actualizado_en = new Date();
    await repoConfig.save(flag);
    reporte.avisos.push('Se habilitó la selección de comida en el formulario público.');
  }

  void repoTours;

  return reporte;
}

/**
 * Hora de referencia de un punto en el catálogo global: la más usada por los
 * tours (el sistema guarda una sola hora por punto; la hora exacta de cada
 * tour queda en sus puntos de abordaje).
 */
async function horaDeReferencia(catalogo: DocumentoCatalogo, clave: string): Promise<string> {
  const conteo = new Map<string, number>();
  for (const tour of catalogo.tours ?? []) {
    for (const p of tour.puntos ?? []) {
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
// Documento desde la base de datos
// ---------------------------------------------------------------------------

/**
 * Arma el documento de un tour tal como está en la base: es lo que ve el
 * panel (editor) y lo que se exporta a JSON.
 */
export async function documentoDesdeTour(
  em: EntityManager,
  tourId: string,
): Promise<DocumentoTour | null> {
  const repoTours = em.getRepository(Tour);
  const repoPuntos = em.getRepository(TourPuntoAbordaje);
  const repoPrecios = em.getRepository(TourPrecio);
  const repoFechas = em.getRepository(FechaTour);
  const repoPoliticas = em.getRepository(PoliticaCancelacion);
  const repoTerminos = em.getRepository(PlantillaTerminos);

  const tour = await repoTours.findOne({ where: { id: tourId } });
  if (!tour) return null;

  const puntos = await repoPuntos.find({ where: { tour_id: tourId }, order: { orden: 'ASC' } });
  const precios = await repoPrecios.find({ where: { tour_id: tourId } });
  const fechas = await repoFechas.find({ where: { tour_id: tourId }, order: { fecha_salida: 'ASC' } });

  const politica = tour.politica_cancelacion_id
    ? await repoPoliticas.findOne({ where: { id: tour.politica_cancelacion_id } })
    : null;
  const terminos = tour.plantilla_terminos_id
    ? await repoTerminos.findOne({ where: { id: tour.plantilla_terminos_id } })
    : null;

  const matriz: Partial<Record<CategoriaPasajero, number>> = {};
  for (const p of precios) {
    matriz[p.categoria] = Number(p.precio_usd);
  }

  return {
    clave: tour.clave ?? slugify(tour.nombre),
    nombre: tour.nombre,
    tipo: tour.tipo,
    duracion: { dias: tour.duracion_dias ?? null, noches: tour.duracion_noches ?? null },
    familia: tour.familia ?? null,
    politica: politica?.clave ?? null,
    terminos: terminos?.clave ?? null,
    hora_salida: tour.hora_salida ?? null,
    reserva_usd: tour.reserva_usd === null || tour.reserva_usd === undefined ? null : Number(tour.reserva_usd),
    cupos: tour.cupos ?? null,
    descripcion: tour.descripcion ?? null,
    puntos: puntos.map((p) => ({
      clave: p.clave,
      hora: p.hora,
      confirmar_hora: p.confirmar_hora,
    })),
    precios: matriz,
    fechas: fechas.map((f) => f.fecha_salida),
    incluye: tour.incluye ?? [],
    no_incluye: tour.no_incluye ?? [],
    itinerario: (tour.itinerario ?? []) as DocumentoItinerario[],
    notas: tour.notas ?? [],
  };
}

export { uuidv7 };
