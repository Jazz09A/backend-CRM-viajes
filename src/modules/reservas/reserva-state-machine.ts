import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { randomBytes, randomUUID } from 'crypto';
import { hashToken, nuevoTokenEnlace } from '../../common/crypto.util';
import { ph } from '../../common/sql.util';
import {
  EnlaceReserva,
  OutboxEvento,
  Reserva,
  ReservaEstadoHistorial,
  Voucher,
} from '../../database/entities';
import { ActorTipo } from '../../database/entities/soporte.entities';
import { EstadoReserva } from '../../database/entities/reserva.entities';
import { ApiError } from '../../common/errors';
import { CuposService, OpcionCupo } from '../cupos/cupos.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';

export interface Actor {
  tipo: ActorTipo;
  id?: string | null;
}

export interface ContextoTransicion {
  requestId?: string;
  motivo?: string;
  datos?: Record<string, unknown>;
}

type EventoReserva =
  | 'iniciar_registro'
  | 'guardar_paso'
  | 'confirmar_resumen'
  | 'reabrir_edicion'
  | 'firmar'
  | 'reportar_pago'
  | 'resolver_pago'
  | 'cancelar'
  | 'expirar'
  | 'reactivar'
  | 'completar'
  | 'confirmar_pago';

interface Regla {
  desde: EstadoReserva[];
  hacia: EstadoReserva;
  /** Devuelve true si la transición es válida; lanza ApiError si no. */
  guarda?: (reserva: Reserva, ctx: ContextoTransicion) => boolean | Promise<boolean>;
  efectos?: (em: EntityManager, reserva: Reserva, ctx: ContextoTransicion) => Promise<void>;
}

/**
 * Regla de oro (spec 2.1): ningún controlador cambia `reserva.estado`.
 * Toda transición pasa por aquí: valida guardas, aplica efectos,
 * escribe historial y emite eventos al outbox — en una transacción.
 */
@Injectable()
export class ReservaStateMachine {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Reserva) private readonly reservas: Repository<Reserva>,
    @InjectRepository(EnlaceReserva) private readonly enlaces: Repository<EnlaceReserva>,
    @InjectRepository(ReservaEstadoHistorial) private readonly historial: Repository<ReservaEstadoHistorial>,
    private readonly cupos: CuposService,
    private readonly config: ConfiguracionService,
  ) {}

  private reglas: Record<EventoReserva, Regla> = {
    iniciar_registro: {
      desde: ['enlace_creado'],
      hacia: 'en_registro',
      efectos: async (em, r) => {
        const inactividad = Number((await this.config.obtener('inactividad_registro_h')) ?? 72);
        r.paso_registro = 'titular';
        r.expira_en = new Date(Date.now() + inactividad * 3600 * 1000);
        await em.save(Reserva, r);
      },
    },
    guardar_paso: {
      desde: ['en_registro'],
      hacia: 'en_registro',
      efectos: async (em, r) => {
        r.ultima_actividad_en = new Date();
        await em.save(Reserva, r);
      },
    },
    confirmar_resumen: {
      desde: ['en_registro'],
      hacia: 'pendiente_firma',
      efectos: async (em, r, ctx) => {
        // Toma el hold de cupos (D-03) — se ejecuta dentro de la tx.
        const n = Number(ctx.datos?.cupo_pasajeros ?? r.cupo_pasajeros ?? 1);
        const opciones = (ctx.datos?.cupo_opciones ?? r.cupo_opciones ?? []) as OpcionCupo[];
        const ok = await this.cupos.retener(r.fecha_tour_id, r.id, n, opciones, 'hold', ctx.requestId);
        if (!ok) {
          throw ApiError.validacion('No hay cupo disponible para esta fecha', [
            { campo: 'cupos', codigo: 'SIN_CUPO', mensaje: 'Sin cupo disponible' },
          ]);
        }
        const holdHoras = Number((await this.config.obtener('hold_horas')) ?? 24);
        r.cupo_estado = 'retenido';
        r.cupo_pasajeros = n;
        r.cupo_opciones = opciones;
        r.resumen_confirmado_en = new Date();
        r.expira_en = new Date(Date.now() + holdHoras * 3600 * 1000);
        r.paso_registro = null;
        await em.save(Reserva, r);
        await this.outbox(em, 'reserva.resumen_confirmado', { reserva_id: r.id });
      },
    },
    reabrir_edicion: {
      desde: ['pendiente_firma', 'pendiente_pago', 'pago_en_verificacion'],
      hacia: 'en_registro',
      guarda: (r) => !r.tiene_pago_por_validar,
      efectos: async (em, r) => {
        // Invalida la firma vigente (T4); el hold se conserva y se renueva.
        const d = this.ds.options.type as string;
        await em.query(
          `UPDATE firma SET vigente = ${ph(d, 0)}, invalidada_en = ${ph(d, 1)}, invalidada_motivo = ${ph(d, 2)} WHERE reserva_id = ${ph(d, 3)} AND vigente = ${ph(d, 4)}`,
          [0, new Date(), 'edicion_material', r.id, 1],
        );
        const holdHoras = Number((await this.config.obtener('hold_horas')) ?? 24);
        r.paso_registro = 'titular';
        r.resumen_confirmado_en = null;
        r.expira_en = new Date(Date.now() + holdHoras * 3600 * 1000);
        await em.save(Reserva, r);
      },
    },
    firmar: {
      desde: ['pendiente_firma'],
      hacia: 'pendiente_pago',
      efectos: async (em, r) => {
        await em.save(Reserva, r);
        await this.outbox(em, 'reserva.firmada', { reserva_id: r.id });
      },
    },
    reportar_pago: {
      desde: ['pendiente_pago', 'pago_en_verificacion'],
      hacia: 'pago_en_verificacion',
      efectos: async (em, r) => {
        r.tiene_pago_por_validar = true;
        // Congela el vencimiento del hold mientras haya pagos por validar (T5).
        r.hold_restante_seg = r.expira_en
          ? Math.max(0, Math.floor((r.expira_en.getTime() - Date.now()) / 1000))
          : null;
        r.expira_en = null;
        await em.save(Reserva, r);
        await this.outbox(em, 'pago.reportado', { reserva_id: r.id });
      },
    },
    resolver_pago: {
      desde: ['pago_en_verificacion'],
      hacia: 'pendiente_pago',
      efectos: async (em, r, ctx) => {
        r.tiene_pago_por_validar = false;
        // Reanuda el vencimiento restante del hold (T6) o lo convierte en venta
        // si el abono aprobado ≥ abono_minimo_pct (D-06) — lo decide el caller
        // vía ctx.datos.venta_definitiva.
        if (ctx.datos?.venta_definitiva) {
          r.expira_en = null;
          r.cupo_estado = 'vendido';
          await this.cupos.vender(r.fecha_tour_id, r.cupo_pasajeros);
        } else if (r.hold_restante_seg) {
          r.expira_en = new Date(Date.now() + r.hold_restante_seg * 1000);
          r.hold_restante_seg = null;
        }
        await em.save(Reserva, r);
      },
    },
    confirmar_pago: {
      desde: ['pago_en_verificacion', 'pendiente_pago'],
      hacia: 'confirmada',
      efectos: async (em, r) => {
        // Hold → venta + código VJ-AAAA-NNNNN (D-01) + voucher.
        if (r.cupo_estado === 'retenido') {
          r.cupo_estado = 'vendido';
          await this.cupos.vender(r.fecha_tour_id, r.cupo_pasajeros);
        }
        r.codigo = await this.asignarCodigo(em, r);
        r.verif_token = randomBytes(16).toString('base64url');
        r.expira_en = null;
        await em.save(Reserva, r);
        const voucher = await em.save(
          Voucher,
          em.create(Voucher, {
            reserva_id: r.id,
            version: 1,
            tipo: 'final',
            estado: 'generando',
            vigente: false,
          }),
        );
        await this.outbox(em, 'voucher.generar', { voucher_id: voucher.id, reserva_id: r.id });
        await this.outbox(em, 'reserva.confirmada', { reserva_id: r.id });
      },
    },
    cancelar: {
      desde: ['enlace_creado', 'en_registro', 'pendiente_firma', 'pendiente_pago', 'pago_en_verificacion', 'confirmada'],
      hacia: 'cancelada',
      efectos: async (em, r, ctx) => {
        if (r.cupo_estado === 'retenido' || r.cupo_estado === 'vendido') {
          await this.cupos.liberar(r.fecha_tour_id, r.id, r.cupo_pasajeros, r.cupo_opciones, 'liberacion', undefined);
          r.cupo_estado = 'liberado';
        }
        r.cancelada_en = new Date();
        r.cancelacion_origen = (ctx.datos?.origen as never) ?? 'agencia';
        r.cancelacion_motivo = ctx.motivo ?? null;
        r.expira_en = null;
        // Revocar enlaces vigentes.
        const d = this.ds.options.type as string;
        await em.query(
          `UPDATE enlace_reserva SET estado = ${ph(d, 0)}, revocado_en = ${ph(d, 1)} WHERE reserva_id = ${ph(d, 2)} AND estado IN (${ph(d, 3)}, ${ph(d, 4)})`,
          ['revocado', new Date(), r.id, 'vigente', 'usado'],
        );
        await em.save(Reserva, r);
        // Invalidar vouchers vigentes: el QR debe reportar la cancelación.
        const dV = this.ds.options.type as string;
        await em.query(
          `UPDATE voucher SET vigente = ${ph(dV, 0)}, estado = ${ph(dV, 1)} WHERE reserva_id = ${ph(dV, 2)} AND vigente = ${ph(dV, 3)}`,
          [false, 'invalidado', r.id, true],
        );
        await this.outbox(em, 'reserva.cancelada', { reserva_id: r.id });
      },
    },
    expirar: {
      desde: ['enlace_creado', 'en_registro', 'pendiente_firma', 'pendiente_pago'],
      hacia: 'expirada',
      efectos: async (em, r) => {
        if (r.cupo_estado === 'retenido') {
          await this.cupos.liberar(r.fecha_tour_id, r.id, r.cupo_pasajeros, r.cupo_opciones, 'liberacion', undefined);
          r.cupo_estado = 'liberado';
        }
        r.expira_en = null;
        const d = this.ds.options.type as string;
        await em.query(
          `UPDATE enlace_reserva SET estado = ${ph(d, 0)}, revocado_en = ${ph(d, 1)} WHERE reserva_id = ${ph(d, 2)} AND estado IN (${ph(d, 3)}, ${ph(d, 4)})`,
          ['revocado', new Date(), r.id, 'vigente', 'usado'],
        );
        await em.save(Reserva, r);
      },
    },
    reactivar: {
      desde: ['expirada'],
      hacia: 'enlace_creado',
      efectos: async (em, r) => {
        r.expira_en = null;
        r.cupo_estado = 'ninguno';
        await em.save(Reserva, r);
      },
    },
    completar: {
      desde: ['confirmada'],
      hacia: 'completada',
      efectos: async (em, r) => {
        await em.save(Reserva, r);
      },
    },
  };

  /**
   * Ejecuta una transición de estado dentro de una transacción.
   * Lanza ApiError(TRANSICION_INVALIDA) si el estado actual no permite el evento.
   */
  async transicionar(
    reservaId: string,
    evento: EventoReserva,
    actor: Actor,
    ctx: ContextoTransicion = {},
  ): Promise<Reserva> {
    const regla = this.reglas[evento];
    if (!regla) throw ApiError.transicionInvalida(`Evento desconocido: ${evento}`);

    return this.ds.transaction(async (em) => {
      const reserva = await em.findOne(Reserva, {
        where: { id: reservaId },
        // SQLite no soporta FOR UPDATE; la atomicidad la da la transacción.
        lock: this.ds.options.type === 'postgres' ? { mode: 'pessimistic_write' } : undefined,
      });
      if (!reserva) throw ApiError.noEncontrado('Reserva');

      if (!regla.desde.includes(reserva.estado)) {
        throw ApiError.transicionInvalida(
          `No se puede ${evento} una reserva en estado ${reserva.estado}`,
        );
      }
      if (regla.guarda && !(await regla.guarda(reserva, ctx))) {
        throw ApiError.transicionInvalida('Condición de transición no cumplida');
      }

      const desde = reserva.estado;
      const hacia = regla.hacia;
      reserva.estado = hacia;
      reserva.version += 1;
      reserva.actualizado_en = new Date();
      reserva.ultima_actividad_en = new Date();

      if (regla.efectos) await regla.efectos(em, reserva, ctx);
      else await em.save(Reserva, reserva);

      await em.save(ReservaEstadoHistorial, {
        reserva_id: reserva.id,
        desde,
        hasta: hacia,
        evento,
        actor_tipo: actor.tipo,
        actor_id: actor.id ?? null,
        motivo: ctx.motivo ?? null,
        request_id: ctx.requestId ?? null,
        creado_en: new Date(),
      } as ReservaEstadoHistorial);

      return reserva;
    });
  }

  /** Genera enlace de acceso para una reserva (token en claro solo una vez). */
  async crearEnlace(reservaId: string, usuarioId: string, vigenteHoras?: number) {
    const reserva = await this.reservas.findOne({ where: { id: reservaId } });
    if (!reserva) throw ApiError.noEncontrado('Reserva');
    const horas = vigenteHoras ?? Number((await this.config.obtener('enlace_vigencia_h')) ?? 72);
    const { token, hash } = nuevoTokenEnlace();
    const enlace = await this.enlaces.save(
      this.enlaces.create({
        reserva_id: reservaId,
        token_hash: hash,
        estado: 'vigente',
        expira_en: new Date(Date.now() + horas * 3600 * 1000),
        creado_por: usuarioId,
      }),
    );
    return { enlace, token };
  }

  /** Resuelve el token del cliente → reserva (sin exponer IDs, spec 7). */
  async resolverPorToken(token: string) {
    const enlace = await this.enlaces.findOne({ where: { token_hash: hashToken(token) } });
    if (!enlace || enlace.estado === 'revocado') throw ApiError.enlaceInvalido();
    if (enlace.estado === 'vencido' || enlace.expira_en < new Date()) {
      enlace.estado = 'vencido';
      await this.enlaces.save(enlace);
      const whatsapp = (await this.config.obtener('whatsapp_agencia')) as string | null;
      throw ApiError.enlaceVencido(whatsapp ?? undefined);
    }
    const reserva = await this.reservas.findOne({ where: { id: enlace.reserva_id } });
    if (!reserva) throw ApiError.enlaceInvalido();
    return { enlace, reserva };
  }

  private async asignarCodigo(em: EntityManager, reserva: Reserva): Promise<string> {
    const anio = new Date().getFullYear();
    const d = this.ds.options.type as string;
    // Contador por año bloqueado dentro de la transacción (D-01).
    await em.query(
      `INSERT INTO contador_codigo (anio, ultimo) VALUES (${ph(d, 0)}, 0)
       ON CONFLICT(anio) DO NOTHING`,
      [anio],
    );
    const res = await em.query(
      `UPDATE contador_codigo SET ultimo = ultimo + 1 WHERE anio = ${ph(d, 0)} RETURNING ultimo`,
      [anio],
    );
    const fila = (Array.isArray(res) ? res[0] : res) as { ultimo?: number } | undefined;
    const ultimo = Array.isArray(fila) ? fila[0]?.ultimo : fila?.ultimo;
    const n = typeof ultimo === 'number' ? ultimo : Number(ultimo ?? 1);
    return `VJ-${anio}-${String(n).padStart(5, '0')}`;
  }

  private async outbox(em: EntityManager, tipo: string, payload: Record<string, unknown>) {
    await em.save(OutboxEvento, {
      tipo,
      payload,
      estado: 'pendiente',
      intentos: 0,
      proximo_intento: new Date(),
      creado_en: new Date(),
    } as OutboxEvento);
  }
}
