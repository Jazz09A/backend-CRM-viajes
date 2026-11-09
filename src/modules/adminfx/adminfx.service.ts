import { Injectable, HttpStatus } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import { createHash } from 'crypto';
import {
  AuditLog,
  Cliente,
  CodigoPromocional,
  CupoOpcion,
  EnlaceReserva,
  FechaTour,
  Firma,
  MetodoPago,
  NotificacionPanel,
  Pasajero,
  Pago,
  PlantillaMensaje,
  PlantillaTerminos,
  PlantillaTerminosVersion,
  PoliticaCancelacion,
  Reembolso,
  Reserva,
  ReservaAjuste,
  ReservaLinea,
  TasaCambio,
  Tarifa,
  Tour,
  TourFormVersion,
  TourPuntoAbordaje,
  Usuario,
  Voucher,
} from '../../database/entities';
import { ApiError } from '../../common/errors';
import { hashPassword, sha256Hex } from '../../common/crypto.util';
import { descifrarONull } from '../../common/datos-sensibles';
import { ArchivosService } from '../archivos/archivos.service';
import { ReservasService } from '../reservas/reservas.service';
import { PagosService } from '../pagos/pagos.service';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { CuposService } from '../cupos/cupos.service';
import { FechasService } from '../fechas/fechas.service';
import { ToursService } from '../tours/tours.service';
import { calcularPrecioAdministrado } from '../reservas/domain';
import {
  CATEGORIA_A_BE,
  CATEGORIA_A_FE,
  auditoriaPublica,
  configPublica,
  fechaPublica,
  firmaPublica,
  formularioPublico,
  metodoPagoPublico,
  notificacionPublica,
  pasajeroAdmin,
  pagoPublico,
  pasoActualDe,
  politicaPublica,
  promoPublica,
  tarifaPublica,
  tasaPublica,
  terminosPublico,
  tourPublico,
  voucherPublico,
} from '../publico/serializers';

const iso = (d?: Date | string | null) => (d ? new Date(d).toISOString() : null);
const num = (v: unknown) => Number(v ?? 0);

/** Mapeo rol backend → código del frontend. */
const ROL_A_FE: Record<string, string> = {
  superadmin: 'SA',
  operador: 'OP',
  validador: 'VAL',
  guia: 'GU',
};
const ROL_A_BE: Record<string, string> = { SA: 'superadmin', OP: 'operador', VAL: 'validador', GU: 'guia' };

@Injectable()
export class AdminFxService {
  constructor(
    @InjectRepository(Reserva) private readonly reservaRepo: Repository<Reserva>,
    @InjectRepository(Cliente) private readonly clienteRepo: Repository<Cliente>,
    @InjectRepository(EnlaceReserva) private readonly enlaces: Repository<EnlaceReserva>,
    @InjectRepository(Pasajero) private readonly pasajeros: Repository<Pasajero>,
    @InjectRepository(FechaTour) private readonly fechaRepo: Repository<FechaTour>,
    @InjectRepository(Tarifa) private readonly tarifas: Repository<Tarifa>,
    @InjectRepository(CupoOpcion) private readonly cuposOpcion: Repository<CupoOpcion>,
    @InjectRepository(Tour) private readonly tourRepo: Repository<Tour>,
    @InjectRepository(TourPuntoAbordaje) private readonly puntos: Repository<TourPuntoAbordaje>,
    @InjectRepository(TourFormVersion) private readonly formVersions: Repository<TourFormVersion>,
    @InjectRepository(MetodoPago) private readonly metodos: Repository<MetodoPago>,
    @InjectRepository(Pago) private readonly pagoRepo: Repository<Pago>,
    @InjectRepository(Reembolso) private readonly reembolsos: Repository<Reembolso>,
    @InjectRepository(ReservaAjuste) private readonly ajustes: Repository<ReservaAjuste>,
    @InjectRepository(ReservaLinea) private readonly lineasRepo: Repository<ReservaLinea>,
    @InjectRepository(Firma) private readonly firmas: Repository<Firma>,
    @InjectRepository(Voucher) private readonly vouchers: Repository<Voucher>,
    @InjectRepository(TasaCambio) private readonly tasas: Repository<TasaCambio>,
    @InjectRepository(PlantillaTerminos) private readonly plantillasTerminos: Repository<PlantillaTerminos>,
    @InjectRepository(PlantillaTerminosVersion) private readonly terminosVersiones: Repository<PlantillaTerminosVersion>,
    @InjectRepository(PoliticaCancelacion) private readonly politicas: Repository<PoliticaCancelacion>,
    @InjectRepository(PlantillaMensaje) private readonly plantillas: Repository<PlantillaMensaje>,
    @InjectRepository(CodigoPromocional) private readonly promos: Repository<CodigoPromocional>,
    @InjectRepository(Usuario) private readonly usuarios: Repository<Usuario>,
    @InjectRepository(AuditLog) private readonly auditoriaRepo: Repository<AuditLog>,
    @InjectRepository(NotificacionPanel) private readonly notificacionRepo: Repository<NotificacionPanel>,
    private readonly reservasService: ReservasService,
    private readonly pagosService: PagosService,
    private readonly configService: ConfiguracionService,
    private readonly cupos: CuposService,
    private readonly fechasService: FechasService,
    private readonly toursService: ToursService,
    private readonly archivosService: ArchivosService,
  ) {}

  // =========================================================================
  // Serializers admin → contrato frontend
  // =========================================================================

  private usuarioFe(u: Usuario): Record<string, unknown> {
    return {
      id: u.id,
      nombre: u.nombre,
      correo: u.correo,
      rol: ROL_A_FE[u.roles?.[0] ?? ''] ?? 'OP',
      dos_factores_activo: u.dos_fa_activo,
      activo: u.activo,
    };
  }

  private async contextoReserva(r: Reserva) {
    const [fecha, pasajeros, firma, voucher, ajustes, lineas] = await Promise.all([
      this.fechaRepo.findOne({ where: { id: r.fecha_tour_id } }),
      this.pasajeros.find({ where: { reserva_id: r.id }, order: { orden: 'ASC' } }),
      this.firmas.findOne({ where: { reserva_id: r.id, vigente: true }, order: { creado_en: 'DESC' } }),
      this.vouchers.findOne({ where: { reserva_id: r.id }, order: { creado_en: 'DESC' } }),
      this.ajustes.find({ where: { reserva_id: r.id, anulado_en: IsNull() } }),
      this.lineasRepo.find({ where: { reserva_id: r.id, tipo: 'extra' }, order: { creado_en: 'ASC' } }),
    ]);
    const tour = fecha ? await this.tourRepo.findOne({ where: { id: fecha.tour_id } }) : null;
    return { fecha, pasajeros, firma, voucher, ajustes, lineas, tour };
  }

  /** Reserva en formato frontend (datos sensibles enmascarados). */
  async reservaFe(r: Reserva, opts: { conDetalle?: boolean } = {}): Promise<Record<string, unknown>> {
    const { fecha, pasajeros, firma, voucher, ajustes, lineas, tour } = await this.contextoReserva(r);
    const fechaSalida = fecha?.fecha_salida ?? '';
    const tarifas = fecha ? await this.tarifas.find({ where: { fecha_tour_id: fecha.id } }) : [];
    const total = num(r.total_usd);
    const neto = num(r.aprobado_usd) - num(r.reembolsado_usd);
    const saldo = Math.max(0, total - neto).toFixed(2);
    const titular = pasajeros.find((p) => p.es_titular);
    const promoAjuste = ajustes.find((a) => a.origen === 'promo' && a.tipo === 'descuento');
    let promocion: Record<string, unknown> | null = null;
    if (promoAjuste?.codigo_promocional_id) {
      const promo = await this.promos.findOne({ where: { id: promoAjuste.codigo_promocional_id } });
      if (promo) {
        promocion = {
          codigo: promo.codigo,
          tipo: promo.tipo,
          valor: num(promo.valor),
          descuento_usd: String(promoAjuste.monto_usd),
        };
      }
    }
    const pagos = opts.conDetalle ? await this.pagosDeReserva(r.id) : [];
    const out: Record<string, unknown> = {
      id: r.id,
      codigo: r.codigo ?? r.ref_corta,
      ref_corta: r.ref_corta,
      tour_id: tour?.id ?? '',
      fecha_tour_id: r.fecha_tour_id,
      formulario_id: r.form_version_id ?? '',
      estado: r.estado,
      estado_pago: r.estado_pago,
      pasajeros: pasajeros.map((p) =>
        opts.conDetalle
          ? this.pasajeroDetalle(p)
          : (pasajeroAdmin(p) as Record<string, unknown>),
      ),
      respuestas_globales: (r.respuestas_globales ?? {}) as Record<string, unknown>,
      total_usd: (r.total_usd ?? '0.00').toString(),
      subtotal_usd: (r.subtotal_usd ?? '0.00').toString(),
      adicionales_usd: (r.adicionales_usd ?? '0.00').toString(),
      descuentos_usd: (r.descuentos_usd ?? '0.00').toString(),
      saldo_usd: saldo,
      precio_lineas: lineas.map((l) => ({
        id: l.id,
        concepto: l.concepto,
        cantidad: l.cantidad,
        precio_unit_usd: String(l.precio_unit_usd),
        subtotal_usd: String(l.subtotal_usd),
      })),
      precio_ajustes: ajustes.map((a) => ({
        id: a.id,
        tipo: a.tipo,
        monto_usd: String(a.monto_usd),
        origen: a.origen,
        motivo: a.motivo,
      })),
      desglose: (r.desglose ?? null) as Record<string, unknown> | null,
      tasa_aplicada: null,
      expira_en: iso(r.expira_en),
      version: r.version,
      paso_actual: pasoActualDe(r),
      ...(r.referencia_interna ? { referencia_interna: r.referencia_interna } : {}),
      ...(r.requiere_accion || r.requiere_accion_motivo
        ? { requiere_accion: r.requiere_accion_motivo ?? 'Acción requerida' }
        : {}),
      ...(r.estado === 'cancelada' || r.estado === 'expirada'
        ? { motivo_cierre: r.estado === 'expirada' ? 'expiracion' : (r.cancelacion_origen ?? 'agencia') }
        : {}),
      ...(r.terminos_version_id || firma?.terminos_version_id
        ? { terminos_version_id: r.terminos_version_id ?? firma?.terminos_version_id }
        : {}),
      ...(firma
        ? {
            firma: {
              ...firmaPublica(firma),
              ...(opts.conDetalle ? await this.firmaImagenAdmin(firma) : {}),
            },
          }
        : {}),
      ...(voucher
        ? { voucher: voucherPublico(voucher, '', r.verif_token ?? '') }
        : {}),
      ...(promocion ? { promocion } : {}),
      creado_en: iso(r.creado_en) ?? new Date().toISOString(),
      ultima_actividad_en: iso(r.ultima_actividad_en) ?? new Date().toISOString(),
      tour_nombre: tour?.nombre ?? '',
      fecha_salida: fechaSalida || null,
      hora_salida: fecha?.hora_salida ?? null,
      titular_nombre: titular?.nombre ?? '',
      titular: titular ? (opts.conDetalle ? this.pasajeroDetalle(titular) : (pasajeroAdmin(titular) as Record<string, unknown>)) : null,
      acompanantes: pasajeros
        .filter((p) => !p.es_titular)
        .map((p) => (opts.conDetalle ? this.pasajeroDetalle(p) : (pasajeroAdmin(p) as Record<string, unknown>))),
      respuestas: (r.respuestas_globales ?? {}) as Record<string, unknown>,
      created_at: iso(r.creado_en) ?? undefined,
      updated_at: iso(r.actualizado_en) ?? undefined,
    };
    void tarifas;
    void fechaSalida;
    if (opts.conDetalle) {
      out.pagos = pagos;
      out.tour = tour ? await this.tourFe(tour) : null;
      out.fecha = fecha ? await this.fechaFe(fecha) : null;
      out.terminos = await this.terminosVersionFe(r.terminos_version_id ?? firma?.terminos_version_id ?? null);
      out.auditoria = await this.auditoriaDe('reserva', r.id);
    }
    return out;
  }

  /**
   * URL firmada de la imagen de la firma del cliente (panel admin).
   *
   * El archivo puede faltar en el storage (p. ej. se perdió en un redeploy
   * del contenedor): se responde `imagen_disponible: false` para que el panel
   * avise en vez de mostrar una imagen rota.
   */
  private async firmaImagenAdmin(
    firma: Firma,
  ): Promise<{ imagen_url: string; imagen_disponible: boolean }> {
    if (!firma.archivo_id) return { imagen_url: '', imagen_disponible: false };
    try {
      if (!(await this.archivosService.existe(firma.archivo_id))) {
        return { imagen_url: '', imagen_disponible: false };
      }
      const url = await this.archivosService.obtenerUrlFirmada(firma.archivo_id);
      return { imagen_url: url, imagen_disponible: Boolean(url) };
    } catch {
      return { imagen_url: '', imagen_disponible: false };
    }
  }

  /** Versión admin con datos descifrados (solo ficha de reserva). */
  private pasajeroDetalle(p: Pasajero): Record<string, unknown> {
    const base = pasajeroAdmin(p) as Record<string, unknown>;
    return {
      ...base,
      documento: descifrarONull(p.documento_enc) || String(base.documento ?? ''),
      fecha_nacimiento: descifrarONull(p.fecha_nacimiento_enc),
      documento_enmascarado: base.documento_enmascarado ?? null,
    };
  }

  private async pagosDeReserva(reservaId: string): Promise<Record<string, unknown>[]> {
    const lista = await this.pagoRepo.find({ where: { reserva_id: reservaId }, order: { creado_en: 'ASC' } });
    const claves = await this.clavesMetodo();
    return Promise.all(lista.map(async (p) => this.pagoFe(p, claves)));
  }

  private async clavesMetodo(): Promise<Map<string, string>> {
    const todos = await this.metodos.find();
    return new Map(todos.map((m) => [m.id, m.clave]));
  }

  private async pagoFe(p: Pago, claves?: Map<string, string>): Promise<Record<string, unknown>> {
    const mapa = claves ?? (await this.clavesMetodo());
    const fe = pagoPublico(p, mapa.get(p.metodo_id) ?? 'transferencia');
    if (p.comprobante_archivo_id) {
      fe.comprobante_url = `/api/v1/archivos/${p.comprobante_archivo_id}`;
    }
    return fe;
  }

  private async tourFe(t: Tour): Promise<Record<string, unknown>> {
    const puntos = await this.puntos.find({ where: { tour_id: t.id } });
    const fv = await this.ultimasVersionesForm();
    const version = fv.get(t.id);
    const termVersion = t.plantilla_terminos_id
      ? await this.terminosVersiones.findOne({
          where: { plantilla_id: t.plantilla_terminos_id, estado: 'publicada' },
          order: { version: 'DESC' },
        })
      : null;
    return tourPublico(t, puntos, version?.id ?? null, termVersion?.id ?? null);
  }

  private async fechaFe(f: FechaTour): Promise<Record<string, unknown>> {
    const cupos = await this.cuposOpcion.find({ where: { fecha_tour_id: f.id } });
    return fechaPublica(f, cupos);
  }

  private async ultimasVersionesForm(): Promise<Map<string, TourFormVersion>> {
    const versiones = await this.formVersions.find({ order: { creado_en: 'DESC' } });
    const mapa = new Map<string, TourFormVersion>();
    for (const v of versiones) {
      if (!mapa.has(v.tour_id)) mapa.set(v.tour_id, v);
    }
    return mapa;
  }

  private async terminosVersionFe(id: string | null): Promise<Record<string, unknown> | null> {
    if (!id) return null;
    const v = await this.terminosVersiones.findOne({ where: { id } });
    if (!v) return null;
    const p = await this.plantillasTerminos.findOne({ where: { id: v.plantilla_id } });
    return terminosPublico(v, p);
  }

  private async auditoriaDe(entidad: string, entidadId: string): Promise<Record<string, unknown>[]> {
    const filas = await this.auditoriaRepo.find({
      where: { entidad, entidad_id: entidadId },
      order: { id: 'DESC' },
      take: 100,
    });
    const nombres = await this.nombresUsuarios(filas.map((f) => f.usuario_id).filter(Boolean) as string[]);
    return filas.map((f) => auditoriaPublica(f, f.usuario_id ? nombres.get(f.usuario_id) : undefined));
  }

  private async nombresUsuarios(ids: string[]): Promise<Map<string, string>> {
    if (!ids.length) return new Map();
    const usuarios = await this.usuarios.find({ where: { id: In(ids) } });
    return new Map(usuarios.map((u) => [u.id, u.nombre]));
  }

  // =========================================================================
  // Dashboard
  // =========================================================================

  async dashboard() {
    const reservas = await this.reservaRepo.find();
    const porEstado = new Map<string, number>();
    for (const r of reservas) porEstado.set(r.estado, (porEstado.get(r.estado) ?? 0) + 1);

    const fechas = await this.fechaRepo.find({ where: { estado: 'publicada' }, order: { fecha_salida: 'ASC' } });
    const proximas = fechas.slice(0, 6);
    const ocupacion = await Promise.all(
      proximas.map(async (f) => ({
        fecha_tour_id: f.id,
        tour: (await this.tourRepo.findOne({ where: { id: f.tour_id } }))?.nombre ?? 'Tour',
        fecha: f.fecha_salida,
        hora: f.hora_salida,
        vendidos: f.cupos_vendidos,
        retenidos: f.cupos_retenidos,
        total: f.cupos_total + (f.sobrecupo_autorizado ?? 0),
      })),
    );

    const pendientes = await this.pagoRepo.find({ where: { estado: In(['reportado', 'correccion_solicitada']) } });
    const masAntiguo = pendientes.length
      ? Math.max(...pendientes.map((p) => Math.max(0, Math.round((Date.now() - new Date(p.creado_en).getTime()) / 60000))))
      : 0;

    const ahora = new Date();
    const inicioMes = new Date(ahora.getFullYear(), ahora.getMonth(), 1);
    const aprobadosMes = await this.pagoRepo
      .createQueryBuilder('p')
      .where('p.estado = :e', { e: 'aprobado' })
      .andWhere('p.validado_en >= :d', { d: inicioMes.toISOString() })
      .getMany();
    const ingresos = aprobadosMes.reduce((acc, p) => acc + num(p.monto_usd_equivalente), 0);

    // Serie de ventas de los últimos 12 meses (para el gráfico del dashboard).
    const inicio12 = new Date(ahora.getFullYear(), ahora.getMonth() - 11, 1);
    const pagos12 = await this.pagoRepo
      .createQueryBuilder('p')
      .where('p.estado = :e', { e: 'aprobado' })
      .andWhere('p.validado_en >= :d', { d: inicio12.toISOString() })
      .getMany();
    const porMes = new Map<string, { total_usd: number; reservas: Set<string> }>();
    for (const p of pagos12) {
      const cuando = p.validado_en ? new Date(p.validado_en) : null;
      if (!cuando || Number.isNaN(cuando.getTime())) continue;
      const mes = `${cuando.getFullYear()}-${String(cuando.getMonth() + 1).padStart(2, '0')}`;
      const actual = porMes.get(mes) ?? { total_usd: 0, reservas: new Set<string>() };
      actual.total_usd += num(p.monto_usd_equivalente);
      actual.reservas.add(p.reserva_id);
      porMes.set(mes, actual);
    }
    const ventas_por_mes: { mes: string; total_usd: string; reservas: number }[] = [];
    for (let i = 0; i < 12; i++) {
      const d = new Date(inicio12.getFullYear(), inicio12.getMonth() + i, 1);
      const mes = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const datos = porMes.get(mes);
      ventas_por_mes.push({
        mes,
        total_usd: (datos?.total_usd ?? 0).toFixed(2),
        reservas: datos?.reservas.size ?? 0,
      });
    }

    const atencion: Record<string, unknown>[] = [];
    const porVerificar = await this.reservaRepo.find({ where: { estado: 'pago_en_verificacion' }, take: 10 });
    for (const r of porVerificar) {
      atencion.push({
        id: r.id,
        tipo: 'pago',
        titulo: `Pago por verificar — ${r.ref_corta}`,
        detalle: 'La reserva espera validación del pago reportado.',
        entidad_id: r.id,
        severidad: 'alta',
      });
    }
    const porExpirar = reservas.filter(
      (r) => r.expira_en && new Date(r.expira_en) < new Date(Date.now() + 24 * 3600 * 1000) && !['confirmada', 'completada', 'cancelada', 'expirada'].includes(r.estado),
    );
    for (const r of porExpirar.slice(0, 5)) {
      atencion.push({
        id: r.id,
        tipo: 'reserva',
        titulo: `Reserva por expirar — ${r.ref_corta}`,
        detalle: 'El enlace vence pronto sin confirmación de pago.',
        entidad_id: r.id,
        severidad: 'media',
      });
    }

    return {
      reservas_por_estado: [...porEstado.entries()].map(([estado, total]) => ({ estado, total })),
      ocupacion_proximas: ocupacion,
      pagos_por_verificar: [{ total: pendientes.length, mas_antiguo_min: masAntiguo }],
      ingresos_mes_usd: ingresos.toFixed(2),
      ventas_por_mes,
      requiere_atencion: atencion,
    };
  }

  // =========================================================================
  // Reservas
  // =========================================================================

  async reservas(f: Record<string, string | undefined>) {
    const qb = this.reservaRepo.createQueryBuilder('r').orderBy('r.creado_en', 'DESC');
    if (f.tour_id) {
      const fechasIds = (await this.fechaRepo.find({ where: { tour_id: f.tour_id } })).map((x) => x.id);
      if (!fechasIds.length) return { items: [], next_cursor: null, total: 0 };
      qb.andWhere('r.fecha_tour_id IN (:...fids)', { fids: fechasIds });
    }
    if (f.fecha_tour_id) qb.andWhere('r.fecha_tour_id = :fid', { fid: f.fecha_tour_id });
    if (f.estado) qb.andWhere('r.estado IN (:...est)', { est: f.estado.split(',') });
    if (f.estado_pago) qb.andWhere('r.estado_pago IN (:...eps)', { eps: f.estado_pago.split(',') });
    if (f.busqueda || f.q) {
      const q = `%${f.busqueda ?? f.q}%`;
      qb.andWhere('(r.ref_corta LIKE :q OR r.codigo LIKE :q OR r.referencia_interna LIKE :q)', { q });
    }
    if (f.por_expirar === 'true' || f.por_expirar === '1') {
      qb.andWhere('r.expira_en IS NOT NULL').andWhere('r.expira_en < :limite', {
        limite: new Date(Date.now() + 48 * 3600 * 1000).toISOString(),
      });
    }
    if (f.con_pago_por_validar === 'true' || f.con_pago_por_validar === '1') {
      qb.andWhere('r.tiene_pago_por_validar = 1');
    }
    const limite = Math.min(Number(f.limite) || 20, 100);
    const cursor = f.cursor ? Number(f.cursor) : 0;
    const [rows, total] = await qb.skip(cursor).take(limite).getManyAndCount();
    const items = await Promise.all(rows.map((r) => this.reservaFe(r)));
    return { items, next_cursor: cursor + limite < total ? String(cursor + limite) : null, total };
  }

  async reservaDetalle(id: string) {
    const r = await this.reservaRepo.findOne({ where: { id } });
    if (!r) throw ApiError.noEncontrado('Reserva');
    return this.reservaFe(r, { conDetalle: true });
  }

  async tablero(fechaTourId?: string) {
    const qb = this.reservaRepo.createQueryBuilder('r').orderBy('r.creado_en', 'DESC').take(200);
    if (fechaTourId) qb.andWhere('r.fecha_tour_id = :fid', { fid: fechaTourId });
    const rows = await qb.getMany();
    const items = await Promise.all(rows.map((r) => this.reservaFe(r)));
    const estados = ['enlace_creado', 'en_registro', 'pendiente_firma', 'pendiente_pago', 'pago_en_verificacion', 'confirmada', 'completada', 'cancelada', 'expirada'];
    return {
      columnas: estados.map((estado) => ({
        estado,
        total: items.filter((i) => i.estado === estado).length,
        reservas: items.filter((i) => i.estado === estado),
      })),
    };
  }

  async crearReserva(body: { fecha_tour_id: string; referencia_interna?: string; estimated_pasajeros?: number }, usuarioId: string) {
    const resp = await this.reservasService.crear(
      { fecha_tour_id: body.fecha_tour_id, referencia_interna: body.referencia_interna },
      usuarioId,
    );
    const reserva = await this.reservaFe(resp.reserva as unknown as Reserva);
    const enlaceObj =
      typeof resp.enlace === 'object' && resp.enlace !== null
        ? (resp.enlace as { url?: string; token?: string; expira_en?: string })
        : null;
    const enlace = enlaceObj?.url ?? (typeof resp.enlace === 'string' ? resp.enlace : '');
    return {
      reserva,
      enlace,
      expira_en: enlaceObj?.expira_en ?? null,
      whatsapp_url: typeof resp.whatsapp_url === 'string' ? resp.whatsapp_url : undefined,
      advertencias: ((resp.advertencias ?? []) as string[]).map((m) => ({ codigo: 'ADVERTENCIA', mensaje: m })),
    };
  }

  async regenerarEnlace(id: string, usuarioId: string) {
    const resp = await this.reservasService.regenerarEnlace(id, usuarioId);
    const enlace = (resp as { enlace?: { url?: string } }).enlace;
    return { enlace: enlace?.url ?? `/r/${(resp as { token?: string }).token ?? ''}` };
  }

  async revocarEnlace(id: string, _motivo: string, usuarioId: string) {
    const r = await this.reservaRepo.findOne({ where: { id } });
    if (!r) throw ApiError.noEncontrado('Reserva');
    await this.enlaces.update(
      { reserva_id: id, estado: In(['vigente', 'usado']) },
      { estado: 'revocado', revocado_en: new Date(), revocado_por: usuarioId },
    );
    return { ok: true };
  }

  async extenderHold(id: string, horas: number, motivo: string, usuarioId: string) {
    const detalle = await this.reservasService.extenderHold(id, horas, motivo, usuarioId);
    const r = detalle as unknown as Reserva;
    return { expira_en: iso(r.expira_en) };
  }

  async editarReserva(id: string, body: { motivo: string; cambios: Record<string, unknown> }, usuarioId: string) {
    const r = await this.reservaRepo.findOne({ where: { id } });
    if (!r) throw ApiError.noEncontrado('Reserva');
    if (typeof body.cambios.referencia_interna === 'string') {
      r.referencia_interna = body.cambios.referencia_interna;
    }
    r.version += 1;
    await this.reservaRepo.save(r);
    await this.auditoriaRepo.save(
      this.auditoriaRepo.create({
        ocurrido_en: new Date(),
        actor_tipo: 'usuario',
        usuario_id: usuarioId,
        entidad: 'reserva',
        entidad_id: id,
        accion: 'reserva.editada',
        valor_anterior: null,
        valor_nuevo: { cambios: body.cambios, motivo: body.motivo },
      }),
    );
    return { ok: true };
  }

  /**
   * PUT /adminfx/reservas/:id/precio — precio 100% administrado.
   * Reemplaza las líneas extra (toldos y cargos) y los ajustes manuales de la
   * reserva, recalcula los totales con las tarifas reales y audita el cambio.
   */
  async guardarPrecio(
    id: string,
    body: {
      motivo: string;
      lineas?: { id?: string; concepto: string; cantidad: number; precio_unit_usd: string }[];
      ajustes?: { id?: string; tipo: 'descuento' | 'recargo'; monto_usd: string; motivo: string }[];
    },
    usuarioId: string,
  ) {
    const r = await this.reservaRepo.findOne({ where: { id } });
    if (!r) throw ApiError.noEncontrado('Reserva');
    if (['cancelada', 'expirada', 'completada'].includes(r.estado)) {
      throw ApiError.transicionInvalida('No se puede editar el precio de una reserva cerrada');
    }
    const motivo = String(body.motivo ?? '').trim();
    if (!motivo) {
      throw ApiError.validacion('El motivo del cambio de precio es obligatorio', [
        { campo: 'motivo', codigo: 'VALIDACION', mensaje: 'Escribe el motivo del ajuste.' },
      ]);
    }

    const lineasIn = Array.isArray(body.lineas) ? body.lineas : [];
    const ajustesIn = Array.isArray(body.ajustes) ? body.ajustes : [];
    for (const [i, l] of lineasIn.entries()) {
      if (!String(l.concepto ?? '').trim()) {
        throw ApiError.validacion(`La línea ${i + 1} necesita un concepto`, [
          { campo: `lineas.${i}.concepto`, codigo: 'VALIDACION', mensaje: 'Escribe el concepto.' },
        ]);
      }
      if (!Number.isFinite(Number(l.cantidad)) || Math.floor(Number(l.cantidad)) <= 0) {
        throw ApiError.validacion(`La línea ${i + 1} necesita una cantidad válida`, [
          { campo: `lineas.${i}.cantidad`, codigo: 'VALIDACION', mensaje: 'Cantidad inválida.' },
        ]);
      }
      if (!Number.isFinite(Number(l.precio_unit_usd)) || Number(l.precio_unit_usd) < 0) {
        throw ApiError.validacion(`La línea ${i + 1} necesita un precio válido`, [
          { campo: `lineas.${i}.precio_unit_usd`, codigo: 'VALIDACION', mensaje: 'Precio inválido.' },
        ]);
      }
    }
    for (const [i, a] of ajustesIn.entries()) {
      if (a.tipo !== 'descuento' && a.tipo !== 'recargo') {
        throw ApiError.validacion(`El ajuste ${i + 1} tiene un tipo inválido`, [
          { campo: `ajustes.${i}.tipo`, codigo: 'VALIDACION', mensaje: 'Tipo inválido.' },
        ]);
      }
      if (!Number.isFinite(Number(a.monto_usd)) || Number(a.monto_usd) <= 0) {
        throw ApiError.validacion(`El ajuste ${i + 1} necesita un monto válido`, [
          { campo: `ajustes.${i}.monto_usd`, codigo: 'VALIDACION', mensaje: 'Monto inválido.' },
        ]);
      }
      if (!String(a.motivo ?? '').trim()) {
        throw ApiError.validacion(`El ajuste ${i + 1} necesita un motivo`, [
          { campo: `ajustes.${i}.motivo`, codigo: 'VALIDACION', mensaje: 'Escribe el motivo.' },
        ]);
      }
    }

    const resultado = await this.reservaRepo.manager.transaction(async (em) => {
      const lineasActivas = await em.find(ReservaLinea, { where: { reserva_id: id, tipo: 'extra' } });
      const ajustesActivos = await em.find(ReservaAjuste, {
        where: { reserva_id: id, origen: 'manual', anulado_en: IsNull() },
      });

      // Líneas extra: upsert por id, borrar las omitidas.
      const idsLineas = new Set(lineasIn.map((l) => l.id).filter((x): x is string => Boolean(x)));
      const aBorrarL = lineasActivas.filter((l) => !idsLineas.has(l.id));
      if (aBorrarL.length) await em.remove(aBorrarL);
      const porIdL = new Map(lineasActivas.map((l) => [l.id, l]));
      const lineasGuardar: ReservaLinea[] = [];
      for (const l of lineasIn) {
        const cantidad = Math.floor(Number(l.cantidad));
        const precio = Number(l.precio_unit_usd).toFixed(2);
        const subtotal = (cantidad * Number(precio)).toFixed(2);
        const existente = l.id ? porIdL.get(l.id) : undefined;
        if (existente) {
          existente.concepto = String(l.concepto).trim();
          existente.cantidad = cantidad;
          existente.precio_unit_usd = precio;
          existente.subtotal_usd = subtotal;
          lineasGuardar.push(existente);
        } else {
          lineasGuardar.push(
            em.create(ReservaLinea, {
              reserva_id: id,
              tipo: 'extra',
              concepto: String(l.concepto).trim(),
              cantidad,
              precio_unit_usd: precio,
              subtotal_usd: subtotal,
            }),
          );
        }
      }
      if (lineasGuardar.length) await em.save(lineasGuardar);

      // Ajustes manuales: replace-all igual que las líneas.
      const idsAjustes = new Set(ajustesIn.map((a) => a.id).filter((x): x is string => Boolean(x)));
      const aBorrarA = ajustesActivos.filter((a) => !idsAjustes.has(a.id));
      if (aBorrarA.length) await em.remove(aBorrarA);
      const porIdA = new Map(ajustesActivos.map((a) => [a.id, a]));
      const ajustesGuardar: ReservaAjuste[] = [];
      for (const a of ajustesIn) {
        const datos = {
          tipo: a.tipo,
          monto_usd: Number(a.monto_usd).toFixed(2),
          motivo: String(a.motivo).trim(),
          origen: 'manual' as const,
          creado_por: usuarioId,
        };
        const existente = a.id ? porIdA.get(a.id) : undefined;
        if (existente) {
          Object.assign(existente, datos);
          ajustesGuardar.push(existente);
        } else {
          ajustesGuardar.push(em.create(ReservaAjuste, { reserva_id: id, ...datos }));
        }
      }
      if (ajustesGuardar.length) await em.save(ajustesGuardar);

      // Recalcular con pasajeros/tarifas reales (autoridad del servidor).
      const [pasajeros, tarifas] = await Promise.all([
        em.find(Pasajero, { where: { reserva_id: id } }),
        em.find(Tarifa, { where: { fecha_tour_id: r.fecha_tour_id } }),
      ]);
      const calculo = calcularPrecioAdministrado({
        pasajeros: pasajeros.map((p) => ({ categoria: CATEGORIA_A_FE(p.categoria) })),
        tarifas: tarifas.map((t) => ({
          categoria: CATEGORIA_A_FE(t.categoria),
          precio_usd: String(t.precio_usd),
        })),
        lineas: lineasGuardar.map((l) => ({
          concepto: l.concepto,
          cantidad: l.cantidad,
          precio_unit_usd: String(l.precio_unit_usd),
        })),
        ajustes: ajustesGuardar.map((a) => ({
          tipo: a.tipo,
          monto_usd: String(a.monto_usd),
          motivo: a.motivo,
        })),
      });

      const anterior = {
        total_usd: r.total_usd,
        subtotal_usd: r.subtotal_usd,
        adicionales_usd: r.adicionales_usd,
        descuentos_usd: r.descuentos_usd,
      };
      r.subtotal_usd = calculo.subtotal_usd;
      r.adicionales_usd = calculo.adicionales_usd;
      r.descuentos_usd = calculo.descuento_usd;
      r.total_usd = calculo.total_usd;
      r.desglose = { origen: 'administrado', ...calculo } as Record<string, unknown>;
      r.version += 1;
      r.ultima_actividad_en = new Date();
      await em.save(Reserva, r);
      await em.save(
        AuditLog,
        em.create(AuditLog, {
          ocurrido_en: new Date(),
          actor_tipo: 'usuario',
          usuario_id: usuarioId,
          entidad: 'reserva',
          entidad_id: id,
          accion: 'reserva.precio_editado',
          valor_anterior: anterior,
          valor_nuevo: {
            motivo,
            lineas: lineasGuardar.map((l) => ({
              concepto: l.concepto,
              cantidad: l.cantidad,
              precio_unit_usd: String(l.precio_unit_usd),
            })),
            ajustes: ajustesGuardar.map((a) => ({
              tipo: a.tipo,
              monto_usd: String(a.monto_usd),
              motivo: a.motivo,
            })),
            total_usd: calculo.total_usd,
          },
        }),
      );
      return { reserva: r, calculo };
    });

    const neto = num(resultado.reserva.aprobado_usd) - num(resultado.reserva.reembolsado_usd);
    return {
      ok: true,
      total_usd: resultado.reserva.total_usd,
      saldo_usd: Math.max(0, num(resultado.reserva.total_usd) - neto).toFixed(2),
      advertencias: resultado.calculo.advertencias,
      ...(neto > 0
        ? {
            advertencia:
              'La reserva ya tiene pagos aprobados; el nuevo total puede dejar saldo a favor o pendiente.',
          }
        : {}),
    };
  }

  async revelar(id: string, body: { campo: string; pasajero_ref?: string; motivo: string }) {
    const r = await this.reservaRepo.findOne({ where: { id } });
    if (!r) throw ApiError.noEncontrado('Reserva');
    const campo = body.campo === 'fecha_nacimiento' ? 'fecha_nacimiento' : 'documento';
    const qb = this.pasajeros.createQueryBuilder('p').where('p.reserva_id = :id', { id });
    if (body.pasajero_ref) qb.andWhere('p.ref_cliente = :ref', { ref: body.pasajero_ref });
    else qb.andWhere('p.es_titular = 1');
    const p = await qb.getOne();
    if (!p) throw ApiError.noEncontrado('Pasajero');
    const valor = campo === 'documento' ? descifrarONull(p.documento_enc) : descifrarONull(p.fecha_nacimiento_enc);
    await this.auditoriaRepo.save(
      this.auditoriaRepo.create({
        ocurrido_en: new Date(),
        actor_tipo: 'usuario',
        entidad: 'reserva',
        entidad_id: id,
        accion: 'reserva.dato_revelado',
        valor_anterior: null,
        valor_nuevo: { campo, motivo: body.motivo },
      }),
    );
    return { valor };
  }

  async simularCancelacion(id: string) {
    const r = await this.reservaRepo.findOne({ where: { id } });
    if (!r) throw ApiError.noEncontrado('Reserva');
    const fecha = await this.fechaRepo.findOne({ where: { id: r.fecha_tour_id } });
    const salida = fecha ? new Date(`${fecha.fecha_salida}T${fecha.hora_salida}:00`) : new Date();
    const dias = Math.max(0, Math.ceil((salida.getTime() - Date.now()) / 86400000));
    const tour = fecha ? await this.tourRepo.findOne({ where: { id: fecha.tour_id } }) : null;
    let politica: PoliticaCancelacion | null = null;
    if (tour?.politica_cancelacion_id) {
      politica = await this.politicas.findOne({ where: { id: tour.politica_cancelacion_id } });
    }
    const tramos = (politica?.tramos ?? []) as { dias_min: number; dias_max: number | null; reembolso_pct: number }[];
    const tramo = tramos.find((t) => dias >= t.dias_min && (t.dias_max === null || dias <= t.dias_max)) ?? tramos[tramos.length - 1];
    const pct = tramo?.reembolso_pct ?? 0;
    const total = num(r.total_usd);
    return {
      dias_para_salida: dias,
      tramo: {
        porcentaje: pct,
        descripcion: tramo
          ? `Reembolso del ${pct} % (${tramo.dias_min}+ días antes)`
          : 'Sin política de cancelación',
      },
      monto_sugerido: ((total * pct) / 100).toFixed(2),
    };
  }

  async cancelarReserva(id: string, body: { origen: string; motivo: string; monto_reembolso?: string; forzar?: boolean }, usuarioId: string) {
    const origen = (['cliente', 'agencia', 'fuerza_mayor'].includes(body.origen) ? body.origen : 'agencia') as
      | 'cliente'
      | 'agencia'
      | 'fuerza_mayor';
    await this.reservasService.cancelar(id, { origen, motivo: body.motivo, forzar: body.forzar }, usuarioId);
    return { ok: true };
  }

  async reprogramar(id: string, body: { fecha_tour_id: string; motivo: string; diferencia_usd?: string }, usuarioId: string) {
    const r = await this.reservaRepo.findOne({ where: { id } });
    if (!r) throw ApiError.noEncontrado('Reserva');
    const destino = await this.fechaRepo.findOne({ where: { id: body.fecha_tour_id } });
    if (!destino) throw ApiError.noEncontrado('Fecha destino');
    if (destino.estado !== 'publicada') throw ApiError.validacion('La fecha destino no está publicada');
    const disponibilidad = await this.cupos.disponibilidad(destino.id);
    const necesarios = r.cupo_pasajeros || (await this.pasajeros.count({ where: { reserva_id: id } }));
    if (disponibilidad.disponible < necesarios) {
      throw ApiError.validacion('La salida destino no tiene cupos suficientes', [
        { campo: 'fecha_tour_id', codigo: 'SIN_CUPO', mensaje: 'Sin cupo suficiente' },
      ]);
    }
    const anterior = r.fecha_tour_id;
    // Libera cupo anterior y retiene en destino (best-effort, dev).
    if (r.cupo_estado === 'retenido' || r.cupo_estado === 'vendido') {
      await this.cupos.liberar(anterior, r.id, r.cupo_pasajeros, r.cupo_opciones, 'liberacion', undefined);
    }
    r.fecha_tour_id = destino.id;
    r.cupo_estado = 'retenido';
    r.cupo_pasajeros = necesarios;
    r.version += 1;
    await this.reservaRepo.save(r);
    await this.cupos.retener(destino.id, r.id, necesarios, [], 'hold', undefined).catch(() => undefined);
    await this.auditoriaRepo.save(
      this.auditoriaRepo.create({
        ocurrido_en: new Date(),
        actor_tipo: 'usuario',
        usuario_id: usuarioId,
        entidad: 'reserva',
        entidad_id: id,
        accion: 'reserva.reprogramada',
        valor_anterior: { fecha_tour_id: anterior },
        valor_nuevo: { fecha_tour_id: destino.id, motivo: body.motivo },
      }),
    );
    return { ok: true, diferencia_usd: body.diferencia_usd ?? '0.00' };
  }

  async reactivar(id: string, usuarioId: string) {
    await this.reservasService.reactivar(id, usuarioId);
    return { ok: true };
  }

  // =========================================================================
  // Pagos
  // =========================================================================

  async pagos(f: Record<string, string | undefined>) {
    const qb = this.pagoRepo.createQueryBuilder('p').orderBy('p.creado_en', 'ASC');
    if (f.estado) qb.andWhere('p.estado IN (:...est)', { est: f.estado.split(',') });
    if (f.reserva_id) qb.andWhere('p.reserva_id = :rid', { rid: f.reserva_id });
    if (f.busqueda) {
      qb.leftJoin(Reserva, 'r', 'r.id = p.reserva_id')
        .andWhere('(p.referencia LIKE :q OR r.codigo LIKE :q OR r.ref_corta LIKE :q)', { q: `%${f.busqueda}%` });
    }
    const limite = Math.min(Number(f.limite) || 20, 100);
    const cursor = f.cursor ? Number(f.cursor) : 0;
    const [rows, total] = await qb.skip(cursor).take(limite).getManyAndCount();
    const claves = await this.clavesMetodo();
    const items = await Promise.all(
      rows.map(async (p) => {
        const fe = await this.pagoFe(p, claves);
        const reserva = await this.reservaRepo.findOne({ where: { id: p.reserva_id } });
        fe.reserva = reserva ? await this.reservaFe(reserva) : null;
        return fe;
      }),
    );
    return { items, next_cursor: cursor + limite < total ? String(cursor + limite) : null, total };
  }

  async pagoDetalle(id: string) {
    const p = await this.pagoRepo.findOne({ where: { id } });
    if (!p) throw ApiError.noEncontrado('Pago');
    const fe = await this.pagoFe(p);
    const reserva = await this.reservaRepo.findOne({ where: { id: p.reserva_id } });
    if (!reserva) throw ApiError.noEncontrado('Reserva del pago');
    fe.reserva = await this.reservaFe(reserva);
    return fe;
  }

  async validarPago(id: string, body: { accion: string; monto_validado?: string; motivo?: string; motivo_catalogo?: string; texto_cliente?: string; confirmar_duplicado?: boolean; idempotencyKey?: string }, usuarioId: string) {
    switch (body.accion) {
      case 'aprobar':
        await this.pagosService.aprobar(
          id,
          {
            monto_validado: body.monto_validado ? Number(body.monto_validado) : undefined,
            ajuste_motivo: body.motivo,
            confirmar_duplicado: body.confirmar_duplicado,
          },
          usuarioId,
        );
        break;
      case 'rechazar':
        await this.pagosService.rechazar(
          id,
          { motivo_codigo: body.motivo_catalogo ?? body.motivo ?? 'otro', motivo_texto: body.texto_cliente ?? body.motivo },
          usuarioId,
        );
        break;
      case 'solicitar_correccion':
        await this.pagosService.solicitarCorreccion(id, { texto: body.texto_cliente ?? body.motivo ?? '' }, usuarioId);
        break;
      case 'anular':
        await this.pagosService.anular(id, body.motivo ?? 'Anulado por operador', usuarioId);
        break;
      default:
        throw ApiError.validacion('Acción de validación desconocida');
    }
    const p = await this.pagoRepo.findOne({ where: { id } });
    const reserva = p ? await this.reservaRepo.findOne({ where: { id: p.reserva_id } }) : null;
    return { ok: true, saldo_usd: reserva ? (await this.reservaFe(reserva)).saldo_usd : '0.00' };
  }

  async registrarPagoEfectivo(id: string, body: { monto: string; referencia?: string; nota?: string }, usuarioId: string) {
    const reserva = await this.reservaRepo.findOne({ where: { id } });
    if (!reserva) throw ApiError.noEncontrado('Reserva');
    const efectivo = await this.metodos.findOne({ where: { clave: 'efectivo' } });
    if (!efectivo) throw ApiError.validacion('Método efectivo no configurado');
    const monto = Number(body.monto);
    if (!Number.isFinite(monto) || monto <= 0) throw ApiError.validacion('Monto inválido');
    const pago = await this.pagoRepo.save(
      this.pagoRepo.create({
        reserva_id: id,
        metodo_id: efectivo.id,
        origen: 'operador',
        estado: 'aprobado',
        monto_reportado: monto.toFixed(2),
        monto: monto.toFixed(2),
        moneda: 'USD',
        tasa: '1',
        monto_usd_equivalente: monto.toFixed(2),
        esperado_usd: num(reserva.total_usd).toFixed(2),
        fecha_pago: new Date().toISOString().slice(0, 10),
        referencia: body.referencia ?? null,
        referencia_norm: body.referencia ? sha256Hex(body.referencia.toLowerCase().trim()).slice(0, 32) : null,
        campos_extra: { _nota: body.nota ?? '', _registrado_por_nombre: 'Operador' },
        registrado_por: usuarioId,
        validado_por: usuarioId,
        validado_en: new Date(),
      }),
    );
    void pago;
    await this.pagosService.recalcularEstadoPago(id);
    return { ok: true };
  }

  async reembolsar(id: string, body: { monto: string; metodo: string; motivo: string }, usuarioId: string) {
    const p = await this.pagoRepo.findOne({ where: { id } });
    if (!p) throw ApiError.noEncontrado('Pago');
    await this.pagosService.registrarReembolso(
      id,
      {
        monto_usd: Number(body.monto),
        metodo: body.metodo,
        motivo: body.motivo,
        fecha: new Date().toISOString().slice(0, 10),
      },
      usuarioId,
    );
    return { ok: true };
  }

  // =========================================================================
  // Tours, fechas, tarifas, formulario
  // =========================================================================

  async tours() {
    const tours = await this.tourRepo.find({ order: { creado_en: 'DESC' } });
    return Promise.all(tours.map((t) => this.tourFe(t)));
  }

  async tourDetalle(id: string) {
    const tour = await this.tourRepo.findOne({ where: { id } });
    if (!tour) throw ApiError.noEncontrado('Tour');
    const fechas = await this.fechaRepo.find({ where: { tour_id: id }, order: { fecha_salida: 'ASC' } });
    const fechasFe = await Promise.all(fechas.map((f) => this.fechaFe(f)));
    const tarifasRows = await this.tarifas.find();
    const fechasIds = new Set(fechas.map((f) => f.id));
    const tarifas = tarifasRows.filter((t) => fechasIds.has(t.fecha_tour_id)).map((t) => tarifaPublica(t));
    const fv = await this.ultimasVersionesForm();
    const version = fv.get(id);
    const formulario = version ? formularioPublico(version) : null;
    const versiones = await this.formVersions.find({
      where: { tour_id: id },
      order: { version: 'DESC' },
    });
    return {
      tour: await this.tourFe(tour),
      fechas: fechasFe,
      tarifas,
      formulario,
      form_versiones: versiones.map((v) => formularioPublico(v)),
    };
  }

  async guardarTour(id: string | null, body: Record<string, unknown>) {
    const datos: Record<string, unknown> = {
      nombre: body.nombre,
      tipo: body.tipo,
      descripcion: body.descripcion,
      itinerario: body.itinerario,
      incluye: body.incluye,
      no_incluye: body.no_incluye,
      imagenes: body.imagenes,
    };
    if (body.politica_cancelacion_id !== undefined) datos.politica_cancelacion_id = body.politica_cancelacion_id || null;
    if (body.terminos_version_id !== undefined) {
      // El tour referencia la plantilla; el frontend manda la versión.
      const v = body.terminos_version_id
        ? await this.terminosVersiones.findOne({ where: { id: String(body.terminos_version_id) } })
        : null;
      datos.plantilla_terminos_id = v?.plantilla_id ?? null;
    }
    if (id) {
      const tour = await this.tourRepo.findOne({ where: { id } });
      if (!tour) throw ApiError.noEncontrado('Tour');
      Object.assign(tour, Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined)));
      tour.version += 1;
      await this.tourRepo.save(tour);
      // Puntos de abordaje
      if (Array.isArray(body.puntos_abordaje)) {
        await this.puntos.delete({ tour_id: id });
        const lista = (body.puntos_abordaje as Record<string, unknown>[]).map((p, i) =>
          this.puntos.create({
            tour_id: id,
            clave: String(p.id ?? `punto_${i}`),
            nombre: String(p.nombre ?? ''),
            hora: String(p.hora ?? '08:00'),
            referencia: (p.referencia_ubicacion as string) ?? (p.mapa_url as string) ?? null,
            orden: i,
            activo: true,
          }),
        );
        if (lista.length) await this.puntos.save(lista);
      }
      return this.tourFe(tour);
    }
    const tour = await this.tourRepo.save(
      this.tourRepo.create({
        ...Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined)),
        estado: 'borrador',
        tipo: (datos.tipo as Tour['tipo']) ?? 'full_day',
        nombre: String(datos.nombre ?? 'Nuevo tour'),
        itinerario: (datos.itinerario as unknown[]) ?? [],
        incluye: (datos.incluye as string[]) ?? [],
        no_incluye: (datos.no_incluye as string[]) ?? [],
        imagenes: (datos.imagenes as string[]) ?? [],
      } as Tour),
    );
    return this.tourFe(tour);
  }

  async duplicarTour(id: string) {
    const tour = await this.tourRepo.findOne({ where: { id } });
    if (!tour) throw ApiError.noEncontrado('Tour');
    const copia = await this.tourRepo.save(
      this.tourRepo.create({
        ...tour,
        id: undefined as never,
        nombre: `${tour.nombre} (copia)`,
        estado: 'borrador',
        version: 1,
        creado_en: undefined as never,
        actualizado_en: undefined as never,
      } as unknown as Tour),
    );
    const puntos = await this.puntos.find({ where: { tour_id: id } });
    if (puntos.length) {
      await this.puntos.save(puntos.map((p) => this.puntos.create({ ...p, id: undefined as never, tour_id: copia.id, creado_en: undefined as never, actualizado_en: undefined as never })));
    }
    return this.tourFe(copia);
  }

  async cambiarEstadoTour(id: string, estado: 'activo' | 'archivado', usuarioId: string) {
    try {
      await this.toursService.cambiarEstado(id, estado === 'activo' ? 'activo' : 'archivado', usuarioId);
      return { ok: true, bloqueos: [] as string[] };
    } catch (e) {
      const err = e as { response?: { detalles?: { mensaje?: string }[] }; message?: string };
      const bloqueos = (err.response?.detalles ?? []).map((d) => d.mensaje ?? '').filter(Boolean);
      if (bloqueos.length) return { ok: false, bloqueos };
      throw e;
    }
  }

  async fechas(tourId: string) {
    const fechas = await this.fechaRepo.find({ where: { tour_id: tourId }, order: { fecha_salida: 'ASC' } });
    return Promise.all(fechas.map((f) => this.fechaFe(f)));
  }

  async fechasTodas() {
    const fechas = await this.fechaRepo.find({ order: { fecha_salida: 'ASC' } });
    return Promise.all(fechas.map((f) => this.fechaFe(f)));
  }

  async guardarFecha(body: Record<string, unknown>) {
    const tourId = String(body.tour_id ?? '');
    const id = body.id ? String(body.id) : null;
    const datos = {
      tour_id: tourId,
      fecha_salida: String(body.fecha_salida ?? ''),
      hora_salida: String(body.hora_salida ?? '08:00'),
      cupos_total: Number(body.cupos_total ?? 20),
      corte_venta_horas: Number(body.corte_venta_horas ?? 12),
    };
    if (id) {
      const fecha = await this.fechaRepo.findOne({ where: { id } });
      if (!fecha) throw ApiError.noEncontrado('Fecha');
      Object.assign(fecha, datos, { version: fecha.version + 1 });
      await this.fechaRepo.save(fecha);
    } else {
      await this.fechaRepo.save(this.fechaRepo.create({ ...datos, estado: 'borrador' }));
    }
    const lista = await this.fechaRepo.find({ where: { tour_id: tourId }, order: { fecha_salida: 'ASC' } });
    return this.fechaFe(lista[lista.length - 1]);
  }

  async cerrarFecha(id: string, body: { expirar_pendientes: boolean; motivo?: string }, usuarioId: string) {
    await this.fechasService.cambiarEstado(id, 'cerrar', usuarioId, body.motivo);
    return { ok: true };
  }

  async cancelarFecha(id: string, body: { motivo: string; confirmacion: string }, usuarioId: string) {
    if (body.confirmacion !== 'CANCELAR') {
      throw ApiError.validacion('La confirmación no coincide', [{ campo: 'confirmacion', codigo: 'CONFIRMACION', mensaje: 'Escribe CANCELAR para confirmar' }]);
    }
    await this.fechasService.cambiarEstado(id, 'cancelar', usuarioId, body.motivo);
    return { tarea_id: `cancelacion_${id}_${Date.now()}` };
  }

  progresoCancelacion(_tareaId: string) {
    return { estado: 'completado', porcentaje: 100 };
  }

  async autorizarSobrecupo(id: string, body: { cupos_extra: number; motivo: string; codigo_totp?: string }, usuarioId: string) {
    await this.fechasService.sobrecupo(id, { cantidad: body.cupos_extra, motivo: body.motivo }, usuarioId);
    return { ok: true };
  }

  async guardarTarifa(body: Record<string, unknown>) {
    const id = body.id ? String(body.id) : null;
    const datos = {
      fecha_tour_id: String(body.fecha_tour_id ?? ''),
      categoria: CATEGORIA_A_BE(String(body.categoria ?? 'Adulto')),
      edad_min: Number(body.edad_min ?? 0),
      edad_max: Number(body.edad_max ?? 120),
      precio_usd: Number(body.precio_usd ?? 0).toFixed(2),
    };
    if (id) {
      const t = await this.tarifas.findOne({ where: { id } });
      if (!t) throw ApiError.noEncontrado('Tarifa');
      Object.assign(t, datos);
      await this.tarifas.save(t);
      return tarifaPublica(t);
    }
    const t = await this.tarifas.save(this.tarifas.create(datos));
    return tarifaPublica(t);
  }

  async eliminarTarifa(id: string) {
    await this.tarifas.delete({ id });
    return { ok: true };
  }

  async formulario(tourId: string) {
    const fv = await this.ultimasVersionesForm();
    const version = fv.get(tourId);
    return { formulario: version ? formularioPublico(version) : null };
  }

  async guardarFormulario(tourId: string, body: { definicion: { campos: Record<string, unknown>[] } }, usuarioId: string) {
    const campos = body.definicion?.campos ?? [];
    // Validación básica de estructura (la validación de dominio completa corre en el flujo público).
    const ids = new Set<string>();
    const errores: { campo: string; mensaje: string; nivel: 'bloqueante' | 'advertencia' }[] = [];
    for (const c of campos) {
      const id = String(c.id ?? '');
      if (!id) errores.push({ campo: 'campos', mensaje: 'Hay un campo sin id', nivel: 'bloqueante' });
      if (ids.has(id)) errores.push({ campo: id, mensaje: `id duplicado: ${id}`, nivel: 'bloqueante' });
      ids.add(id);
      if (!c.label) errores.push({ campo: id, mensaje: 'Falta la etiqueta', nivel: 'advertencia' });
    }
    if (errores.some((e) => e.nivel === 'bloqueante')) return { errores };
    // Nueva versión borrador (o actualiza la borrador existente).
    const existente = await this.formVersions.findOne({
      where: { tour_id: tourId, estado: 'borrador' },
      order: { version: 'DESC' },
    });
    const maxVersion = await this.formVersions
      .createQueryBuilder('v')
      .where('v.tour_id = :t', { t: tourId })
      .getMany()
      .then((vs) => Math.max(0, ...vs.map((v) => v.version)));
    const definicion = { campos };
    const hash = createHash('sha256').update(JSON.stringify(definicion)).digest('hex');
    if (existente) {
      existente.definicion = definicion;
      existente.hash = hash;
      existente.actualizado_en = new Date();
      await this.formVersions.save(existente);
    } else {
      await this.formVersions.save(
        this.formVersions.create({
          tour_id: tourId,
          version: maxVersion + 1,
          estado: 'borrador',
          definicion,
          hash,
        }),
      );
    }
    return { errores: errores.filter((e) => e.nivel === 'advertencia') };
  }

  // =========================================================================
  // Salidas
  // =========================================================================

  async salidas(params?: { mes?: string; tour_id?: string }) {
    const qb = this.fechaRepo.createQueryBuilder('f').orderBy('f.fecha_salida', 'ASC');
    if (params?.tour_id) qb.andWhere('f.tour_id = :t', { t: params.tour_id });
    if (params?.mes) qb.andWhere("substr(f.fecha_salida, 1, 7) = :m", { m: params.mes });
    const fechas = await qb.getMany();
    const out: Record<string, unknown>[] = [];
    for (const f of fechas) {
      const tour = await this.tourRepo.findOne({ where: { id: f.tour_id } });
      const total = f.cupos_total + (f.sobrecupo_autorizado ?? 0);
      const disponible = total - f.cupos_vendidos - f.cupos_retenidos;
      const alertas: string[] = [];
      if (f.estado === 'publicada' && disponible <= 0) alertas.push('Sin cupo disponible');
      if (f.estado === 'publicada' && disponible <= 3 && disponible > 0) alertas.push(`Solo ${disponible} cupos`);
      if (f.estado === 'cerrada') alertas.push('Salida cerrada');
      if (f.estado === 'cancelada') alertas.push('Salida cancelada');
      out.push({
        fecha_tour_id: f.id,
        tour: tour?.nombre ?? '',
        fecha: f.fecha_salida,
        hora: f.hora_salida,
        estado: f.estado,
        vendidos: f.cupos_vendidos,
        retenidos: f.cupos_retenidos,
        total,
        alertas,
      });
    }
    return out;
  }

  async salida(id: string) {
    const fecha = await this.fechaRepo.findOne({ where: { id } });
    if (!fecha) throw ApiError.noEncontrado('Salida');
    const tour = await this.tourRepo.findOne({ where: { id: fecha.tour_id } });
    if (!tour) throw ApiError.noEncontrado('Tour');
    const [tarifasRows, reservasRows, cuposRows] = await Promise.all([
      this.tarifas.find({ where: { fecha_tour_id: id } }),
      this.reservaRepo.find({ where: { fecha_tour_id: id } }),
      this.cuposOpcion.find({ where: { fecha_tour_id: id } }),
    ]);
    const porEstado = new Map<string, number>();
    for (const r of reservasRows) porEstado.set(r.estado, (porEstado.get(r.estado) ?? 0) + 1);
    const manifest = await Promise.all(
      reservasRows.filter((r) => !['cancelada', 'expirada'].includes(r.estado)).map((r) => this.reservaFe(r)),
    );
    return {
      fecha: await this.fechaFe(fecha),
      tour: await this.tourFe(tour),
      tarifas: tarifasRows.map((t) => tarifaPublica(t)),
      reservas_por_estado: [...porEstado.entries()].map(([estado, total]) => ({ estado, total })),
      opciones: cuposRows.map((c) => ({
        opcion: c.valor,
        campo_id: c.campo_id,
        cantidad: c.cupo,
        agotados: c.vendidos + c.retenidos,
        cupo: c.cupo,
      })),
      manifest,
    };
  }

  // =========================================================================
  // Clientes
  // =========================================================================

  /**
   * Upsert idempotente de la tabla `cliente` desde los pasajeros con
   * `documento_idx` (backfill para reservas anteriores al alta del flujo).
   */
  private async backfillClientes(): Promise<void> {
    const docs = await this.pasajeros
      .createQueryBuilder('p')
      .select('DISTINCT p.documento_idx', 'doc_idx')
      .where('p.documento_idx IS NOT NULL')
      .getRawMany<{ doc_idx: string }>();
    if (!docs.length) return;
    const idxs = docs.map((d) => d.doc_idx);
    const existentes = await this.clienteRepo.find({ where: { doc_idx: In(idxs) } });
    const tiene = new Set(existentes.map((c) => c.doc_idx));
    const faltantes = idxs.filter((i) => !tiene.has(i));
    if (!faltantes.length) return;
    const muestra = await this.pasajeros.find({ where: { documento_idx: In(faltantes) } });
    const porIdx = new Map<string, Pasajero>();
    for (const p of muestra) {
      if (p.documento_idx && !porIdx.has(p.documento_idx)) porIdx.set(p.documento_idx, p);
    }
    const nuevas = faltantes.map((idx) => {
      const p = porIdx.get(idx);
      const tokens = (p?.nombre ?? 'Cliente').trim().split(/\s+/).filter(Boolean);
      return this.clienteRepo.create({
        doc_idx: idx,
        nombre_ultimo: tokens[tokens.length - 1] ?? 'Cliente',
      });
    });
    await this.clienteRepo.save(nuevas);
  }

  /** Resuelve un cliente por `cliente.id`, `doc_idx` o id de pasajero legado. */
  private async resolverCliente(id: string): Promise<{ cliente: Cliente | null; docIdx: string | null; pasajeros: Pasajero[] }> {
    let cliente = await this.clienteRepo.findOne({ where: { id } });
    if (!cliente) cliente = await this.clienteRepo.findOne({ where: { doc_idx: id } });
    let docIdx = cliente?.doc_idx ?? null;
    if (!docIdx) {
      const p = await this.pasajeros.findOne({ where: { id } });
      docIdx = p?.documento_idx ?? null;
    }
    if (!docIdx) return { cliente: null, docIdx: null, pasajeros: [] };
    const pasajeros = await this.pasajeros.find({ where: { documento_idx: docIdx } });
    return { cliente, docIdx, pasajeros };
  }

  async clientes(params?: { busqueda?: string }) {
    await this.backfillClientes();
    const clientes = await this.clienteRepo.find();
    if (!clientes.length) return { items: [] };
    const docIdxs = clientes.map((c) => c.doc_idx);
    const pasajeros = await this.pasajeros.find({ where: { documento_idx: In(docIdxs) } });
    const porDoc = new Map<string, Pasajero[]>();
    for (const p of pasajeros) {
      if (!p.documento_idx) continue;
      porDoc.set(p.documento_idx, [...(porDoc.get(p.documento_idx) ?? []), p]);
    }
    // Reservas y fechas para conteos y última salida.
    const reservaIds = [...new Set(pasajeros.map((p) => p.reserva_id))];
    const reservasRows = reservaIds.length
      ? await this.reservaRepo.find({ where: { id: In(reservaIds) }, select: ['id', 'fecha_tour_id'] })
      : [];
    const fechaIds = [...new Set(reservasRows.map((r) => r.fecha_tour_id))];
    const fechasRows = fechaIds.length
      ? await this.fechaRepo.find({ where: { id: In(fechaIds) }, select: ['id', 'fecha_salida'] })
      : [];
    const salidaPorReserva = new Map<string, string>();
    const fechaPorId = new Map(fechasRows.map((f) => [f.id, f.fecha_salida]));
    for (const r of reservasRows) {
      const f = fechaPorId.get(r.fecha_tour_id);
      if (f) salidaPorReserva.set(r.id, f);
    }

    const q = params?.busqueda?.trim().toLowerCase();
    const items: Record<string, unknown>[] = [];
    for (const c of clientes) {
      const lista = (porDoc.get(c.doc_idx) ?? []).sort((a, b) => Number(b.es_titular) - Number(a.es_titular));
      const principal = lista[0];
      if (!principal) continue;
      const reservaIdsCliente = [...new Set(lista.map((p) => p.reserva_id))];
      const salidas = reservaIdsCliente.map((rid) => salidaPorReserva.get(rid)).filter(Boolean) as string[];
      const nombre = principal.nombre;
      const telefono = principal.telefono ?? '';
      const correo = principal.correo ?? '';
      if (q) {
        const doc = principal.documento_ultimos4 ? `***${principal.documento_ultimos4}` : '';
        if (![nombre, telefono, correo, doc].some((v) => v.toLowerCase().includes(q))) continue;
      }
      items.push({
        id: c.id,
        nombre,
        documento_enmascarado: principal.documento_ultimos4 ? `***${principal.documento_ultimos4}` : '',
        telefono,
        correo,
        reservas: reservaIdsCliente.length,
        ultima_reserva: salidas.length ? salidas.sort().at(-1) : null,
        notas: c.notas ?? '',
      });
    }
    items.sort((a, b) => String(a.nombre).localeCompare(String(b.nombre)));
    return { items: items.slice(0, 100) };
  }

  async cliente(id: string) {
    const { cliente, docIdx, pasajeros } = await this.resolverCliente(id);
    if (!docIdx || !pasajeros.length) throw ApiError.noEncontrado('Cliente');
    const principal =
      pasajeros.find((p) => p.es_titular) ??
      [...pasajeros].sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en)))[0];
    const reservaIds = [...new Set(pasajeros.map((p) => p.reserva_id))];
    const reservasRows = await this.reservaRepo.find({
      where: { id: In(reservaIds) },
      order: { creado_en: 'DESC' },
    });
    const reservas = await Promise.all(reservasRows.map((r) => this.reservaFe(r)));

    // Estadísticas de viaje: destinos, fechas y estados.
    const toursMap = new Map<string, { tour_id: string; tour: string; veces: number }>();
    let confirmadas = 0;
    let canceladas = 0;
    let primera: string | null = null;
    let ultima: string | null = null;
    for (const r of reservas) {
      const tourId = String(r['tour_id'] ?? '');
      const tourNom = String(r['tour_nombre'] ?? '');
      const clave = tourId || tourNom;
      if (clave) {
        const t = toursMap.get(clave) ?? { tour_id: tourId, tour: tourNom, veces: 0 };
        t.veces += 1;
        toursMap.set(clave, t);
      }
      const est = String(r['estado'] ?? '');
      if (est === 'confirmada' || est === 'completada') confirmadas += 1;
      if (est === 'cancelada' || est === 'expirada') canceladas += 1;
      const f = r['fecha_salida'] ? String(r['fecha_salida']) : null;
      if (f) {
        if (!primera || f < primera) primera = f;
        if (!ultima || f > ultima) ultima = f;
      }
    }

    return {
      id: cliente?.id ?? docIdx,
      nombre: principal.nombre,
      tipo_doc: (principal.tipo_doc ?? 'otro').toUpperCase(),
      documento_enmascarado: principal.documento_ultimos4 ? `***${principal.documento_ultimos4}` : '',
      telefono: principal.telefono ?? '',
      correo: principal.correo ?? '',
      notas: cliente?.notas ?? '',
      reservas,
      viajes: {
        total: reservas.length,
        confirmadas,
        canceladas,
        tours: [...toursMap.values()].sort((a, b) => b.veces - a.veces),
        primera_fecha: primera,
        ultima_fecha: ultima,
      },
    };
  }

  async guardarNotaCliente(id: string, body: { notas: string }, usuarioId: string) {
    const { cliente, docIdx } = await this.resolverCliente(id);
    let destino = cliente;
    if (!destino) {
      // Cliente legado sin fila en `cliente`: se crea para persistir la nota.
      if (!docIdx) throw ApiError.noEncontrado('Cliente');
      destino = this.clienteRepo.create({ doc_idx: docIdx, nombre_ultimo: 'Cliente' });
    }
    destino.notas = body.notas;
    await this.clienteRepo.save(destino);
    await this.auditoriaRepo.save(
      this.auditoriaRepo.create({
        ocurrido_en: new Date(),
        actor_tipo: 'usuario',
        usuario_id: usuarioId,
        entidad: 'cliente',
        entidad_id: destino.id ?? null,
        accion: 'cliente.nota_editada',
        valor_anterior: null,
        valor_nuevo: { notas: body.notas },
      }),
    );
    return { ok: true };
  }

  // =========================================================================
  // Reportes
  // =========================================================================

  async reportes(params: { desde: string; hasta: string }) {
    const desde = params.desde || '1970-01-01';
    const hasta = params.hasta || '2999-12-31';
    const pagosAprobados = await this.pagoRepo
      .createQueryBuilder('p')
      .where('p.estado = :e', { e: 'aprobado' })
      .andWhere('p.fecha_pago >= :d', { d: desde })
      .andWhere('p.fecha_pago <= :h', { h: hasta })
      .getMany();

    const porTour = new Map<string, { tour: string; total_usd: string; reservas: Set<string> }>();
    const porMetodo = new Map<string, { metodo: string; total_usd: number; pagos: number }>();
    const claves = await this.clavesMetodo();
    for (const p of pagosAprobados) {
      const reserva = await this.reservaRepo.findOne({ where: { id: p.reserva_id } });
      const fecha = reserva ? await this.fechaRepo.findOne({ where: { id: reserva.fecha_tour_id } }) : null;
      const tour = fecha ? await this.tourRepo.findOne({ where: { id: fecha.tour_id } }) : null;
      const nombreTour = tour?.nombre ?? 'Sin tour';
      const acc = porTour.get(nombreTour) ?? { tour: nombreTour, total_usd: '0.00', reservas: new Set<string>() };
      acc.total_usd = (num(acc.total_usd) + num(p.monto_usd_equivalente)).toFixed(2);
      acc.reservas.add(p.reserva_id);
      porTour.set(nombreTour, acc);
      const clave = claves.get(p.metodo_id) ?? 'otro';
      const mm = porMetodo.get(clave) ?? { metodo: clave, total_usd: 0, pagos: 0 };
      mm.total_usd += num(p.monto_usd_equivalente);
      mm.pagos += 1;
      porMetodo.set(clave, mm);
    }

    const pendientes = await this.pagoRepo.find({ where: { estado: In(['reportado', 'correccion_solicitada']) } });
    const reembolsosRows = await this.reembolsos.find();
    const reembolsosFiltrados = reembolsosRows.filter((r) => r.fecha >= desde && r.fecha <= hasta);

    const fechasRango = await this.fechaRepo
      .createQueryBuilder('f')
      .where('f.fecha_salida >= :d', { d: desde })
      .andWhere('f.fecha_salida <= :h', { h: hasta })
      .getMany();
    const ocupacion: Record<string, unknown>[] = [];
    for (const f of fechasRango) {
      const tour = await this.tourRepo.findOne({ where: { id: f.tour_id } });
      const total = f.cupos_total + (f.sobrecupo_autorizado ?? 0);
      ocupacion.push({
        fecha: f.fecha_salida,
        tour: tour?.nombre ?? '',
        vendidos: f.cupos_vendidos,
        total,
        pct: total > 0 ? Math.round((f.cupos_vendidos / total) * 100) : 0,
      });
    }

    return {
      ventas_por_tour: [...porTour.values()].map((v) => ({
        tour: v.tour,
        total_usd: v.total_usd,
        reservas: v.reservas.size,
      })),
      ventas_por_metodo: [...porMetodo.values()].map((v) => ({
        metodo: v.metodo,
        total_usd: v.total_usd.toFixed(2),
        pagos: v.pagos,
      })),
      pagos_pendientes: {
        total_usd: pendientes.reduce((a, p) => a + num(p.monto_usd_equivalente), 0).toFixed(2),
        pagos: pendientes.length,
      },
      reembolsos: {
        total_usd: reembolsosFiltrados.reduce((a, r) => a + num(r.monto_usd), 0).toFixed(2),
        count: reembolsosFiltrados.length,
      },
      ocupacion,
    };
  }

  // =========================================================================
  // Configuración
  // =========================================================================

  async configuracion() {
    const mapa = await this.configService.listar();
    const config = configPublica(new Map(Object.entries(mapa)));

    // Preview de la firma de la empresa: URL firmada temporal del archivo.
    const firmaArchivoId = mapa['firma_empresa_archivo_id'];
    if (firmaArchivoId) {
      try {
        config['firma_empresa_url'] = await this.archivosService.obtenerUrlFirmada(String(firmaArchivoId));
      } catch {
        // El archivo puede no existir en storage; sin preview.
      }
    }

    const [tasas, metodos, terminos, politicas, plantillas, promos, usuarios] = await Promise.all([
      this.tasas.find({ order: { vigente_desde: 'DESC' } }),
      this.metodos.find({ order: { orden: 'ASC' } }),
      this.terminosVersiones.find({ order: { version: 'DESC' } }),
      this.politicas.find(),
      this.plantillas.find(),
      this.promos.find({ order: { creado_en: 'DESC' } }),
      this.usuarios.find(),
    ]);
    const nombres = await this.nombresUsuarios(tasas.map((t) => t.registrada_por));
    const vigente = tasas[0] ?? null;
    return {
      config,
      tasa: tasas.map((t) => ({
        id: t.id,
        valor: String(t.tasa),
        registrada_por: nombres.get(t.registrada_por) ?? 'Sistema',
        registrada_en: iso(t.vigente_desde) ?? new Date().toISOString(),
        vigente: vigente?.id === t.id,
      })),
      metodos: metodos.map((m) => metodoPagoPublico(m)),
      terminos: await Promise.all(terminos.map((v) => this.terminosVersionFe(v.id))),
      politicas: politicas.map((p) => politicaPublica(p)),
      plantillas: plantillas.map((p) => ({
        id: p.id,
        clave: p.clave,
        nombre: p.clave,
        variables: p.variables ?? [],
        cuerpo: p.cuerpo,
      })),
      promos: promos.map((p) => promoPublica(p)),
      usuarios: usuarios.map((u) => this.usuarioFe(u)),
    };
  }

  async guardarConfiguracion(body: Record<string, unknown>, usuarioId: string) {
    // Acepta la forma frontend (config plana) o {clave, valor}.
    const pares: [string, unknown][] = [];
    if (typeof body.clave === 'string') {
      pares.push([body.clave, body.valor]);
    } else {
      for (const [k, v] of Object.entries(body)) {
        if (['id', 'clave', 'valor'].includes(k)) continue;
        pares.push([k, v]);
      }
    }
    for (const [clave, valor] of pares) {
      await this.configService.guardar(clave, valor, usuarioId);
    }
    const mapa = await this.configService.listar();
    return configPublica(new Map(Object.entries(mapa)));
  }

  async registrarTasa(body: { valor: string }, usuarioId: string) {
    const tasa = await this.tasas.save(
      this.tasas.create({
        tasa: Number(body.valor).toFixed(4),
        vigente_desde: new Date(),
        registrada_por: usuarioId,
        nota: 'Registrada desde el panel',
      }),
    );
    return {
      id: tasa.id,
      valor: String(tasa.tasa),
      registrada_por: usuarioId,
      registrada_en: iso(tasa.vigente_desde) ?? new Date().toISOString(),
      vigente: true,
    };
  }

  async guardarMetodoPago(body: Record<string, unknown>) {
    const id = body.id ? String(body.id) : null;
    const datosCuenta = {
      items: (body.datos as { etiqueta: string; valor: string; copiable?: boolean }[] | undefined) ?? [],
      instrucciones: body.instrucciones ?? null,
    };
    const camposRequeridos = ((body.campos_requeridos as string[] | undefined) ?? []).map((c) => ({
      clave: c,
      etiqueta: c,
      requerido: true,
    }));
    const datos = {
      clave: id ?? String(body.id ?? body.clave ?? ''),
      nombre: String(body.nombre ?? ''),
      moneda: (String(body.moneda ?? 'USD') === 'VES' ? 'VES' : 'USD') as 'USD' | 'VES',
      datos_cuenta: datosCuenta,
      campos_requeridos: camposRequeridos,
      requiere_comprobante: body.requiere_comprobante !== false,
      solo_operador: body.solo_operador === true,
      activo: body.activo !== false,
      orden: Number(body.orden ?? 0),
    };
    const porClave = await this.metodos.findOne({ where: { clave: datos.clave } });
    if (porClave) {
      Object.assign(porClave, datos);
      await this.metodos.save(porClave);
      return metodoPagoPublico(porClave);
    }
    if (id) {
      const m = await this.metodos.findOne({ where: { id } });
      if (m) {
        Object.assign(m, datos);
        await this.metodos.save(m);
        return metodoPagoPublico(m);
      }
    }
    const existente: MetodoPago | null = null;
    if (existente) {
      Object.assign(existente, datos);
      await this.metodos.save(existente);
      return metodoPagoPublico(existente);
    }
    const m = await this.metodos.save(this.metodos.create(datos));
    return metodoPagoPublico(m);
  }

  async publicarTerminos(body: { titulo: string; cuerpo: string }, usuarioId: string) {
    let plantilla = await this.plantillasTerminos.findOne({ where: { nombre: body.titulo } });
    if (!plantilla) {
      plantilla = await this.plantillasTerminos.save(this.plantillasTerminos.create({ nombre: body.titulo }));
    }
    const versiones = await this.terminosVersiones.find({ where: { plantilla_id: plantilla.id } });
    const maxV = Math.max(0, ...versiones.map((v) => v.version));
    for (const v of versiones.filter((x) => x.estado === 'publicada')) {
      v.estado = 'archivada';
      await this.terminosVersiones.save(v);
    }
    const version = await this.terminosVersiones.save(
      this.terminosVersiones.create({
        plantilla_id: plantilla.id,
        version: maxV + 1,
        contenido: body.cuerpo,
        hash_sha256: createHash('sha256').update(body.cuerpo).digest('hex'),
        estado: 'publicada',
        publicada_en: new Date(),
        publicada_por: usuarioId,
      }),
    );
    const fe = await this.terminosVersionFe(version.id);
    return fe as Record<string, unknown>;
  }

  async guardarPlantilla(body: Record<string, unknown>) {
    const id = body.id ? String(body.id) : null;
    const datos = {
      clave: String(body.clave ?? ''),
      canal: 'whatsapp' as const,
      asunto: (body.nombre as string) ?? null,
      cuerpo: String(body.cuerpo ?? ''),
      variables: (body.variables as string[]) ?? [],
      version: 1,
      activa: body.activo !== false,
    };
    if (id) {
      const p = await this.plantillas.findOne({ where: { id } });
      if (p) {
        Object.assign(p, datos);
        await this.plantillas.save(p);
        return { id: p.id, clave: p.clave, nombre: p.clave, variables: p.variables, cuerpo: p.cuerpo };
      }
    }
    const p = await this.plantillas.save(this.plantillas.create(datos));
    return { id: p.id, clave: p.clave, nombre: p.clave, variables: p.variables, cuerpo: p.cuerpo };
  }

  async guardarPolitica(body: Record<string, unknown>) {
    const id = body.id ? String(body.id) : null;
    const tramos = ((body.tramos as { dias_desde_salida: number; porcentaje_reembolso: number }[] | undefined) ?? []).map(
      (t, i, arr) => {
        const ordenados = [...arr].sort((a, b) => b.dias_desde_salida - a.dias_desde_salida);
        const idx = ordenados.indexOf(t);
        const siguiente = ordenados[idx + 1];
        return {
          dias_min: t.dias_desde_salida,
          dias_max: siguiente ? siguiente.dias_desde_salida - 1 : null,
          reembolso_pct: t.porcentaje_reembolso,
        };
      },
    );
    const datos = { nombre: String(body.nombre ?? ''), tramos };
    if (id) {
      const p = await this.politicas.findOne({ where: { id } });
      if (p) {
        Object.assign(p, datos);
        await this.politicas.save(p);
        return politicaPublica(p);
      }
    }
    const p = await this.politicas.save(this.politicas.create(datos));
    return politicaPublica(p);
  }

  async guardarPromo(body: Record<string, unknown>) {
    const id = body.id ? String(body.id) : null;
    const datos = {
      codigo: String(body.codigo ?? '').toUpperCase(),
      tipo: (body.tipo === 'monto' ? 'monto' : 'porcentaje') as 'porcentaje' | 'monto',
      valor: Number(body.valor ?? 0).toFixed(2),
      tour_id: body.tour_id ? String(body.tour_id) : null,
      desde: body.vigente_desde ? new Date(String(body.vigente_desde)) : null,
      hasta: body.vigente_hasta ? new Date(String(body.vigente_hasta)) : null,
      usos_max: body.usos_max ? Number(body.usos_max) : null,
      usos: Number(body.usos ?? 0),
      activo: body.activo !== false,
    };
    if (id) {
      const p = await this.promos.findOne({ where: { id } });
      if (p) {
        Object.assign(p, datos);
        await this.promos.save(p);
        return promoPublica(p);
      }
    }
    const p = await this.promos.save(this.promos.create(datos));
    return promoPublica(p);
  }

  async guardarUsuario(body: Record<string, unknown>, usuarioId: string) {
    const id = body.id ? String(body.id) : null;
    const datos: Record<string, unknown> = {
      nombre: body.nombre,
      correo: typeof body.correo === 'string' ? body.correo.toLowerCase() : undefined,
      activo: body.activo,
      dos_fa_activo: body.dos_factores_activo,
    };
    if (body.rol) datos.roles = [ROL_A_BE[String(body.rol)] ?? 'operador'];
    if (body.password) datos.password_hash = hashPassword(String(body.password));
    if (id) {
      const u = await this.usuarios.findOne({ where: { id } });
      if (!u) throw ApiError.noEncontrado('Usuario');
      Object.assign(u, Object.fromEntries(Object.entries(datos).filter(([, v]) => v !== undefined)));
      await this.usuarios.save(u);
      return this.usuarioFe(u);
    }
    const u = await this.usuarios.save(
      this.usuarios.create({
        nombre: String(datos.nombre ?? 'Usuario'),
        correo: String(datos.correo ?? ''),
        password_hash: hashPassword(String(body.password ?? 'demo1234')),
        roles: (datos.roles as string[]) ?? ['operador'],
        activo: datos.activo !== false,
        dos_fa_activo: datos.dos_fa_activo === true,
      } as Usuario),
    );
    void usuarioId;
    return this.usuarioFe(u);
  }

  async subirFirmaEmpresa(
    body: { nombre: string; tamano: number; imagen_base64?: string },
    usuarioId: string,
  ) {
    let archivoId: string | null = null;
    if (body.imagen_base64) {
      const dataUrl = String(body.imagen_base64);
      // Formato: data URL "data:image/png;base64,..." o base64 pelado.
      const separador = dataUrl.indexOf(',');
      const cabecera = separador >= 0 ? dataUrl.slice(0, separador) : '';
      const mime = /image\/(png|jpe?g)/.exec(cabecera)?.[0] ?? 'image/png';
      const base64 = separador >= 0 ? dataUrl.slice(separador + 1) : dataUrl;
      const buffer = Buffer.from(base64, 'base64');
      if (buffer.length === 0) {
        throw new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'FIRMA_INVALIDA', 'La imagen de la firma está vacía.');
      }
      const nombre = String(body.nombre ?? 'firma-empresa.png');
      archivoId = await this.archivosService.subir(buffer, nombre, mime, 'firma_empresa', usuarioId);
      await this.configService.guardar('firma_empresa_archivo_id', archivoId, usuarioId);
    }
    await this.configService.guardar('firma_empresa_fecha', new Date().toISOString(), usuarioId);
    await this.configService.guardar('firma_empresa_archivo', { nombre: body.nombre, tamano: body.tamano }, usuarioId);
    return { ok: true, fecha: new Date().toISOString(), archivo_id: archivoId };
  }

  // =========================================================================
  // Auditoría y notificaciones
  // =========================================================================

  async auditoria(params?: { entidad?: string; usuario_id?: string; accion?: string }) {
    const qb = this.auditoriaRepo.createQueryBuilder('a').orderBy('a.id', 'DESC').take(200);
    if (params?.entidad) qb.andWhere('a.entidad = :e', { e: params.entidad });
    if (params?.usuario_id) qb.andWhere('a.usuario_id = :u', { u: params.usuario_id });
    if (params?.accion) qb.andWhere('a.accion LIKE :ac', { ac: `%${params.accion}%` });
    const filas = await qb.getMany();
    const nombres = await this.nombresUsuarios(filas.map((f) => f.usuario_id).filter(Boolean) as string[]);
    return filas.map((f) => auditoriaPublica(f, f.usuario_id ? nombres.get(f.usuario_id) : undefined));
  }

  async notificaciones() {
    const filas = await this.notificacionRepo.find({ order: { creado_en: 'DESC' }, take: 50 });
    return filas.map((n) => notificacionPublica(n));
  }

  async marcarNotificacionLeida(id: string) {
    await this.notificacionRepo.update({ id }, { leida: true, leida_en: new Date() });
    return { ok: true };
  }

}
