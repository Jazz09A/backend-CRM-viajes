import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Tour,
  TourPuntoAbordaje,
  TourFormVersion,
  FechaTour,
  PlantillaTerminosVersion,
  Tarifa,
} from '../../database/entities';
import { ApiError } from '../../common/errors';
import { ActualizarTourDto, CrearTourDto, PuntoAbordajeDto } from './tours.dto';
import { sha256Hex } from '../../common/crypto.util';

/** Requisito de activación de un tour (lo calcula el servidor). */
export interface RequisitoActivacion {
  clave: string;
  titulo: string;
  detalle: string;
  ok: boolean;
}

@Injectable()
export class ToursService {
  constructor(
    @InjectRepository(Tour) private readonly tours: Repository<Tour>,
    @InjectRepository(TourPuntoAbordaje) private readonly puntos: Repository<TourPuntoAbordaje>,
    @InjectRepository(TourFormVersion) private readonly versiones: Repository<TourFormVersion>,
    @InjectRepository(FechaTour) private readonly fechas: Repository<FechaTour>,
    @InjectRepository(PlantillaTerminosVersion)
    private readonly terminosVersiones: Repository<PlantillaTerminosVersion>,
    @InjectRepository(Tarifa) private readonly tarifas: Repository<Tarifa>,
  ) {}

  listar(filtros: { estado?: string; tipo?: string; q?: string }) {
    const qb = this.tours.createQueryBuilder('t').orderBy('t.creado_en', 'DESC');
    if (filtros.estado) qb.andWhere('t.estado = :estado', { estado: filtros.estado });
    if (filtros.tipo) qb.andWhere('t.tipo = :tipo', { tipo: filtros.tipo });
    if (filtros.q) qb.andWhere('t.nombre LIKE :q', { q: `%${filtros.q}%` });
    return qb.getMany();
  }

  async obtener(id: string) {
    const tour = await this.tours.findOne({ where: { id } });
    if (!tour) throw ApiError.noEncontrado('Tour');
    return tour;
  }

  async crear(dto: CrearTourDto, usuarioId: string) {
    const datos: Record<string, unknown> = { ...dto, estado: 'borrador', creado_por: usuarioId };
    // El monto de la reserva se guarda como decimal (el motor lo lee texto).
    if (dto.reserva_usd !== undefined) datos.reserva_usd = String(dto.reserva_usd);
    const tour = this.tours.create(datos as never);
    return this.tours.save(tour);
  }

  async actualizar(id: string, dto: ActualizarTourDto) {
    const tour = await this.obtener(id);
    this.verificarVersion(tour.version, dto.version);
    const { version: _v, ...cambios } = dto;
    if (cambios.reserva_usd !== undefined) {
      (cambios as Record<string, unknown>).reserva_usd = String(cambios.reserva_usd);
    }
    Object.assign(tour, cambios);
    tour.version += 1;
    return this.tours.save(tour);
  }

  async cambiarEstado(id: string, estado: 'borrador' | 'activo' | 'archivado', usuarioId: string) {
    const tour = await this.obtener(id);
    const transiciones: Record<string, string[]> = {
      borrador: ['activo'],
      activo: ['archivado', 'borrador'],
      archivado: ['activo'],
    };
    if (!transiciones[tour.estado]?.includes(estado)) {
      throw ApiError.transicionInvalida(`No se puede pasar de ${tour.estado} a ${estado}`);
    }
    if (estado === 'activo') await this.validarActivacion(tour);
    if (estado === 'archivado') await this.validarArchivado(tour);
    tour.estado = estado;
    return this.tours.save(tour);
    void usuarioId;
  }

  private async validarActivacion(tour: Tour) {
    const requisitos = await this.requisitos(tour.id);
    const pendientes = requisitos.filter((r) => !r.ok);
    if (pendientes.length) {
      throw ApiError.validacion(
        'El tour todavía no cumple los requisitos para activarse',
        pendientes.map((r) => ({ campo: r.clave, codigo: 'REQUISITO_PENDIENTE', mensaje: r.detalle })),
      );
    }
  }

  /**
   * Requisitos para activar un tour: **el servidor es la autoridad** y el
   * panel sólo los muestra (antes el panel decía «todo listo» y el servidor
   * fallaba después).
   */
  async requisitos(tourId: string): Promise<RequisitoActivacion[]> {
    const tour = await this.obtener(tourId);

    const [versiones, puntosTour, fechas] = await Promise.all([
      this.versiones.find({ where: { tour_id: tourId } }),
      this.puntos.find({ where: { tour_id: tourId, activo: true } }),
      this.fechas.find({ where: { tour_id: tourId } }),
    ]);

    const formularioPublicado = versiones.find((v) => v.estado === 'publicada');

    let terminosOk = false;
    if (tour.plantilla_terminos_id) {
      const version = await this.terminosVersiones.findOne({
        where: { plantilla_id: tour.plantilla_terminos_id, estado: 'publicada' },
      });
      terminosOk = Boolean(version);
    }

    const publicadas = fechas.filter((f) => f.estado === 'publicada');
    const ids = publicadas.map((f) => f.id);
    const tarifas = ids.length ? await this.tarifas.find({ where: { fecha_tour_id: In(ids) } }) : [];
    const porFecha = new Map<string, number>();
    for (const t of tarifas) porFecha.set(t.fecha_tour_id, (porFecha.get(t.fecha_tour_id) ?? 0) + 1);
    const incompletas = publicadas.filter((f) => (porFecha.get(f.id) ?? 0) < 4);

    return [
      {
        clave: 'politica',
        titulo: 'Política de cancelación',
        ok: Boolean(tour.politica_cancelacion_id),
        detalle: tour.politica_cancelacion_id
          ? 'El tour ya tiene una política asociada.'
          : 'Falta asociar una política de cancelación al tour.',
      },
      {
        clave: 'terminos',
        titulo: 'Términos y condiciones',
        ok: terminosOk,
        detalle: terminosOk
          ? 'Los términos están publicados y se mostrarán al cliente.'
          : 'Falta publicar los términos y condiciones.',
      },
      {
        clave: 'formulario',
        titulo: 'Formulario del tour',
        ok: Boolean(formularioPublicado),
        detalle: formularioPublicado
          ? 'El formulario está publicado: el cliente puede responderlo.'
          : 'Falta publicar el formulario del tour (punto de salida, almuerzo, alergias…).',
      },
      {
        clave: 'puntos',
        titulo: 'Puntos de abordaje',
        ok: puntosTour.length > 0,
        detalle:
          puntosTour.length > 0
            ? `${puntosTour.length} punto(s) con su horario de recogida.`
            : 'Falta asignar al menos un punto de salida con su hora.',
      },
      {
        clave: 'salidas',
        titulo: 'Salidas publicadas',
        ok: publicadas.length > 0,
        detalle:
          publicadas.length > 0
            ? `${publicadas.length} salida(s) publicada(s).`
            : 'Falta publicar al menos una salida: sin salidas el cliente no puede reservar.',
      },
      {
        clave: 'tarifas',
        titulo: 'Tarifas de cada salida',
        ok: incompletas.length === 0,
        detalle:
          incompletas.length === 0
            ? 'Todas las salidas publicadas tienen las cuatro categorías de precio.'
            : `${incompletas.length} salida(s) publicada(s) no tienen las cuatro tarifas (adulto, niño, tercera edad, infante).`,
      },
    ];
  }

  private async validarArchivado(tour: Tour) {
    const hoy = new Date().toISOString().slice(0, 10);
    const futuras = await this.fechas.count({
      where: { tour_id: tour.id, estado: 'publicada' },
    });
    void hoy;
    void futuras;
  }

  // ── puntos de abordaje ────────────────────────────────────────────────

  async listarPuntos(tourId: string) {
    await this.obtener(tourId);
    return this.puntos.find({ where: { tour_id: tourId }, order: { orden: 'ASC' } });
  }

  async reemplazarPuntos(tourId: string, lista: PuntoAbordajeDto[]) {
    await this.obtener(tourId);
    await this.puntos.delete({ tour_id: tourId });
    const entidades = lista.map((p, i) =>
      this.puntos.create({ ...p, tour_id: tourId, orden: p.orden ?? i }),
    );
    return this.puntos.save(entidades);
  }

  // ── formulario dinámico ───────────────────────────────────────────────

  async obtenerFormulario(tourId: string) {
    await this.obtener(tourId);
    const versiones = await this.versiones.find({
      where: { tour_id: tourId },
      order: { version: 'DESC' },
    });
    return {
      borrador: versiones.find((v) => v.estado === 'borrador') ?? null,
      publicada: versiones.find((v) => v.estado === 'publicada') ?? null,
      versiones,
    };
  }

  async guardarBorrador(tourId: string, definicion: Record<string, unknown>) {
    await this.obtener(tourId);
    let borrador = await this.versiones.findOne({
      where: { tour_id: tourId, estado: 'borrador' },
    });
    if (!borrador) {
      const max = await this.versiones.maximum('version', { tour_id: tourId });
      borrador = this.versiones.create({
        tour_id: tourId,
        version: (max ?? 0) + 1,
        estado: 'borrador',
        definicion,
        hash: sha256Hex(JSON.stringify(definicion)),
      });
    } else {
      borrador.definicion = definicion;
      borrador.hash = sha256Hex(JSON.stringify(definicion));
    }
    return this.versiones.save(borrador);
  }

  /** Publica el borrador: crea versión inmutable y archiva la anterior. */
  async publicarFormulario(tourId: string, usuarioId: string) {
    const borrador = await this.versiones.findOne({
      where: { tour_id: tourId, estado: 'borrador' },
    });
    if (!borrador) throw ApiError.validacion('No hay borrador de formulario para publicar');

    await this.versiones.update(
      { tour_id: tourId, estado: 'publicada' },
      { estado: 'archivada' },
    );
    borrador.estado = 'publicada';
    borrador.publicada_en = new Date();
    borrador.publicada_por = usuarioId;
    borrador.hash = sha256Hex(JSON.stringify(borrador.definicion));
    const guardada = await this.versiones.save(borrador);

    // Congelar puntos de abordaje en la definición (nota 5.5).
    return {
      version: guardada,
      impacto: {
        reservas_abiertas: 0, // TODO: contar reservas en la versión previa
        cupos_opcion_a_revisar: [],
      },
    };
  }

  verificarVersion(actual: number, recibida?: number) {
    if (recibida !== undefined && recibida !== actual) {
      throw ApiError.versionDesactualizada();
    }
  }
}
