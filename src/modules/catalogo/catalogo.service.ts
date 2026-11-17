import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, In, Repository } from 'typeorm';
import {
  FechaTour,
  PlantillaTerminos,
  PoliticaCancelacion,
  PuntoSalida,
  Tarifa,
  Tour,
  TourFormVersion,
  TourPrecio,
  TourPuntoAbordaje,
} from '../../database/entities';
import type { CategoriaPasajero } from '../../database/entities';
import { ApiError } from '../../common/errors';
import {
  aplicarDocumentoTour,
  CATEGORIAS,
  documentoDesdeTour,
  formularioBase,
  normalizarItinerario,
  RANGOS_EDAD,
  slugify,
} from './documento';
import type { DocumentoPunto, DocumentoTour } from './documento';

export interface FechasMasivoBody {
  /** Fechas explícitas (YYYY-MM-DD), una por línea o en array. */
  fechas?: string[] | string;
  /** Salidas recurrentes: todos los viernes de `desde` a `hasta`. */
  recurrencia?: { dia_semana?: number; desde?: string; hasta?: string } | null;
  /** Precios por categoría; si faltan se usan los del tour. */
  precios?: Partial<Record<CategoriaPasajero, number>> | null;
  cupos_total?: number | null;
  hora_salida?: string | null;
  corte_venta_horas?: number | null;
  estado?: 'borrador' | 'publicada';
  /** Sobrescribe los precios de las salidas que ya existían. */
  actualizar_precios?: boolean;
}

const DIA_SEMANA: Record<number, string> = {
  0: 'domingo',
  1: 'lunes',
  2: 'martes',
  3: 'miércoles',
  4: 'jueves',
  5: 'viernes',
  6: 'sábado',
};

/**
 * Servicio del catálogo: el panel habla de **documentos de tour**, no de
 * filas sueltas. Comparte la lógica con el importador por CLI
 * (`modules/catalogo/documento.ts`).
 */
@Injectable()
export class CatalogoService {
  constructor(
    private readonly ds: DataSource,
    @InjectRepository(Tour) private readonly tours: Repository<Tour>,
    @InjectRepository(TourPrecio) private readonly precios: Repository<TourPrecio>,
    @InjectRepository(TourPuntoAbordaje) private readonly puntosTour: Repository<TourPuntoAbordaje>,
    @InjectRepository(TourFormVersion) private readonly formularios: Repository<TourFormVersion>,
    @InjectRepository(FechaTour) private readonly fechas: Repository<FechaTour>,
    @InjectRepository(Tarifa) private readonly tarifas: Repository<Tarifa>,
    @InjectRepository(PuntoSalida) private readonly puntos: Repository<PuntoSalida>,
    @InjectRepository(PoliticaCancelacion) private readonly politicas: Repository<PoliticaCancelacion>,
    @InjectRepository(PlantillaTerminos) private readonly terminos: Repository<PlantillaTerminos>,
  ) {}

  // ── documento ──────────────────────────────────────────────────────────

  /** Documento de un tour (la forma del catálogo). */
  async documento(tourId: string): Promise<DocumentoTour> {
    const doc = await this.ds.transaction((em) => documentoDesdeTour(em, tourId));
    if (!doc) throw ApiError.noEncontrado('Tour');
    return doc;
  }

  /**
   * Guarda el documento de un tour. Con `tourId` nulo crea uno nuevo.
   *
   * El documento manda: nombre, tipo, familia, duración, hora, cupos,
   * reserva, descripción, itinerario, inclusiones, notas, puntos (con su
   * hora) y la matriz de precios.
   */
  async guardarDocumento(
    tourId: string | null,
    entrada: Partial<DocumentoTour>,
    opciones: { usuarioId?: string | null } = {},
  ): Promise<{ tour: Tour; documento: DocumentoTour }> {
    const doc = this.normalizarDocumento(entrada);

    const resultado = await this.ds.transaction(async (em) => {
      const ctx = await this.contexto(em);
      const aplicado = await aplicarDocumentoTour(
        em,
        doc,
        { ...ctx, autorId: opciones.usuarioId ?? ctx.autorId ?? null },
        {
          // El panel no activa el tour por su cuenta: la activación la
          // decide el operador con la lista de requisitos.
          activar: false,
          publicarFechas: true,
          crearFormulario: true,
        },
      );
      const tour = await em.getRepository(Tour).findOne({ where: { id: aplicado.tourId } });
      if (!tour) throw ApiError.noEncontrado('Tour');
      return tour;
    });

    return { tour: resultado, documento: await this.documento(resultado.id) };
  }

  /** Normaliza y valida el documento que llega del panel. */
  private normalizarDocumento(entrada: Partial<DocumentoTour>): DocumentoTour {
    const nombre = String(entrada.nombre ?? '').trim();
    if (!nombre) throw ApiError.validacion('El tour necesita un nombre');

    const tipo = entrada.tipo ?? 'full_day';
    if (!['full_day', 'fin_de_semana', 'multi_dia'].includes(tipo)) {
      throw ApiError.validacion('Tipo de tour inválido');
    }

    const hora = entrada.hora_salida ? String(entrada.hora_salida) : null;
    if (hora && !/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
      throw ApiError.validacion('La hora de salida debe tener formato HH:MM');
    }

    const cupos = entrada.cupos === null || entrada.cupos === undefined ? null : Number(entrada.cupos);
    if (cupos !== null && (!Number.isFinite(cupos) || cupos < 1 || cupos > 200)) {
      throw ApiError.validacion('Los cupos deben ser un número entre 1 y 200');
    }

    const reserva =
      entrada.reserva_usd === null || entrada.reserva_usd === undefined ? null : Number(entrada.reserva_usd);
    if (reserva !== null && (!Number.isFinite(reserva) || reserva < 0)) {
      throw ApiError.validacion('La reserva debe ser un monto válido');
    }

    const puntos: DocumentoPunto[] = (entrada.puntos ?? [])
      .filter((p) => p?.clave)
      .map((p) => ({
        clave: String(p.clave),
        hora: /^([01]\d|2[0-3]):[0-5]\d$/.test(String(p.hora ?? '')) ? String(p.hora) : '00:00',
        confirmar_hora: p.confirmar_hora === true,
      }));

    const precios: Partial<Record<CategoriaPasajero, number>> = {};
    for (const [categoria, valor] of Object.entries(entrada.precios ?? {})) {
      const numero = Number(valor);
      if (!Number.isFinite(numero) || numero < 0) continue;
      precios[categoria as CategoriaPasajero] = numero;
    }

    return {
      clave: entrada.clave?.trim() || slugify(nombre),
      nombre,
      tipo,
      duracion: {
        dias: entrada.duracion?.dias ?? null,
        noches: entrada.duracion?.noches ?? null,
      },
      familia: entrada.familia?.trim() || null,
      politica: entrada.politica?.trim() || null,
      terminos: entrada.terminos?.trim() || null,
      hora_salida: hora,
      reserva_usd: reserva,
      cupos,
      descripcion: entrada.descripcion?.trim() || null,
      puntos,
      precios,
      fechas: (entrada.fechas ?? []).filter((f) => /^\d{4}-\d{2}-\d{2}$/.test(f)),
      incluye: (entrada.incluye ?? []).map((i) => String(i).trim()).filter(Boolean),
      no_incluye: (entrada.no_incluye ?? []).map((i) => String(i).trim()).filter(Boolean),
      itinerario: normalizarItinerario(entrada.itinerario),
      notas: (entrada.notas ?? []).map((n) => String(n).trim()).filter(Boolean),
    };
  }

  /** Catálogos de referencia que el documento puede citar. */
  private async contexto(em: EntityManager) {
    const politicas = await em.getRepository(PoliticaCancelacion).find();
    const terminos = await em.getRepository(PlantillaTerminos).find();
    const puntos = await em.getRepository(PuntoSalida).find();

    return {
      politicas: new Map(
        politicas.filter((p) => p.clave).map((p) => [p.clave as string, p.id]),
      ),
      terminos: new Map(
        terminos.filter((t) => t.clave).map((t) => [t.clave as string, t.id]),
      ),
      puntos: new Map(puntos.map((p) => [p.clave, p])),
      autorId: null as string | null,
    };
  }

  // ── puntos de abordaje ────────────────────────────────────────────────

  /** Reemplaza los puntos del tour con su hora propia. */
  async guardarPuntos(tourId: string, puntos: DocumentoPunto[]) {
    const tour = await this.tours.findOne({ where: { id: tourId } });
    if (!tour) throw ApiError.noEncontrado('Tour');

    const catalogo = await this.puntos.find();
    const porClave = new Map(catalogo.map((p) => [p.clave, p]));

    await this.puntosTour.delete({ tour_id: tourId });
    const entidades = (puntos ?? [])
      .filter((p) => p?.clave)
      .map((p, i) => {
        const ref = porClave.get(p.clave);
        const hora = /^([01]\d|2[0-3]):[0-5]\d$/.test(String(p.hora ?? ''))
          ? String(p.hora)
          : (ref?.hora ?? '00:00');
        // Caracas: la hora se confirma después por el grupo de viaje.
        const esCaracas = (ref?.ciudad ?? '').toLowerCase().includes('caracas');
        return this.puntosTour.create({
          tour_id: tourId,
          clave: p.clave,
          nombre: ref?.nombre ?? p.clave,
          hora,
          confirmar_hora: p.confirmar_hora === true || esCaracas,
          referencia: ref?.referencia ?? null,
          orden: i,
          activo: true,
        });
      });
    await this.puntosTour.save(entidades);
    return entidades;
  }

  // ── salidas en masa ───────────────────────────────────────────────────

  /**
   * Crea varias salidas con sus tarifas de una vez.
   *
   * Acepta fechas explícitas y/o una recurrencia («todos los viernes
   * hasta el 15/01/2027»), que es como se generaron las 10 salidas de
   * Choroní en el catálogo.
   */
  async fechasMasivo(tourId: string, body: FechasMasivoBody) {
    const tour = await this.tours.findOne({ where: { id: tourId } });
    if (!tour) throw ApiError.noEncontrado('Tour');

    const lista = this.expandirFechas(body);
    if (!lista.length) {
      throw ApiError.validacion('Indica al menos una fecha de salida');
    }

    const precios = await this.precios.find({ where: { tour_id: tourId } });
    const matriz: Partial<Record<CategoriaPasajero, number>> = {};
    for (const p of precios) matriz[p.categoria] = Number(p.precio_usd);
    for (const [categoria, valor] of Object.entries(body.precios ?? {})) {
      const numero = Number(valor);
      if (Number.isFinite(numero) && numero >= 0) matriz[categoria as CategoriaPasajero] = numero;
    }

    const hora = body.hora_salida ?? tour.hora_salida ?? '08:00';
    const cupos = Number(body.cupos_total ?? tour.cupos ?? 20);
    const corte = Number(body.corte_venta_horas ?? 12);
    const estado = body.estado ?? 'publicada';
    const actualizar = body.actualizar_precios === true;

    let creadas = 0;
    let actualizadas = 0;
    let tarifasCreadas = 0;

    await this.ds.transaction(async (em) => {
      const repoFechas = em.getRepository(FechaTour);
      const repoTarifas = em.getRepository(Tarifa);

      for (const fecha of lista) {
        let f = await repoFechas.findOne({ where: { tour_id: tourId, fecha_salida: fecha } });
        if (!f) {
          f = repoFechas.create({
            tour_id: tourId,
            fecha_salida: fecha,
            hora_salida: hora,
            cupos_total: cupos,
            sobrecupo_autorizado: 0,
            cupos_retenidos: 0,
            cupos_vendidos: 0,
            estado,
            corte_venta_horas: corte,
            version: 1,
          });
          await repoFechas.save(f);
          creadas += 1;
        } else {
          f.hora_salida = hora;
          f.cupos_total = cupos;
          f.corte_venta_horas = corte;
          f.estado = estado;
          f.version += 1;
          await repoFechas.save(f);
          actualizadas += 1;
        }

        for (const categoria of CATEGORIAS) {
          const valor = matriz[categoria];
          if (valor === undefined || !Number.isFinite(Number(valor))) continue;
          const precio = categoria === 'infante' ? '0.00' : Number(valor).toFixed(2);
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
                precio_usd: precio,
              }),
            );
            tarifasCreadas += 1;
          } else if (actualizar && existente.precio_usd !== precio) {
            existente.precio_usd = precio;
            await repoTarifas.save(existente);
          }
        }
      }
    });

    const fechas = await this.fechas.find({ where: { tour_id: tourId }, order: { fecha_salida: 'ASC' } });
    return { fechas, creadas, actualizadas, tarifas_creadas: tarifasCreadas };
  }

  /** Expande fechas explícitas y recurrencias a una lista de fechas. */
  private expandirFechas(body: FechasMasivoBody): string[] {
    const resultado = new Set<string>();

    const explicitas = Array.isArray(body.fechas)
      ? body.fechas
      : String(body.fechas ?? '')
          .split(/[\s,;]+/)
          .filter(Boolean);
    for (const f of explicitas) {
      const iso = String(f).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) resultado.add(iso);
    }

    const rec = body.recurrencia;
    if (rec?.desde && rec?.hasta) {
      const dia = Number(rec.dia_semana ?? 5);
      const desde = new Date(`${rec.desde}T00:00:00Z`);
      const hasta = new Date(`${rec.hasta}T00:00:00Z`);
      if (!Number.isNaN(desde.getTime()) && !Number.isNaN(hasta.getTime()) && hasta >= desde) {
        const cursor = new Date(desde);
        // Retrocede hasta el primer día de la semana pedido.
        while (cursor.getUTCDay() !== dia) cursor.setUTCDate(cursor.getUTCDate() - 1);
        while (cursor <= hasta) {
          resultado.add(cursor.toISOString().slice(0, 10));
          cursor.setUTCDate(cursor.getUTCDate() + 7);
        }
      }
    }

    return [...resultado].sort();
  }

  // ── formulario ─────────────────────────────────────────────────────────

  /**
   * Publica el formulario base del tour (punto de salida, almuerzo si hay
   * comidas, alergias y comentarios). Sin él el tour no se puede activar.
   */
  async formularioPlantilla(tourId: string, usuarioId?: string | null) {
    const tour = await this.tours.findOne({ where: { id: tourId } });
    if (!tour) throw ApiError.noEncontrado('Tour');

    const puntosTour = await this.puntosTour.find({ where: { tour_id: tourId }, order: { orden: 'ASC' } });
    const catalogo = await this.puntos.find();
    const porClave = new Map(catalogo.map((p) => [p.clave, p]));

    const definicion = formularioBase({
      incluye: tour.incluye ?? [],
      puntos: puntosTour.map((p) => ({
        clave: p.clave,
        nombre: porClave.get(p.clave)?.nombre ?? p.nombre,
        ciudad: porClave.get(p.clave)?.ciudad ?? null,
        seleccionable: porClave.get(p.clave)?.seleccionable !== false,
      })),
    });

    const publicada = await this.formularios.findOne({
      where: { tour_id: tourId, estado: 'publicada' },
    });
    if (publicada) {
      return { ya_publicada: true, version: publicada.version };
    }

    const maxVersion = Math.max(0, ...(await this.formularios.find({ where: { tour_id: tourId } })).map((v) => v.version));
    const { createHash } = await import('crypto');
    const hash = createHash('sha256').update(JSON.stringify(definicion)).digest('hex');
    const version = await this.formularios.save(
      this.formularios.create({
        tour_id: tourId,
        version: maxVersion + 1,
        estado: 'publicada',
        definicion,
        hash,
        publicada_en: new Date(),
        publicada_por: usuarioId ?? null,
      }),
    );
    return { ya_publicada: false, version };
  }

  // ── exportación ────────────────────────────────────────────────────────

  /** Exporta todo el catálogo con la misma forma del JSON de referencia. */
  async exportarCatalogo() {
    const tours = await this.tours.find({ order: { nombre: 'ASC' } });
    const politicas = await this.politicas.find({ order: { nombre: 'ASC' } });
    const terminos = await this.terminos.find({ order: { nombre: 'ASC' } });
    const puntos = await this.puntos.find({ order: { orden: 'ASC' } });

    const documentos = await this.ds.transaction(async (em) => {
      const lista: DocumentoTour[] = [];
      for (const t of tours) {
        const doc = await documentoDesdeTour(em, t.id);
        if (doc) lista.push(doc);
      }
      return lista;
    });

    return {
      version: 2,
      origen: 'Panel de reservas · catálogo exportado',
      politicas: politicas.map((p) => ({ clave: p.clave ?? slugify(p.nombre), nombre: p.nombre, tramos: p.tramos })),
      terminos: terminos.map((t) => ({ clave: t.clave ?? slugify(t.nombre), nombre: t.nombre })),
      puntos_salida: puntos.map((p) => ({
        clave: p.clave,
        ciudad: p.ciudad ?? undefined,
        nombre: p.nombre,
        referencia: p.referencia ?? undefined,
        seleccionable: p.seleccionable,
      })),
      tours: documentos,
    };
  }

  /** Matriz de precios de un tour (la plantilla de las salidas). */
  async matrizPrecios(tourId: string) {
    const precios = await this.precios.find({ where: { tour_id: tourId } });
    return precios.map((p) => ({
      categoria: p.categoria,
      edad_min: p.edad_min,
      edad_max: p.edad_max,
      precio_usd: p.precio_usd,
    }));
  }

  /** Fechas de un tour con sus tarifas (para la ficha). */
  async salidasConTarifas(tourId: string) {
    const fechas = await this.fechas.find({ where: { tour_id: tourId }, order: { fecha_salida: 'ASC' } });
    const ids = fechas.map((f) => f.id);
    const tarifas = ids.length ? await this.tarifas.find({ where: { fecha_tour_id: In(ids) } }) : [];
    return {
      fechas,
      tarifas: tarifas.map((t) => ({
        id: t.id,
        fecha_tour_id: t.fecha_tour_id,
        categoria: t.categoria,
        edad_min: t.edad_min,
        edad_max: t.edad_max,
        precio_usd: t.precio_usd,
      })),
    };
  }
}

export { DIA_SEMANA };
