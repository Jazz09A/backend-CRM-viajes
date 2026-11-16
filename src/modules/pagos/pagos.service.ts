import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pago, Reembolso, Reserva } from '../../database/entities';
import { ApiError } from '../../common/errors';
import { ReembolsoDto } from './pagos.dto';
import { EstadoPago } from '../../database/entities/operacion.entities';

/**
 * Ciclo de vida de pagos.
 *
 * Ya no existe la cola del validador: el pago **nace aprobado** cuando la
 * agencia lo registra (operador) o llega `reportado` si lo anota el cliente
 * como acuse. Quedan dos acciones correctivas: **anular** (revierte un pago
 * mal anotado) y **reembolsar** (devuelve parte o todo lo aprobado).
 */
@Injectable()
export class PagosService {
  constructor(
    @InjectRepository(Pago) private readonly pagos: Repository<Pago>,
    @InjectRepository(Reembolso) private readonly reembolsos: Repository<Reembolso>,
    @InjectRepository(Reserva) private readonly reservas: Repository<Reserva>,
  ) {}

  /** GET /admin/pagos — historial de pagos, filtrable por estado. */
  async cola(estado = 'aprobado') {
    const estados = estado.split(',') as EstadoPago[];
    const pagos = await this.pagos
      .createQueryBuilder('p')
      .where('p.estado IN (:...estados)', { estados })
      .orderBy('p.creado_en', 'ASC')
      .take(100)
      .getMany();
    return Promise.all(pagos.map((p) => this.enriquecer(p)));
  }

  async detalle(id: string) {
    const pago = await this.pagos.findOne({ where: { id } });
    if (!pago) throw ApiError.noEncontrado('Pago');
    const previos = await this.pagos.find({
      where: { reserva_id: pago.reserva_id },
      order: { creado_en: 'DESC' },
    });
    return { ...(await this.enriquecer(pago)), pagos_previos: previos };
  }

  async anular(id: string, motivo: string, usuarioId: string) {
    const pago = await this.obtenerPago(id);
    if (!['reportado', 'correccion_solicitada', 'aprobado'].includes(pago.estado)) {
      throw ApiError.transicionInvalida('Solo se anulan pagos aprobados, reportados o en corrección');
    }
    pago.estado = 'anulado';
    pago.ajuste_validador_motivo = motivo;
    pago.validado_por = usuarioId;
    pago.validado_en = new Date();
    await this.pagos.save(pago);
    await this.recalcularEstadoPago(pago.reserva_id);
    return this.detalle(id);
  }

  async registrarReembolso(id: string, dto: { monto_usd: number; metodo: string; referencia?: string; motivo: string; fecha: string }, usuarioId: string) {
    const pago = await this.obtenerPago(id);
    if (pago.estado !== 'aprobado') {
      throw ApiError.transicionInvalida('Solo se reembolsan pagos aprobados');
    }
    const yaReembolsado = await this.reembolsos
      .createQueryBuilder('r')
      .where('r.pago_id = :pid', { pid: pago.id })
      .getMany();
    const total = yaReembolsado.reduce((s, r) => s + Number(r.monto_usd), 0);
    if (total + dto.monto_usd > Number(pago.monto_usd_equivalente) + 0.001) {
      throw ApiError.validacion('El reembolso supera lo aprobado en este pago');
    }
    const reembolso = await this.reembolsos.save(
      this.reembolsos.create({
        pago_id: pago.id,
        reserva_id: pago.reserva_id,
        monto_usd: dto.monto_usd.toFixed(2),
        monto_pagado: dto.monto_usd.toFixed(2),
        moneda: pago.moneda,
        metodo: dto.metodo,
        referencia: dto.referencia ?? null,
        motivo: dto.motivo,
        registrado_por: usuarioId,
        fecha: dto.fecha,
      }),
    );
    await this.recalcularEstadoPago(pago.reserva_id);
    return reembolso;
  }

  /** Recalcula `estado_pago` derivado (spec 4.2) — nunca se edita a mano. */
  async recalcularEstadoPago(reservaId: string) {
    const reserva = await this.reservas.findOneByOrFail({ id: reservaId });
    const pagos = await this.pagos.find({ where: { reserva_id: reservaId } });
    const reembolsos = await this.reembolsos.find({ where: { reserva_id: reservaId } });

    const aprobado = pagos
      .filter((p) => p.estado === 'aprobado')
      .reduce((s, p) => s + Number(p.monto_usd_equivalente), 0);
    const reembolsado = reembolsos.reduce((s, r) => s + Number(r.monto_usd), 0);
    const reportados = pagos.some((p) => p.estado === 'reportado' || p.estado === 'correccion_solicitada');
    const total = Number(reserva.total_usd ?? 0);

    let estado: Reserva['estado_pago'];
    if (aprobado > 0 && reembolsado >= aprobado) estado = 'reembolsado';
    else if (aprobado - reembolsado >= total && total > 0) estado = 'pagado';
    else if (aprobado > 0) estado = 'parcial';
    else if (reportados) estado = 'reportado';
    else {
      const ultimo = pagos.sort((a, b) => b.creado_en.getTime() - a.creado_en.getTime())[0];
      estado = ultimo?.estado === 'rechazado' ? 'rechazado' : 'sin_pago';
    }

    reserva.aprobado_usd = aprobado.toFixed(2);
    reserva.reembolsado_usd = reembolsado.toFixed(2);
    reserva.estado_pago = estado;
    await this.reservas.save(reserva);
    return reserva;
  }

  private async obtenerPago(id: string) {
    const pago = await this.pagos.findOne({ where: { id } });
    if (!pago) throw ApiError.noEncontrado('Pago');
    return pago;
  }

  private async enriquecer(pago: Pago) {
    const reserva = await this.reservas.findOne({ where: { id: pago.reserva_id } });
    return {
      ...pago,
      reserva: reserva
        ? { id: reserva.id, ref_corta: reserva.ref_corta, codigo: reserva.codigo, estado: reserva.estado }
        : null,
      diferencia_usd: (Number(pago.monto_usd_equivalente) - Number(pago.esperado_usd)).toFixed(2),
    };
  }
}
