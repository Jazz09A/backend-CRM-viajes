import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { randomBytes } from 'crypto';
import { EnlaceReserva, FechaTour, Pasajero, Reserva, Tour, TourFormVersion } from '../../database/entities';
import { ApiError } from '../../common/errors';
import { nuevoTokenEnlace } from '../../common/crypto.util';
import { CuposService } from '../cupos/cupos.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { ReservaStateMachine } from './reserva-state-machine';
import { construirProgreso } from './progreso';
import { CrearReservaDto } from './reservas.dto';

@Injectable()
export class ReservasService {
  constructor(
    @InjectRepository(Reserva) private readonly reservas: Repository<Reserva>,
    @InjectRepository(EnlaceReserva) private readonly enlaces: Repository<EnlaceReserva>,
    @InjectRepository(Pasajero) private readonly pasajeros: Repository<Pasajero>,
    @InjectRepository(FechaTour) private readonly fechas: Repository<FechaTour>,
    @InjectRepository(Tour) private readonly tours: Repository<Tour>,
    @InjectRepository(TourFormVersion) private readonly formVersions: Repository<TourFormVersion>,
    private readonly cupos: CuposService,
    private readonly config: ConfiguracionService,
    private readonly stateMachine: ReservaStateMachine,
  ) {}

  /** POST /admin/reservas — crea reserva en enlace_creado + enlace (spec 6.5). */
  async crear(dto: CrearReservaDto, usuarioId: string) {
    const fecha = await this.fechas.findOne({ where: { id: dto.fecha_tour_id } });
    if (!fecha) throw ApiError.noEncontrado('Fecha');
    if (fecha.estado !== 'publicada') {
      throw ApiError.validacion('La fecha no está publicada', [
        { campo: 'fecha_tour_id', codigo: 'FECHA_NO_PUBLICADA', mensaje: 'La fecha no está disponible' },
      ]);
    }
    // Corte de venta (RF-2.7).
    const salida = new Date(`${fecha.fecha_salida}T${fecha.hora_salida}:00`);
    const corte = new Date(salida.getTime() - fecha.corte_venta_horas * 3600 * 1000);
    if (new Date() > corte) {
      throw ApiError.validacion('La venta de esta fecha ya cerró', [
        { campo: 'fecha_tour_id', codigo: 'FECHA_CERRADA', mensaje: 'Corte de venta superado' },
      ]);
    }
    const disponibilidad = await this.cupos.disponibilidad(fecha.id);
    if (disponibilidad.disponible <= 0) {
      throw ApiError.validacion('Sin cupo disponible', [
        { campo: 'fecha_tour_id', codigo: 'SIN_CUPO', mensaje: 'La fecha está agotada' },
      ]);
    }

    const reserva = await this.reservas.save(
      this.reservas.create({
        ref_corta: this.generarRefCorta(),
        fecha_tour_id: fecha.id,
        referencia_interna: dto.referencia_interna ?? null,
        estado: 'enlace_creado',
        estado_pago: 'sin_pago',
        creada_por: usuarioId,
        ultima_actividad_en: new Date(),
      }),
    );

    const { token } = await this.stateMachine.crearEnlace(reserva.id, usuarioId);
    const vigenciaH = Number((await this.config.obtener('enlace_vigencia_h')) ?? 72);
    const advertencias: string[] = [];
    if (disponibilidad.disponible <= 3) advertencias.push('Quedan pocos cupos');

    return {
      reserva: await this.detalle(reserva.id),
      enlace: {
        token,
        url: `/r/${token}`,
        expira_en: new Date(Date.now() + vigenciaH * 3600 * 1000).toISOString(),
      },
      whatsapp_url: this.whatsappUrl(token, reserva.id),
      advertencias,
    };
  }

  async listar(query: {
    tour_id?: string;
    fecha_tour_id?: string;
    estado?: string;
    estado_pago?: string;
    q?: string;
    limite?: string;
    cursor?: string;
  }) {
    const qb = this.reservas.createQueryBuilder('r')
      .orderBy('r.creado_en', 'DESC')
      .take(50);

    if (query.fecha_tour_id) qb.andWhere('r.fecha_tour_id = :fid', { fid: query.fecha_tour_id });
    if (query.estado) qb.andWhere('r.estado IN (:...estados)', { estados: query.estado.split(',') });
    if (query.estado_pago) qb.andWhere('r.estado_pago IN (:...eps)', { eps: query.estado_pago.split(',') });
    if (query.q) {
      qb.andWhere(
        `(r.ref_corta LIKE :q OR r.codigo LIKE :q OR r.referencia_interna LIKE :q)`,
        { q: `%${query.q}%` },
      );
    }
    const datos = await qb.getMany();
    return { datos: datos.map((r) => this.resumenAdmin(r)), siguiente_cursor: null };
  }

  async detalle(id: string) {
    const reserva = await this.reservas.findOne({ where: { id } });
    if (!reserva) throw ApiError.noEncontrado('Reserva');
    const [fecha, tour, pasajeros, enlaces] = await Promise.all([
      this.fechas.findOne({ where: { id: reserva.fecha_tour_id } }),
      this.tours.findOne({ where: { id: (await this.fechas.findOne({ where: { id: reserva.fecha_tour_id } }))?.tour_id ?? '' } }),
      this.pasajeros.find({ where: { reserva_id: id }, order: { orden: 'ASC' } }),
      this.enlaces.find({ where: { reserva_id: id }, order: { creado_en: 'DESC' } }),
    ]);
    return {
      ...reserva,
      pasajeros: pasajeros.map((p) => this.enmascararPasajero(p)),
      fecha,
      tour,
      enlaces: enlaces.map((e) => ({ id: e.id, estado: e.estado, expira_en: e.expira_en, creado_en: e.creado_en })),
      progreso: construirProgreso(reserva),
    };
  }

  async cancelar(id: string, dto: { origen: 'cliente' | 'agencia' | 'fuerza_mayor'; motivo: string; forzar?: boolean }, usuarioId: string) {
    return this.stateMachine.transicionar(id, 'cancelar', { tipo: 'usuario', id: usuarioId }, {
      motivo: dto.motivo,
      datos: { origen: dto.origen },
    });
  }

  async reactivar(id: string, usuarioId: string) {
    const reserva = await this.stateMachine.transicionar(id, 'reactivar', { tipo: 'usuario', id: usuarioId });
    await this.stateMachine.crearEnlace(reserva.id, usuarioId);
    return this.detalle(id);
  }

  async regenerarEnlace(id: string, usuarioId: string) {
    const reserva = await this.reservas.findOne({ where: { id } });
    if (!reserva) throw ApiError.noEncontrado('Reserva');
    await this.enlaces.update(
      { reserva_id: id, estado: 'vigente' },
      { estado: 'revocado', revocado_en: new Date(), revocado_por: usuarioId },
    );
    const { token } = await this.stateMachine.crearEnlace(id, usuarioId);
    return { enlace: { token, url: `/r/${token}` }, whatsapp_url: this.whatsappUrl(token, id) };
  }

  async extenderHold(id: string, horas: number, motivo: string, usuarioId: string) {
    const reserva = await this.reservas.findOne({ where: { id } });
    if (!reserva) throw ApiError.noEncontrado('Reserva');
    if (reserva.cupo_estado !== 'retenido' || !reserva.expira_en) {
      throw ApiError.transicionInvalida('La reserva no tiene un hold activo');
    }
    const maxHoras = Math.min(horas, 72);
    reserva.expira_en = new Date(Date.now() + maxHoras * 3600 * 1000);
    reserva.version += 1;
    await this.reservas.save(reserva);
    return this.detalle(id);
    void motivo;
    void usuarioId;
  }

  // ── helpers ───────────────────────────────────────────────────────────

  private resumenAdmin(r: Reserva) {
    return {
      id: r.id,
      ref_corta: r.ref_corta,
      codigo: r.codigo,
      estado: r.estado,
      estado_pago: r.estado_pago,
      fecha_tour_id: r.fecha_tour_id,
      creada_en: r.creado_en,
      version: r.version,
    };
  }

  private enmascararPasajero(p: Pasajero) {
    // Documentos nunca salen en claro por la API admin (spec 7.2 / 10.5).
    const { documento_enc, fecha_nacimiento_enc, documento_idx, ...resto } = p;
    return {
      ...resto,
      documento_ultimos4: p.documento_ultimos4,
      documento_enmascarado: p.documento_ultimos4 ? `***${p.documento_ultimos4}` : null,
    };
    void documento_enc;
    void fecha_nacimiento_enc;
    void documento_idx;
  }

  private generarRefCorta(): string {
    const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    const bytes = randomBytes(8);
    return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('');
  }

  private whatsappUrl(token: string, _reservaId: string): string | null {
    void _reservaId;
    return null; // TODO: armar wa.me con plantilla de PlantillaMensaje
  }

  // Expuesto para el módulo público.
  async obtenerReserva(id: string) {
    return this.reservas.findOne({ where: { id } });
  }
}
