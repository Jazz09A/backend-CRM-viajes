import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { afectados, filas, max2, ph } from '../../common/sql.util';
import { ExportacionesService } from '../exportaciones/exportaciones.service';
import { VouchersService } from '../vouchers/vouchers.service';
import { NotificacionesService } from '../notificaciones/notificaciones.service';

/**
 * Trabajos en segundo plano (spec 11). En producción se delegan a un worker
 * con BullMQ/Redis; aquí corre un loop ligero sobre la misma base para
 * desarrollo y pruebas.
 */
@Injectable()
export class JobsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    private readonly vouchersService: VouchersService,
    private readonly exportacionesService: ExportacionesService,
    private readonly notificaciones: NotificacionesService,
  ) {}

  onModuleInit() {
    // Tick cada 60 s en desarrollo; en producción esto lo hace el worker.
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick() {
    if (this.running) return;
    this.running = true;
    try {
      await this.expirarReservas();
      await this.procesarOutbox();
      await this.completarViajes();
      await this.exportacionesService.expirarAntiguas();
    } catch (e) {
      this.logger.error('Error en jobs', (e as Error).stack);
    } finally {
      this.running = false;
    }
  }

  /** T10: expira reservas con expira_en vencido y libera sus holds. */
  private async expirarReservas() {
    const d = this.ds.options.type as string;
    const candidatas = filas<{ id: string }>(
      d,
      await this.ds.query(
        `SELECT id FROM reserva
         WHERE expira_en IS NOT NULL AND expira_en < ${ph(d, 0)}
           AND estado IN ('enlace_creado','en_registro','pendiente_firma','pendiente_pago')`,
        [new Date().toISOString()],
      ),
    );
    if (!candidatas.length) return;
    // La transición real pasa por ReservaStateMachine; el loop de desarrollo
    // marca el outbox para que el worker lo procese con la máquina de estados.
    for (const c of candidatas) {
      const res = await this.ds.query(
        `INSERT INTO outbox_evento (tipo, payload, estado, intentos, proximo_intento, creado_en)
         VALUES (${ph(d, 0)}, ${ph(d, 1)}, 'pendiente', 0, ${ph(d, 2)}, ${ph(d, 3)})`,
        ['reserva.expirar', JSON.stringify({ reserva_id: c.id }), new Date().toISOString(), new Date().toISOString()],
      );
      void res;
    }
    this.logger.log(`Outbox: ${candidatas.length} reservas por expirar`);
  }

  /** Despacha eventos del outbox transaccional (spec 2). */
  private async procesarOutbox() {
    const d = this.ds.options.type as string;
    const pendientes = filas<{ id: number; tipo: string; payload: string }>(
      d,
      await this.ds.query(
        `SELECT id, tipo, payload FROM outbox_evento
         WHERE estado IN ('pendiente','fallido') AND proximo_intento <= ${ph(d, 0)}
         ORDER BY id LIMIT 20`,
        [new Date().toISOString()],
      ),
    );
    for (const ev of pendientes) {
      try {
        await this.despachar(ev.tipo, JSON.parse(ev.payload));
        await this.ds.query(
          `UPDATE outbox_evento SET estado = ${ph(d, 0)} WHERE id = ${ph(d, 1)}`,
          ['procesado', ev.id],
        );
        await this.notificarTrabajo(ev.tipo, JSON.parse(ev.payload) as Record<string, unknown>);
      } catch (e) {
        this.logger.warn(`Outbox ${ev.id} (${ev.tipo}) falló: ${(e as Error).message}`);
        await this.ds.query(
          `UPDATE outbox_evento SET intentos = intentos + 1, estado = ${ph(d, 0)}, proximo_intento = ${ph(d, 1)} WHERE id = ${ph(d, 2)}`,
          ['pendiente', new Date(Date.now() + 60_000).toISOString(), ev.id],
        );
      }
    }
  }

  private async despachar(tipo: string, payload: Record<string, unknown>) {
    switch (tipo) {
      case 'voucher.generar': {
        const voucherId = payload.voucher_id as string;
        if (!voucherId) {
          this.logger.warn('voucher.generar sin voucher_id');
          break;
        }
        this.logger.log(`Procesando voucher ${voucherId} para reserva ${payload.reserva_id}`);
        await this.vouchersService.procesarVoucher(voucherId);
        break;
      }
      case 'exportacion.generar': {
        const exportacionId = payload.exportacion_id as string;
        if (!exportacionId) {
          this.logger.warn('exportacion.generar sin exportacion_id');
          break;
        }
        this.logger.log(`Procesando exportación ${exportacionId}`);
        await this.exportacionesService.procesar(exportacionId);
        break;
      }
      case 'reserva.confirmada':
      case 'reserva.cancelada':
      case 'pago.reportado':
      case 'reserva.firmada':
      case 'reserva.resumen_confirmado':
        // TODO: enviar correo/WhatsApp según plantilla_mensaje.
        this.logger.log(`${tipo} → reserva ${payload.reserva_id}`);
        break;
      case 'reserva.expirar': {
        // Transición real vía state machine — inyectada por el módulo jobs
        // para evitar dependencia circular.
        const reservaId = payload.reserva_id as string;
        const r = filas<{ estado: string }>(
          this.ds.options.type as string,
          await this.ds.query(`SELECT estado FROM reserva WHERE id = ${ph(this.ds.options.type as string, 0)}`, [reservaId]),
        )[0];
        if (r && ['enlace_creado', 'en_registro', 'pendiente_firma', 'pendiente_pago'].includes(r.estado)) {
          await this.stateMachineExpirar(reservaId);
        }
        break;
      }
      default:
        this.logger.warn(`Evento outbox desconocido: ${tipo}`);
    }
  }

  /**
   * Avisa al panel (campana) cuando un trabajo del worker termina.
   * Los eventos que solo encolan correos/WhatsApp no generan notificación.
   */
  private async notificarTrabajo(tipo: string, payload: Record<string, unknown>) {
    try {
      const reservaId = payload.reserva_id as string | undefined;
      const codigoReserva = reservaId ? await this.codigoReserva(reservaId) : null;

      switch (tipo) {
        case 'voucher.generar':
          await this.notificaciones.crear({
            rol: 'todos',
            tipo: 'reserva',
            titulo: 'Voucher generado',
            cuerpo: codigoReserva ? `El voucher de la reserva ${codigoReserva} está listo para descargar.` : 'Un voucher terminó de generarse.',
            datos: { entidad_id: reservaId },
          });
          break;
        case 'exportacion.generar': {
          const exportacionId = payload.exportacion_id as string | undefined;
          const detalle = await this.detalleExportacion(exportacionId);
          await this.notificaciones.crear({
            rol: 'todos',
            tipo: 'sistema',
            titulo: 'Exportación lista',
            cuerpo: detalle,
            datos: { entidad_id: exportacionId },
          });
          break;
        }
        case 'reserva.expirar':
          await this.notificaciones.crear({
            rol: 'todos',
            tipo: 'reserva',
            titulo: 'Reserva expirada',
            cuerpo: codigoReserva ? `La reserva ${codigoReserva} expiró y su cupo fue liberado.` : 'Una reserva expiró y su cupo fue liberado.',
            datos: { entidad_id: reservaId },
          });
          break;
      }
    } catch (e) {
      // La notificación nunca debe romper el procesamiento del outbox.
      this.logger.warn(`No se pudo notificar ${tipo}: ${(e as Error).message}`);
    }
  }

  private async codigoReserva(reservaId: string): Promise<string | null> {
    const d = this.ds.options.type as string;
    const rows = filas<{ codigo: string | null; ref_corta: string | null }>(
      d,
      await this.ds.query(`SELECT codigo, ref_corta FROM reserva WHERE id = ${ph(d, 0)}`, [reservaId]),
    );
    const r = rows[0];
    return r?.codigo ?? r?.ref_corta ?? null;
  }

  private async detalleExportacion(exportacionId: string | undefined): Promise<string> {
    if (!exportacionId) return 'Una exportación terminó de generarse.';
    const d = this.ds.options.type as string;
    const rows = filas<{ tipo: string; nombre_archivo: string | null }>(
      d,
      await this.ds.query(`SELECT tipo, nombre_archivo FROM exportacion WHERE id = ${ph(d, 0)}`, [exportacionId]),
    );
    const e = rows[0];
    return e ? `La exportación ${e.tipo}${e.nombre_archivo ? ` (${e.nombre_archivo})` : ''} está lista para descargar.` : 'Una exportación terminó de generarse.';
  }

  private async stateMachineExpirar(reservaId: string) {
    // El worker completo usará ReservaStateMachine.transicionar('expirar').
    // Aquí se hace el UPDATE directo solo en desarrollo.
    const d = this.ds.options.type as string;
    await this.ds.transaction(async (em) => {
      const reserva = filas<{ cupo_estado: string; cupo_pasajeros: number; fecha_tour_id: string; cupo_opciones: string }>(
        d,
        await em.query(`SELECT cupo_estado, cupo_pasajeros, fecha_tour_id, cupo_opciones FROM reserva WHERE id = ${ph(d, 0)}`, [reservaId]),
      )[0];
      if (!reserva) return;
      if (reserva.cupo_estado === 'retenido') {
        const n = reserva.cupo_pasajeros;
        await em.query(
          `UPDATE fecha_tour SET cupos_retenidos = ${max2(d, `cupos_retenidos - ${ph(d, 0)}`, '0')} WHERE id = ${ph(d, 1)}`,
          [n, reserva.fecha_tour_id],
        );
      }
      const upd = await em.query(
        `UPDATE reserva SET estado = ${ph(d, 0)}, cupo_estado = ${ph(d, 1)}, expira_en = NULL, version = version + 1 WHERE id = ${ph(d, 2)}`,
        ['expirada', 'liberado', reservaId],
      );
      void afectados(d, upd);
      await em.query(
        `UPDATE enlace_reserva SET estado = ${ph(d, 0)}, revocado_en = ${ph(d, 1)} WHERE reserva_id = ${ph(d, 2)} AND estado IN (${ph(d, 3)}, ${ph(d, 4)})`,
        ['revocado', new Date().toISOString(), reservaId, 'vigente', 'usado'],
      );
    });
  }

  /** T8: reservas confirmadas cuya salida + 1 día ya pasó → completada. */
  private async completarViajes() {
    const d = this.ds.options.type as string;
    // fecha_salida es 'YYYY-MM-DD' (texto ISO): comparación lexicográfica
    // portable entre SQLite y Postgres.
    const corte = new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const res = await this.ds.query(
      `UPDATE reserva SET estado = ${ph(d, 0)}, version = version + 1
       WHERE estado = ${ph(d, 1)}
         AND fecha_tour_id IN (
           SELECT id FROM fecha_tour WHERE fecha_salida < ${ph(d, 2)}
         )`,
      ['completada', 'confirmada', corte],
    );
    void afectados(d, res);
  }
}
