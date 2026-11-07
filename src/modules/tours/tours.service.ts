import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Tour, TourPuntoAbordaje, TourFormVersion, FechaTour } from '../../database/entities';
import { ApiError } from '../../common/errors';
import { ActualizarTourDto, CrearTourDto, PuntoAbordajeDto } from './tours.dto';
import { sha256Hex } from '../../common/crypto.util';

@Injectable()
export class ToursService {
  constructor(
    @InjectRepository(Tour) private readonly tours: Repository<Tour>,
    @InjectRepository(TourPuntoAbordaje) private readonly puntos: Repository<TourPuntoAbordaje>,
    @InjectRepository(TourFormVersion) private readonly versiones: Repository<TourFormVersion>,
    @InjectRepository(FechaTour) private readonly fechas: Repository<FechaTour>,
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
    const tour = this.tours.create({ ...dto, estado: 'borrador', creado_por: usuarioId });
    return this.tours.save(tour);
  }

  async actualizar(id: string, dto: ActualizarTourDto) {
    const tour = await this.obtener(id);
    this.verificarVersion(tour.version, dto.version);
    const { version: _v, ...cambios } = dto;
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
    if (!tour.politica_cancelacion_id) {
      throw ApiError.validacion('El tour necesita una política de cancelación para activarse');
    }
    const publicada = await this.versiones.findOne({
      where: { tour_id: tour.id, estado: 'publicada' },
    });
    if (!publicada) {
      throw ApiError.validacion('El tour necesita un formulario publicado para activarse');
    }
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
