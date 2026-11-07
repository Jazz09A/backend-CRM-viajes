import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Pago, Reembolso, Reserva } from '../../database/entities';
import { ApiError } from '../../common/errors';
import { ReservaStateMachine } from '../reservas/reserva-state-machine';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { AprobarPagoDto, RechazarPagoDto, SolicitarCorreccionDto } from './pagos.dto';
import { EstadoPago } from '../../database/entities/operacion.entities';

/** Cola del validador y ciclo de vida de pagos (spec 6.6, T5–T7). */
@Injectable()
export class PagosService {
  constructor(
    @InjectRepository(Pago) private readonly pagos: Repository<Pago>,
    @InjectRepository(Reembolso) private readonly reembolsos: Repository<Reembolso>,
    @InjectRepository(Reserva) private readonly reservas: Repository<Reserva>,
    private readonly stateMachine: ReservaStateMachine,
    private readonly config: ConfiguracionService,
  ) {}

  /** GET /admin/pagos — cola FIFO de pagos por validar. */
  async cola(estado = 'reportado,correccion_solicitada') {
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

  /** POST /admin/pagos/:id/aprobar — VAL/SA (T6/T7). */
  async aprobar(id: string, dto: AprobarPagoDto, usuarioId: string) {
    const pago = await this.obtenerPago(id);
    if (!['reportado', 'correccion_solicitada'].includes(pago.estado)) {
      throw ApiError.transicionInvalida(`No se puede aprobar un pago en estado ${pago.estado}`);
    }
    if (pago.duplicado_de_pago_id && !dto.confirmar_duplicado) {
      throw new ApiError(422, 'DUPLICADO_REQUIERE_CONFIRMACION',
        'Este pago parece duplicado. Confirma con motivo para aprobarlo.');
    }

    const montoValidado = dto.monto_validado ?? Number(pago.monto);
    const tolerancia = Number((await this.config.obtener('tolerancia_monto_pct')) ?? 1);
    const diffPct = Math.abs(montoValidado - Number(pago.monto_reportado)) / Number(pago.monto_reportado) * 100;
    if (diffPct > tolerancia && !dto.ajuste_motivo) {
      throw ApiError.validacion('La diferencia de monto exige un motivo de ajuste');
    }

    pago.estado = 'aprobado';
    pago.monto = montoValidado.toFixed(2);
    // `monto`/`monto_validado` ya vienen en USD-equivalente (el cliente envía el
    // equivalente en USD y el monto en bolívares viaja en campos_extra).
    pago.monto_usd_equivalente = montoValidado.toFixed(2);
    pago.validado_por = usuarioId;
    pago.validado_en = new Date();
    pago.ajuste_validador_motivo = dto.ajuste_motivo ?? null;
    if (dto.confirmar_duplicado) {
      pago.duplicado_confirmado = true;
      pago.duplicado_motivo = dto.duplicado_motivo ?? null;
    }
    await this.pagos.save(pago);

    await this.recalcularEstadoPago(pago.reserva_id);
    const reserva = await this.reservas.findOneByOrFail({ id: pago.reserva_id });

    // Saldo cubierto → confirmada (T7). Si no, vuelve a pendiente_pago (T6).
    const saldo = Number(reserva.total_usd ?? 0) - (Number(reserva.aprobado_usd) - Number(reserva.reembolsado_usd));
    if (saldo <= 0.005 && reserva.estado === 'pago_en_verificacion') {
      return this.stateMachine.transicionar(reserva.id, 'confirmar_pago', { tipo: 'usuario', id: usuarioId });
    }
    // Abono mínimo → venta definitiva (D-06).
    const pct = (Number(reserva.aprobado_usd) / Number(reserva.total_usd ?? 1)) * 100;
    const minimo = Number((await this.config.obtener('abono_minimo_pct')) ?? 50);
    return this.stateMachine.transicionar(reserva.id, 'resolver_pago', { tipo: 'usuario', id: usuarioId }, {
      datos: { venta_definitiva: pct >= minimo },
    });
  }

  async rechazar(id: string, dto: RechazarPagoDto, usuarioId: string) {
    const pago = await this.obtenerPago(id);
    if (!['reportado', 'correccion_solicitada'].includes(pago.estado)) {
      throw ApiError.transicionInvalida(`No se puede rechazar un pago en estado ${pago.estado}`);
    }
    pago.estado = 'rechazado';
    pago.motivo_rechazo_codigo = dto.motivo_codigo;
    pago.motivo_rechazo_texto = dto.motivo_texto ?? null;
    pago.validado_por = usuarioId;
    pago.validado_en = new Date();
    await this.pagos.save(pago);

    await this.recalcularEstadoPago(pago.reserva_id);
    const reserva = await this.reservas.findOneByOrFail({ id: pago.reserva_id });
    if (reserva.estado === 'pago_en_verificacion') {
      return this.stateMachine.transicionar(reserva.id, 'resolver_pago', { tipo: 'usuario', id: usuarioId });
    }
    return reserva;
  }

  async solicitarCorreccion(id: string, dto: SolicitarCorreccionDto, usuarioId: string) {
    const pago = await this.obtenerPago(id);
    if (!['reportado', 'correccion_solicitada'].includes(pago.estado)) {
      throw ApiError.transicionInvalida('El pago no admite corrección');
    }
    pago.estado = 'correccion_solicitada';
    pago.correccion_texto = dto.texto;
    await this.pagos.save(pago);
    return this.detalle(id);
  }

  async anular(id: string, motivo: string, usuarioId: string) {
    const pago = await this.obtenerPago(id);
    if (!['reportado', 'correccion_solicitada'].includes(pago.estado)) {
      throw ApiError.transicionInvalida('Solo se anulan pagos reportados o en corrección');
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
    reserva.tiene_pago_por_validar = reportados;
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
