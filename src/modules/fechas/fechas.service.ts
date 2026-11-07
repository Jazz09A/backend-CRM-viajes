import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CupoOpcion, FechaSobrecupo, FechaTour, Tarifa, Tour } from '../../database/entities';
import { ApiError } from '../../common/errors';
import { ActualizarFechaDto, CrearFechaDto, SobrecupoDto } from './fechas.dto';

@Injectable()
export class FechasService {
  constructor(
    @InjectRepository(FechaTour) private readonly fechas: Repository<FechaTour>,
    @InjectRepository(Tarifa) private readonly tarifas: Repository<Tarifa>,
    @InjectRepository(CupoOpcion) private readonly cuposOpcion: Repository<CupoOpcion>,
    @InjectRepository(FechaSobrecupo) private readonly sobrecupos: Repository<FechaSobrecupo>,
    @InjectRepository(Tour) private readonly tours: Repository<Tour>,
  ) {}

  async listar(filtros: { desde?: string; hasta?: string; tour_id?: string; estado?: string }) {
    const qb = this.fechas.createQueryBuilder('f').orderBy('f.fecha_salida', 'ASC');
    if (filtros.desde) qb.andWhere('f.fecha_salida >= :desde', { desde: filtros.desde });
    if (filtros.hasta) qb.andWhere('f.fecha_salida <= :hasta', { hasta: filtros.hasta });
    if (filtros.tour_id) qb.andWhere('f.tour_id = :tid', { tid: filtros.tour_id });
    if (filtros.estado) qb.andWhere('f.estado IN (:...estados)', { estados: filtros.estado.split(',') });
    return qb.getMany();
  }

  async obtener(id: string) {
    const fecha = await this.fechas.findOne({ where: { id } });
    if (!fecha) throw ApiError.noEncontrado('Fecha');
    const [tarifas, cupos, tour] = await Promise.all([
      this.tarifas.find({ where: { fecha_tour_id: id } }),
      this.cuposOpcion.find({ where: { fecha_tour_id: id } }),
      this.tours.findOne({ where: { id: fecha.tour_id } }),
    ]);
    const capacidad = fecha.cupos_total + fecha.sobrecupo_autorizado;
    return {
      ...fecha,
      tour,
      tarifas,
      cupos_opcion: cupos,
      disponibilidad: {
        cupos_total: fecha.cupos_total,
        sobrecupo_autorizado: fecha.sobrecupo_autorizado,
        retenidos: fecha.cupos_retenidos,
        vendidos: fecha.cupos_vendidos,
        disponible: Math.max(0, capacidad - fecha.cupos_retenidos - fecha.cupos_vendidos),
      },
    };
  }

  async crear(tourId: string, dto: CrearFechaDto) {
    const tour = await this.tours.findOne({ where: { id: tourId } });
    if (!tour) throw ApiError.noEncontrado('Tour');
    if (tour.estado !== 'activo') {
      throw ApiError.validacion('Solo se pueden crear fechas de tours activos');
    }
    const fecha = await this.fechas.save(
      this.fechas.create({
        tour_id: tourId,
        fecha_salida: dto.fecha_salida,
        hora_salida: dto.hora_salida,
        cupos_total: dto.cupos_total,
        sobrecupo_autorizado: dto.sobrecupo_autorizado ?? 0,
        corte_venta_horas: dto.corte_venta_horas ?? 12,
        estado: 'borrador',
      }),
    );
    await this.tarifas.save(
      dto.tarifas.map((t) =>
        this.tarifas.create({
          fecha_tour_id: fecha.id,
          categoria: t.categoria,
          edad_min: t.edad_min,
          edad_max: t.edad_max,
          precio_usd: t.precio_usd.toFixed(2),
        }),
      ),
    );
    if (dto.cupos_opcion?.length) {
      await this.cuposOpcion.save(
        dto.cupos_opcion.map((c) =>
          this.cuposOpcion.create({ fecha_tour_id: fecha.id, ...c }),
        ),
      );
    }
    return this.obtener(fecha.id);
  }

  async actualizar(id: string, dto: ActualizarFechaDto) {
    const fecha = await this.obtenerSimple(id);
    if (dto.cupos_total !== undefined) {
      const ocupado = fecha.cupos_retenidos + fecha.cupos_vendidos;
      if (dto.cupos_total < ocupado) {
        throw ApiError.validacion('cupos_total no puede ser menor que lo ocupado', [
          { campo: 'cupos_total', codigo: 'CUPO_MENOR_A_OCUPADO', mensaje: `Mínimo ${ocupado}` },
        ]);
      }
    }
    const { aceptado: _a, ...cambios } = dto;
    Object.assign(fecha, cambios);
    fecha.version += 1;
    await this.fechas.save(fecha);
    return this.obtener(id);
  }

  private async obtenerSimple(id: string) {
    const fecha = await this.fechas.findOne({ where: { id } });
    if (!fecha) throw ApiError.noEncontrado('Fecha');
    return fecha;
  }

  async cambiarEstado(id: string, accion: 'publicar' | 'cerrar' | 'reabrir' | 'cancelar', usuarioId: string, motivo?: string) {
    const fecha = await this.obtenerSimple(id);
    const tour = await this.tours.findOne({ where: { id: fecha.tour_id } });

    if (accion === 'publicar') {
      if (fecha.estado !== 'borrador') throw ApiError.transicionInvalida(`No se puede publicar desde ${fecha.estado}`);
      if (tour?.estado !== 'activo') throw ApiError.validacion('El tour debe estar activo');
      const nTarifas = await this.tarifas.count({ where: { fecha_tour_id: id } });
      if (nTarifas === 0) throw ApiError.validacion('La fecha necesita tarifas');
      fecha.estado = 'publicada';
    } else if (accion === 'cerrar') {
      if (fecha.estado !== 'publicada') throw ApiError.transicionInvalida('Solo fechas publicadas se cierran');
      fecha.estado = 'cerrada';
      fecha.cierre_motivo = motivo === 'sin_cupo' ? 'sin_cupo' : 'manual';
    } else if (accion === 'reabrir') {
      if (fecha.estado !== 'cerrada') throw ApiError.transicionInvalida('Solo fechas cerradas se reabren');
      if (fecha.cierre_motivo === 'sin_cupo') {
        const capacidad = fecha.cupos_total + fecha.sobrecupo_autorizado;
        if (fecha.cupos_retenidos + fecha.cupos_vendidos >= capacidad) {
          throw ApiError.validacion('No hay cupo para reabrir');
        }
      }
      fecha.estado = 'publicada';
      fecha.cierre_motivo = null;
    } else {
      if (!['publicada', 'cerrada'].includes(fecha.estado)) {
        throw ApiError.transicionInvalida('Solo fechas publicadas/cerradas se cancelan');
      }
      fecha.estado = 'cancelada';
      fecha.cancelada_motivo = motivo ?? null;
      // TODO(D-10): reservas pendientes → expirada; confirmadas → requiere_accion.
    }
    fecha.version += 1;
    await this.fechas.save(fecha);
    void usuarioId;
    return this.obtener(id);
  }

  async sobrecupo(id: string, dto: SobrecupoDto, usuarioId: string) {
    const fecha = await this.obtenerSimple(id);
    await this.sobrecupos.save(
      this.sobrecupos.create({ fecha_tour_id: id, cantidad: dto.cantidad, motivo: dto.motivo, autorizado_por: usuarioId }),
    );
    fecha.sobrecupo_autorizado += dto.cantidad;
    fecha.version += 1;
    await this.fechas.save(fecha);
    return this.obtener(id);
  }

  async eliminar(id: string) {
    const fecha = await this.obtenerSimple(id);
    const reservas = await this.fechas.manager.count('reserva', { where: { fecha_tour_id: id } });
    if (reservas > 0 || fecha.cupos_retenidos + fecha.cupos_vendidos > 0) {
      throw ApiError.validacion('No se puede eliminar una fecha con reservas');
    }
    await this.tarifas.delete({ fecha_tour_id: id });
    await this.cuposOpcion.delete({ fecha_tour_id: id });
    await this.fechas.remove(fecha);
    return { ok: true };
  }
}
