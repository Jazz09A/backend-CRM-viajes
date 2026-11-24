import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { createHash, randomUUID } from 'crypto';
import {
  Archivo,
  Cliente,
  CupoOpcion,
  EnlaceReserva,
  FechaTour,
  Firma,
  Idempotencia,
  MetodoPago,
  Pasajero,
  Pago,
  PlantillaTerminos,
  PlantillaTerminosVersion,
  PoliticaCancelacion,
  Reserva,
  ReservaAjuste,
  ReservaLinea,
  Tarifa,
  TasaCambio,
  Tour,
  TourFormVersion,
  TourPuntoAbordaje,
  PuntoSalida,
  Voucher,
} from '../../database/entities';
import { ApiError } from '../../common/errors';
import { hashToken, nuevoTokenEnlace, sha256Hex } from '../../common/crypto.util';
import { cifrarONull, cifrarTexto, descifrarONull, indiceDocumento, ultimos4 } from '../../common/datos-sensibles';
import { ReservaStateMachine } from '../reservas/reserva-state-machine';
import { ConfiguracionService } from '../configuracion/configuracion.service';
import { CuposService } from '../cupos/cupos.service';
import { PagosService } from '../pagos/pagos.service';
import { ArchivosService } from '../archivos/archivos.service';
import { VouchersService } from '../vouchers/vouchers.service';
import {
  calcularPrecioAdministrado,
  categoriaPorEdad,
  detectarOpcionesAgotadas,
  edadEn,
  errorValidacion,
  esCampoComida,
  esCampoPuntoSalida,
  horaLegible,
  validarCorreo,
  validarDocumento,
  validarDocumentosUnicos,
  validarFechaNacimiento,
  validarFormulario,
  validarNombre,
  validarTelefono,
  type CampoDef,
  type ContextoFormulario,
  type Respuesta,
} from '../reservas/domain';
import {
  CATEGORIA_A_BE,
  CATEGORIA_A_FE,
  configPublica,
  fechaPublica,
  firmaPublica,
  formularioPublico,
  metodoPagoPublico,
  pasajeroPublico,
  pagoPublico,
  pasoActualDe,
  politicaPublica,
  progresoPublico,
  reservaPublica,
  tasaPublica,
  terminosPublico,
  tourPublico,
  voucherPublico,
} from './serializers';

/** Contexto cargado una vez por request del flujo público. */
interface Contexto {
  enlace: EnlaceReserva;
  reserva: Reserva;
  pasajeros: Pasajero[];
  fecha: FechaTour;
  tour: Tour;
  formVersion: TourFormVersion | null;
  tarifas: Tarifa[];
  cupos: CupoOpcion[];
  puntos: PuntoSalida[];
  /** Puntos de abordaje del tour (con su hora propia). */
  puntosTour: TourPuntoAbordaje[];
  firma: Firma | null;
  voucher: Voucher | null;
  pagos: Pago[];
  ajustes: ReservaAjuste[];
  lineas: ReservaLinea[];
  config: Map<string, unknown>;
  politica: PoliticaCancelacion | null;
  tasa: TasaCambio | null;
}

const ESTADOS_CERRADOS = new Set(['cancelada', 'expirada', 'completada']);

@Injectable()
export class PublicoService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Reserva) private readonly reservas: Repository<Reserva>,
    @InjectRepository(Cliente) private readonly clientes: Repository<Cliente>,
    @InjectRepository(EnlaceReserva) private readonly enlaces: Repository<EnlaceReserva>,
    @InjectRepository(Pasajero) private readonly pasajeros: Repository<Pasajero>,
    @InjectRepository(FechaTour) private readonly fechas: Repository<FechaTour>,
    @InjectRepository(Tarifa) private readonly tarifas: Repository<Tarifa>,
    @InjectRepository(Tour) private readonly tours: Repository<Tour>,
    @InjectRepository(TourFormVersion) private readonly formVersions: Repository<TourFormVersion>,
    @InjectRepository(PuntoSalida) private readonly puntos: Repository<PuntoSalida>,
    @InjectRepository(TourPuntoAbordaje) private readonly puntosTour: Repository<TourPuntoAbordaje>,
    @InjectRepository(CupoOpcion) private readonly cuposOpcion: Repository<CupoOpcion>,
    @InjectRepository(Firma) private readonly firmas: Repository<Firma>,
    @InjectRepository(Idempotencia) private readonly idempotencias: Repository<Idempotencia>,
    @InjectRepository(Voucher) private readonly vouchers: Repository<Voucher>,
    @InjectRepository(Pago) private readonly pagos: Repository<Pago>,
    @InjectRepository(ReservaAjuste) private readonly ajustes: Repository<ReservaAjuste>,
    @InjectRepository(MetodoPago) private readonly metodos: Repository<MetodoPago>,
    @InjectRepository(PlantillaTerminosVersion) private readonly terminosVersions: Repository<PlantillaTerminosVersion>,
    @InjectRepository(PlantillaTerminos) private readonly plantillasTerminos: Repository<PlantillaTerminos>,
    @InjectRepository(PoliticaCancelacion) private readonly politicas: Repository<PoliticaCancelacion>,
    @InjectRepository(TasaCambio) private readonly tasas: Repository<TasaCambio>,
    @InjectRepository(ReservaLinea) private readonly lineasRepo: Repository<ReservaLinea>,
    @InjectRepository(Archivo) private readonly archivos: Repository<Archivo>,
    private readonly stateMachine: ReservaStateMachine,
    private readonly configService: ConfiguracionService,
    private readonly cupos: CuposService,
    private readonly pagosService: PagosService,
    private readonly archivosService: ArchivosService,
    private readonly vouchersService: VouchersService,
  ) {}

  // -------------------------------------------------------------------------
  // Agencia
  // -------------------------------------------------------------------------

  /**
   * Datos públicos de la agencia (nombre, contacto y zona horaria).
   *
   * Sin datos sensibles: sólo lo que la interfaz necesita para presentarse con
   * el nombre real de la agencia (login, onboarding, panel).
   */
  async agencia() {
    const [nombre, email, telefono, direccion, zona_horaria] = await Promise.all([
      this.configService.obtener('agencia_nombre'),
      this.configService.obtener('agencia_email'),
      this.configService.obtener('whatsapp_agencia'),
      this.configService.obtener('agencia_direccion'),
      this.configService.obtener('zona_horaria'),
    ]);
    const texto = (valor: unknown): string | null =>
      typeof valor === 'string' && valor.trim() ? valor.trim() : null;
    return {
      nombre: texto(nombre) ?? 'Escapate Tours',
      email: texto(email),
      telefono: texto(telefono),
      direccion: texto(direccion),
      zona_horaria: texto(zona_horaria) ?? 'America/Caracas',
    };
  }

  // -------------------------------------------------------------------------
  // Carga de contexto
  // -------------------------------------------------------------------------

  private async cargarContexto(reservaId: string, enlace?: EnlaceReserva): Promise<Contexto> {
    const reserva = await this.reservas.findOne({ where: { id: reservaId } });
    if (!reserva) throw ApiError.enlaceInvalido();
    const [fecha, pasajeros, firma, voucher, pagos, ajustes, lineas] = await Promise.all([
      this.fechas.findOne({ where: { id: reserva.fecha_tour_id } }),
      this.pasajeros.find({ where: { reserva_id: reserva.id }, order: { orden: 'ASC' } }),
      this.firmas.findOne({ where: { reserva_id: reserva.id, vigente: true } }),
      this.vouchers.findOne({ where: { reserva_id: reserva.id }, order: { version: 'DESC' } }),
      this.pagos.find({ where: { reserva_id: reserva.id }, order: { creado_en: 'ASC' } }),
      this.ajustes.find({ where: { reserva_id: reserva.id } }),
      this.lineasRepo.find({ where: { reserva_id: reserva.id, tipo: 'extra' } }),
    ]);
    if (!fecha) throw ApiError.enlaceInvalido();
    const tour = await this.tours.findOne({ where: { id: fecha.tour_id } });
    if (!tour) throw ApiError.enlaceInvalido();
    const [tarifas, cupos, puntos] = await Promise.all([
      this.tarifas.find({ where: { fecha_tour_id: fecha.id } }),
      this.cuposOpcion.find({ where: { fecha_tour_id: fecha.id } }),
      // Catálogo global de puntos de salida (compartido por todos los tours).
      this.puntos.find({ where: { activo: true }, order: { orden: 'ASC' } }),
    ]);
    // Puntos del tour: la hora de recogida es la de este viaje.
    const puntosTour = await this.puntosTour.find({
      where: { tour_id: tour.id, activo: true },
      order: { orden: 'ASC' },
    });
    const formVersion = reserva.form_version_id
      ? await this.formVersions.findOne({ where: { id: reserva.form_version_id } })
      : await this.formVersions.findOne({ where: { tour_id: tour.id, estado: 'publicada' } });
    const config = await this.mapaConfig();
    const politica = tour.politica_cancelacion_id
      ? await this.politicas.findOne({ where: { id: tour.politica_cancelacion_id } })
      : null;
    const tasa = await this.tasaVigente();
    return {
      enlace: enlace ?? (await this.enlaces.findOne({ where: { reserva_id: reserva.id, estado: 'vigente' } }))!,
      reserva,
      pasajeros,
      fecha,
      tour,
      formVersion,
      tarifas,
      cupos,
      puntos,
      puntosTour,
      firma,
      voucher,
      pagos,
      ajustes,
      lineas,
      config,
      politica,
      tasa,
    };
  }

  private async mapaConfig(): Promise<Map<string, unknown>> {
    const lista = (await this.configService.listar()) as Record<string, unknown>;
    return new Map(Object.entries(lista));
  }

  private async tasaVigente(): Promise<TasaCambio | null> {
    const todas = await this.tasas.find({ order: { vigente_desde: 'DESC' } });
    const ahora = new Date();
    return todas.find((t) => new Date(t.vigente_desde) <= ahora) ?? null;
  }

  private async terminosVigente(): Promise<{ version: PlantillaTerminosVersion; plantilla: PlantillaTerminos } | null> {
    const version = await this.terminosVersions.findOne({
      where: { estado: 'publicada' },
      order: { version: 'DESC' },
    });
    if (!version) return null;
    const plantilla = await this.plantillasTerminos.findOne({ where: { id: version.plantilla_id } });
    return plantilla ? { version, plantilla } : null;
  }

  private validarAbierta(ctx: Contexto) {
    if (ESTADOS_CERRADOS.has(ctx.reserva.estado)) {
      throw new ApiError(409, 'RESERVA_CERRADA', 'Esta reserva ya está cerrada.');
    }
  }

  /**
   * Refresca la ventana de inactividad (actividad del cliente): cada paso que
   * guarda mantiene vivo el hold del cupo tomado al iniciar el registro.
   */
  private async tocarInactividad(reserva: Reserva): Promise<void> {
    if (reserva.estado === 'en_registro') {
      reserva.expira_en = await this.stateMachine.ventanaInactividad();
    }
  }

  private validarVersion(ctx: Contexto, version?: number) {    if (typeof version === 'number' && version !== ctx.reserva.version) {
      throw new ApiError(409, 'VERSION_DESACTUALIZADA', 'Se actualizó en otro dispositivo. Revisamos tus datos.');
    }
  }

  private async validarHold(ctx: Contexto) {
    const r = ctx.reserva;
    if (!r.expira_en) return;
    if (r.estado_pago === 'reportado' || r.estado === 'pago_en_verificacion') return;
    if (new Date(r.expira_en).getTime() < Date.now() && r.estado !== 'confirmada') {
      // Expira la reserva y libera el hold (el cliente ve P-12).
      try {
        await this.stateMachine.transicionar(r.id, 'expirar', { tipo: 'sistema' });
      } catch {
        // Si el estado no admite expiración, igual respondemos vencido.
      }
      const whatsapp = (await this.configService.obtener('whatsapp_agencia')) as string | null;
      throw ApiError.enlaceVencido(whatsapp ?? undefined);
    }
  }

  private fechaSalida(ctx: Contexto): string {
    return ctx.fecha.fecha_salida;
  }

  private categoriaDe(p: Pasajero, ctx: Contexto): string {
    const nac = descifrarONull(p.fecha_nacimiento_enc);
    const cat = categoriaPorEdad(
      ctx.tarifas.map((t) => ({ categoria: CATEGORIA_A_FE(t.categoria), edad_min: t.edad_min, edad_max: t.edad_max })),
      this.fechaSalida(ctx),
      nac,
    );
    return cat ?? 'Adulto';
  }

  private camposFormulario(ctx: Contexto): CampoDef[] {
    const def = (ctx.formVersion?.definicion ?? {}) as Record<string, unknown>;
    // Los campos `extra` (toldos y demás cargos) ya no se piden al cliente:
    // los gestiona la agencia en el precio administrado.
    let campos = (((def.campos as CampoDef[]) ?? []) as CampoDef[]).filter((c) => c.tipo !== 'extra');
    // Selección de comida: deshabilitada por bandera global (sin borrarla).
    if (ctx.config.get('comidas_deshabilitadas') !== false) {
      campos = campos.filter((c) => !esCampoComida(c));
    }
    // Punto de salida: las opciones vienen del catálogo global en cada render.
    // Los `seleccionable` entran al selector y, por cada ciudad sin puntos
    // elegibles, se añade una opción de ciudad (punto único real o pseudo
    // «punto por confirmar»); los puntos de referencia van en `puntos_referencia`.
    return campos.map((c) =>
      esCampoPuntoSalida(c)
        ? { ...c, opciones: this.opcionesPuntos(ctx), puntos_referencia: this.puntosReferencia(ctx) }
        : c,
    );
  }

  private opcionesPuntos(ctx: Contexto): CampoDef['opciones'] {
    const conOrden: { opcion: { valor: string; label: string }; orden: number }[] = ctx.puntos
      .filter((p) => p.activo && p.seleccionable !== false)
      .map((p) => ({
        opcion: { valor: p.clave, label: `${p.nombre}, ${horaLegible(p.hora)}` },
        orden: p.orden ?? 0,
      }));
    // Ciudades sin puntos elegibles se ofrecen a nivel ciudad:
    // - Un solo punto de referencia (p. ej. Guatire → kiosco): la opción usa
    //   la clave real del punto y muestra su nombre.
    // - Varios puntos (p. ej. Caracas): pseudo-opción «punto por confirmar»;
    //   el punto definitivo se coordina después por WhatsApp y los puntos
    //   reales siguen en `puntos_referencia` como sugerencia.
    for (const { ciudad, puntos } of this.ciudadesSinElegibles(ctx)) {
      const orden = Math.min(...puntos.map((p) => p.orden ?? 0));
      if (puntos.length === 1) {
        const p = puntos[0];
        conOrden.push({
          opcion: { valor: p.clave, label: `${ciudad} — ${p.nombre}` },
          orden,
        });
      } else {
        conOrden.push({
          opcion: { valor: this.slugCiudad(ciudad), label: `${ciudad} — punto por confirmar` },
          orden,
        });
      }
    }
    // El orden del catálogo manda: la pseudo-opción de ciudad ocupa la
    // posición de su primer punto (Guatire sigue antes que Guarenas).
    return conOrden.sort((a, b) => a.orden - b.orden).map((e) => e.opcion);
  }

  /**
   * Ciudades que tienen puntos de referencia activos pero **ningún** punto
   * elegible: el cliente elige la ciudad y el punto se resuelve solo
   * (uno solo) o se confirma después (varios).
   */
  private ciudadesSinElegibles(ctx: Contexto): { ciudad: string; puntos: PuntoSalida[] }[] {
    const porCiudad = new Map<string, PuntoSalida[]>();
    for (const p of ctx.puntos) {
      if (!p.activo) continue;
      const ciudad = (p.ciudad ?? '').trim();
      if (!ciudad) continue;
      const clave = ciudad.toLowerCase();
      const lista = porCiudad.get(clave) ?? [];
      lista.push(p);
      porCiudad.set(clave, lista);
    }
    const resultado: { ciudad: string; puntos: PuntoSalida[] }[] = [];
    for (const lista of porCiudad.values()) {
      const elegibles = lista.filter((p) => p.seleccionable !== false);
      const referencia = lista.filter((p) => p.seleccionable === false);
      if (elegibles.length === 0 && referencia.length > 0) {
        resultado.push({ ciudad: lista[0].ciudad!.trim(), puntos: referencia });
      }
    }
    return resultado;
  }

  /** Clave de la pseudo-opción de ciudad (`Caracas` → `caracas`). */
  private slugCiudad(ciudad: string): string {
    return ciudad
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  /**
   * Puntos activos que el cliente NO puede elegir, agrupados por ciudad.
   * El formulario los muestra en un bloque informativo aparte (los de
   * Caracas se confirman después por el grupo de viaje / WhatsApp).
   * El punto único que respalda una pseudo-opción de ciudad no se repite
   * aquí: ya es elegible a través de esa opción.
   */
  private puntosReferencia(ctx: Contexto): NonNullable<CampoDef['puntos_referencia']> {
    const respaldados = new Set(
      this.ciudadesSinElegibles(ctx)
        .filter((g) => g.puntos.length === 1)
        .map((g) => g.puntos[0].clave),
    );
    const grupos = new Map<string, { clave: string; nombre: string; hora: string; referencia: string | null }[]>();
    for (const p of ctx.puntos) {
      if (!p.activo || p.seleccionable !== false || respaldados.has(p.clave)) continue;
      const ciudad = (p.ciudad ?? '').trim() || 'Otros puntos';
      const lista = grupos.get(ciudad) ?? [];
      lista.push({ clave: p.clave, nombre: p.nombre, hora: horaLegible(p.hora), referencia: p.referencia ?? null });
      grupos.set(ciudad, lista);
    }
    return [...grupos.entries()].map(([ciudad, puntos]) => ({ ciudad, puntos }));
  }

  /**
   * Rechaza respuestas cuyo punto de salida no esté en la lista de opciones
   * (los puntos de referencia, p. ej. los específicos de Caracas, no son
   * elegibles; sí lo son las opciones de ciudad: la pseudo-opción `caracas`
   * o el punto único que la respalda, como el kiosco de Guatire).
   */
  private validarPuntosSeleccionables(
    ctx: Contexto,
    globales: Record<string, Respuesta>,
    porPasajero: Record<string, Record<string, Respuesta>>,
  ) {
    const campo = this.camposFormulario(ctx).find((c) => esCampoPuntoSalida(c));
    if (!campo) return;
    const validas = new Set((campo.opciones ?? []).map((o) => o.valor));
    const revisar = (valor: unknown, ref: string | null) => {
      if (typeof valor !== 'string' || !valor || validas.has(valor)) return;
      throw new ApiError(
        422,
        'PUNTO_NO_SELECCIONABLE',
        ref
          ? 'Un punto de salida no está disponible para elegir. Revisa el punto de cada pasajero.'
          : 'Elige un punto de salida de la lista.',
        [{ campo: 'punto_abordaje', codigo: 'PUNTO_NO_SELECCIONABLE', mensaje: 'Elige un punto de salida de la lista.' }],
      );
    };
    revisar(globales['punto_abordaje'], null);
    for (const respuestas of Object.values(porPasajero)) {
      revisar(respuestas?.['punto_abordaje'], 'pasajero');
    }
  }

  /** Reporte de pago desde el cliente: desactivable (flag `reporte_pago_cliente`). */
  private reportePagoClienteActivo(ctx: Contexto): boolean {
    return ctx.config.get('reporte_pago_cliente') === true;
  }

  private validarReportePagoCliente(ctx: Contexto) {
    if (!this.reportePagoClienteActivo(ctx)) {
      throw new ApiError(
        403,
        'PAGO_CLIENTE_DESACTIVADO',
        'El reporte de pago por el formulario está desactivado. La agencia se pondrá en contacto contigo para coordinar el pago.',
      );
    }
  }

  private respuestasPorPasajero(ctx: Contexto): Record<string, Record<string, Respuesta>> {
    const out: Record<string, Record<string, Respuesta>> = {};
    for (const p of ctx.pasajeros) {
      out[p.ref_cliente ?? p.id] = (p.respuestas ?? {}) as Record<string, Respuesta>;
    }
    return out;
  }

  private categoriasPorPasajero(ctx: Contexto): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of ctx.pasajeros) {
      out[p.ref_cliente ?? p.id] = CATEGORIA_A_FE(p.categoria) || this.categoriaDe(p, ctx);
    }
    return out;
  }

  private globalesDe(ctx: Contexto): Record<string, Respuesta> {
    return (ctx.reserva.respuestas_globales ?? {}) as Record<string, Respuesta>;
  }

  private contextoFormulario(ctx: Contexto): ContextoFormulario {
    const globales = this.globalesDe(ctx);
    const porPasajero = this.respuestasPorPasajero(ctx);
    // Cupos agotados: campo:valor -> true cuando no quedan.
    const agotadas: Record<string, boolean> = {};
    for (const c of ctx.cupos) {
      if (c.cupo > 0 && c.vendidos + c.retenidos >= c.cupo) agotadas[`${c.campo_id}:${c.valor}`] = true;
    }
    return {
      campos: this.camposFormulario(ctx),
      globales,
      porPasajero,
      categorias: this.categoriasPorPasajero(ctx),
      agotadas,
    };
  }

  private async totalPagado(reservaId: string): Promise<string> {
    const pagos = await this.pagos.find({ where: { reserva_id: reservaId, estado: 'aprobado' } });
    const cents = pagos.reduce((s, p) => s + Math.round(Number(p.monto_usd_equivalente) * 100), 0);
    return (cents / 100).toFixed(2);
  }

  private async tasaAplicada(ctx: Contexto): Promise<string | null> {
    const p = ctx.pagos.filter((x) => x.tasa).sort((a, b) => b.creado_en.getTime() - a.creado_en.getTime())[0];
    return p?.tasa ? String(p.tasa) : null;
  }

  /** Tarifa pública: categorías por edad sin precio (el cliente solo ve el total). */
  private tarifaSinPrecio(t: Tarifa) {
    return {
      id: t.id,
      fecha_tour_id: t.fecha_tour_id,
      categoria: CATEGORIA_A_FE(t.categoria),
      edad_min: t.edad_min,
      edad_max: t.edad_max,
    };
  }

  /** Formulario público: sin campos `extra` (toldos), sin comida deshabilitada, con puntos del catálogo y sin precios en opciones. */
  private formularioSinExtras(ctx: Contexto) {
    const v = ctx.formVersion;
    if (!v) return null;
    const pub = formularioPublico(v);
    const campos: Record<string, unknown>[] = this.camposFormulario(ctx).map((c) => {
      const { precio_usd: _precio, ...resto } = c as unknown as Record<string, unknown>;
      if (Array.isArray(resto.opciones)) {
        resto.opciones = (resto.opciones as Record<string, unknown>[]).map((o) => {
          const { precio_usd: _po, extra_usd: _eo, ...opcion } = o;
          return opcion;
        });
      }
      return resto;
    });
    return { ...pub, definicion: { campos } };
  }

  private async respuestaReserva(ctx: Contexto): Promise<Record<string, unknown>> {
    const tasaAplicada = await this.tasaAplicada(ctx);
    const terminosVersionId = ctx.reserva.terminos_version_id ?? ctx.firma?.terminos_version_id ?? null;
    const fechaSalida = this.fechaSalida(ctx);
    const base = reservaPublica({
      r: ctx.reserva,
      pasajeros: ctx.pasajeros,
      fechaSalida,
      tarifas: ctx.tarifas.map((t) => ({ categoria: CATEGORIA_A_FE(t.categoria), edad_min: t.edad_min, edad_max: t.edad_max })),
      firma: ctx.firma,
      voucher: ctx.voucher,
      terminosVersionId,
    });
    if (tasaAplicada) base.tasa_aplicada = tasaAplicada;
    base.tour_id = ctx.tour.id;
    base.fecha_tour_id = ctx.fecha.id;
    base.formulario_id = ctx.formVersion?.id ?? '';
    const progreso = progresoPublico(ctx.reserva, ctx.pasajeros, Boolean(ctx.firma));
    const formulario = this.formularioSinExtras(ctx);
    return {
      reserva: base,
      progreso,
      tour: tourPublico(ctx.tour, ctx.puntos, ctx.formVersion?.id ?? null, null, ctx.puntosTour),
      fecha: fechaPublica(ctx.fecha, ctx.cupos),
      tarifas: ctx.tarifas.map((t) => this.tarifaSinPrecio(t)),
      ...(ctx.politica ? { politica_cancelacion: politicaPublica(ctx.politica) } : {}),
      config: configPublica(ctx.config),
      ...(formulario ? { formulario } : {}),
      opciones_agotadas: detectarOpcionesAgotadas(
        ctx.cupos.map((c) => ({ campo_id: c.campo_id, opcion: c.valor, cupo: c.cupo, agotados: c.vendidos + c.retenidos })),
        { ...this.globalesDe(ctx), ...Object.values(this.respuestasPorPasajero(ctx)).reduce((acc, r) => ({ ...acc, ...r }), {}) },
      ),
    };
  }

  async reserva(token: string) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    // El ENLACE caduca si el cliente nunca inició (RF-4.4): 410 → P-10.
    if (
      reserva.estado === 'enlace_creado' &&
      reserva.expira_en &&
      new Date(reserva.expira_en).getTime() < Date.now()
    ) {
      throw ApiError.enlaceVencido((await this.configService.obtener('whatsapp_agencia')) as string | null ?? undefined);
    }
    const ctx = await this.cargarContexto(reserva.id);
    return this.respuestaReserva(ctx);
  }

  // -------------------------------------------------------------------------
  // Registro
  // -------------------------------------------------------------------------

  async iniciar(token: string, body: { acepta_aviso_privacidad?: boolean }) {
    const { reserva, enlace } = await this.stateMachine.resolverPorToken(token);
    if (reserva.estado !== 'enlace_creado') {
      return { reserva_id: reserva.id, ya_iniciada: true };
    }
    if (body.acepta_aviso_privacidad !== true) {
      throw ApiError.validacion('Necesitamos que aceptes el aviso de privacidad para continuar.', [
        { campo: 'acepta_aviso_privacidad', codigo: 'VALIDACION', mensaje: 'Marca la casilla para continuar.' },
      ]);
    }
    reserva.aviso_privacidad_en = new Date();
    reserva.aviso_privacidad_version = 'v1';
    await this.reservas.save(reserva);
    enlace.usado_en = new Date();
    if (enlace.estado === 'vigente') enlace.estado = 'usado';
    await this.enlaces.save(enlace);
    await this.stateMachine.transicionar(reserva.id, 'iniciar_registro', { tipo: 'cliente' });

    // Titular placeholder (las pantallas lo esperan desde el inicio).
    const existe = await this.pasajeros.findOne({ where: { reserva_id: reserva.id, es_titular: true } });
    if (!existe) {
      await this.pasajeros.save(
        this.pasajeros.create({
          reserva_id: reserva.id,
          orden: 0,
          es_titular: true,
          ref_cliente: randomUUID(),
          nombre: '',
          tipo_doc: 'V',
          categoria: 'adulto',
          respuestas: {},
        }),
      );
    }
    return { reserva_id: reserva.id, ya_iniciada: false };
  }

  async guardarTitular(token: string, body: Record<string, unknown>, version?: number) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    const ctx = await this.cargarContexto(reserva.id);
    this.validarAbierta(ctx);
    this.validarVersion(ctx, version);

    const datos = {
      nombre: String(body.nombre ?? ''),
      tipo_doc: String(body.tipo_doc ?? 'V').toUpperCase(),
      documento: String(body.documento ?? ''),
      fecha_nacimiento: String(body.fecha_nacimiento ?? ''),
      correo: String(body.correo ?? ''),
      telefono: String(body.telefono ?? ''),
      contacto_emergencia_nombre: body.contacto_emergencia_nombre ? String(body.contacto_emergencia_nombre) : undefined,
      contacto_emergencia_telefono: body.contacto_emergencia_telefono ? String(body.contacto_emergencia_telefono) : undefined,
    };

    const detalles: { campo: string; mensaje: string }[] = [];
    const nombre = validarNombre(datos.nombre);
    if (!nombre.ok) detalles.push({ campo: 'nombre', mensaje: nombre.mensaje! });
    const doc = validarDocumento(datos.tipo_doc === 'OTRO' ? 'OTRO' : datos.tipo_doc, datos.documento);
    if (!doc.ok) detalles.push({ campo: 'documento', mensaje: doc.mensaje! });
    const correo = validarCorreo(datos.correo);
    if (!correo.ok) detalles.push({ campo: 'correo', mensaje: correo.mensaje! });
    const telefono = validarTelefono(datos.telefono);
    if (!telefono.ok) detalles.push({ campo: 'telefono', mensaje: telefono.mensaje! });
    if (!datos.fecha_nacimiento) {
      detalles.push({ campo: 'fecha_nacimiento', mensaje: 'Escribe la fecha de nacimiento.' });
    } else {
      const fn = validarFechaNacimiento(datos.fecha_nacimiento);
      if (!fn.ok) detalles.push({ campo: 'fecha_nacimiento', mensaje: fn.mensaje! });
    }

    const edad = datos.fecha_nacimiento ? edadEn(datos.fecha_nacimiento, this.fechaSalida(ctx)) : null;
    if (edad !== null && edad < 18) {
      throw new ApiError(422, 'TITULAR_MENOR_DE_EDAD', 'El titular debe ser mayor de 18 años. Pide a un adulto responsable que haga la reserva.', [
        { campo: 'fecha_nacimiento', codigo: 'TITULAR_MENOR_DE_EDAD', mensaje: 'El titular debe ser mayor de 18 años. Pide a un adulto responsable que haga la reserva.' },
      ]);
    }

    const docNormalizado =
      datos.tipo_doc === 'OTRO' || datos.tipo_doc === 'P'
        ? datos.documento.trim().toUpperCase()
        : datos.documento.replace(/\D/g, '');
    const otros = ctx.pasajeros.filter((p) => !p.es_titular).map((p) => ({
      tipo_doc: (p.tipo_doc ?? 'otro').toUpperCase(),
      documento: descifrarONull(p.documento_enc),
    }));
    const dup = validarDocumentosUnicos([{ tipo_doc: datos.tipo_doc, documento: docNormalizado }, ...otros]);
    if (!dup.ok) {
      throw new ApiError(422, 'DOCUMENTO_DUPLICADO', 'Este documento ya está en la reserva.', [
        { campo: 'documento', codigo: 'DOCUMENTO_DUPLICADO', mensaje: 'Este documento ya está en la reserva.' },
      ]);
    }

    if (detalles.length > 0) {
      throw new ApiError(422, 'VALIDACION', 'Revisa los datos marcados antes de continuar.', detalles.map((d) => ({ campo: d.campo, codigo: 'VALIDACION', mensaje: d.mensaje })));
    }

    let titular = ctx.pasajeros.find((p) => p.es_titular);
    if (!titular) {
      titular = this.pasajeros.create({
        reserva_id: reserva.id,
        orden: 0,
        es_titular: true,
        ref_cliente: randomUUID(),
        nombre: '',
        tipo_doc: 'otro',
        categoria: 'adulto',
        respuestas: {},
      });
      ctx.pasajeros.push(titular);
    }

    titular.nombre = datos.nombre.trim();
    titular.tipo_doc = datos.tipo_doc === 'OTRO' ? 'otro' : (datos.tipo_doc as 'V' | 'E' | 'P');
    titular.documento_enc = cifrarTexto(docNormalizado);
    titular.documento_idx = indiceDocumento(datos.tipo_doc === 'OTRO' ? 'OTRO' : datos.tipo_doc, docNormalizado);
    titular.documento_ultimos4 = ultimos4(docNormalizado);
    titular.fecha_nacimiento_enc = cifrarTexto(datos.fecha_nacimiento);
    titular.edad_al_viaje = edad;
    titular.categoria = CATEGORIA_A_BE(this.categoriaDe(titular, ctx));
    titular.telefono = datos.telefono;
    titular.correo = datos.correo;
    titular.emergencia_nombre = datos.contacto_emergencia_nombre ?? null;
    titular.emergencia_telefono = datos.contacto_emergencia_telefono ?? null;
    // Foto del documento: se procesa sólo si el cliente la envía en esta
    // llamada (la reenvía únicamente cuando cambió).
    const fotoTitular = await this.fotoDocumentoEntrada(
      reserva.id,
      body.documento_imagen,
      titular.documento_imagen_id,
    );
    if (fotoTitular !== undefined) titular.documento_imagen_id = fotoTitular;
    await this.pasajeros.save(titular);

    ctx.reserva.version += 1;
    ctx.reserva.ultima_actividad_en = new Date();
    await this.tocarInactividad(ctx.reserva);
    await this.reservas.save(ctx.reserva);
    await this.sincronizarClientes(reserva.id);
    // Devuelve el id de la foto para que el cliente sepa que quedó guardada.
    return { version: ctx.reserva.version, documento_imagen_id: titular.documento_imagen_id ?? null };
  }

  /**
   * Autocompletado del titular por documento: busca entre los pasajeros de
   * **cualquier reserva anterior** (no sólo del enlace actual). Devuelve los
   * datos que el formulario puede rellenar en los campos vacíos; el cliente
   * decide qué usar y nunca sobrescribe lo que el usuario ya escribió.
   */
  async datosPorDocumento(token: string, body: { tipo_doc?: string; documento?: string }) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    const tipo = String(body.tipo_doc ?? 'V').toUpperCase();
    const doc = String(body.documento ?? '').trim();
    if (doc.length < 5) {
      throw new ApiError(422, 'VALIDACION', 'Escribe un número de documento válido.', [
        { campo: 'documento', codigo: 'DOCUMENTO_INVALIDO', mensaje: 'Escribe un número de documento válido.' },
      ]);
    }
    const norm =
      tipo === 'OTRO' || tipo === 'P' ? doc.toUpperCase() : doc.replace(/\D/g, '');
    const idx = indiceDocumento(tipo === 'OTRO' ? 'OTRO' : tipo, norm);
    const coincidencias = await this.pasajeros
      .createQueryBuilder('p')
      .where('p.documento_idx = :idx', { idx })
      .orderBy('p.creado_en', 'DESC')
      .take(5)
      .getMany();
    // El pasajero de esta misma reserva no aporta nada nuevo: preferimos los
    // de reservas anteriores (los más recientes primero).
    const previo = coincidencias.find((p) => p.reserva_id !== reserva.id) ?? null;
    if (!previo) return { encontrado: false };
    return {
      encontrado: true,
      datos: {
        nombre: previo.nombre || null,
        fecha_nacimiento: descifrarONull(previo.fecha_nacimiento_enc) || null,
        telefono: previo.telefono ?? null,
        correo: previo.correo ?? null,
        contacto_emergencia_nombre: previo.emergencia_nombre ?? null,
        contacto_emergencia_telefono: previo.emergencia_telefono ?? null,
      },
    };
  }

  /**
   * Upsert de la tabla `cliente` para cada pasajero con documento
   * (`documento_idx` es la clave de deduplicación — el mismo documento
   * nunca genera dos clientes). `reserva.cliente_id` apunta al cliente
   * del titular.
   */
  private async sincronizarClientes(reservaId: string): Promise<void> {
    const reserva = await this.reservas.findOne({ where: { id: reservaId } });
    const pasajeros = await this.pasajeros.find({ where: { reserva_id: reservaId } });
    if (!reserva || !pasajeros.length) return;

    const titular = pasajeros.find((p) => p.es_titular);
    let clienteTitularId: string | null = null;

    for (const p of pasajeros) {
      if (!p.documento_idx) continue;
      const apellido = p.nombre.trim().split(/\s+/).pop() ?? p.nombre.trim();
      let cliente = await this.clientes.findOne({ where: { doc_idx: p.documento_idx } });
      if (!cliente) {
        cliente = this.clientes.create({ doc_idx: p.documento_idx, nombre_ultimo: apellido });
      } else if (cliente.nombre_ultimo !== apellido) {
        cliente.nombre_ultimo = apellido;
      }
      cliente = await this.clientes.save(cliente);
      if (p === titular) clienteTitularId = cliente.id;
    }

    if (clienteTitularId && reserva.cliente_id !== clienteTitularId) {
      reserva.cliente_id = clienteTitularId;
      await this.reservas.save(reserva);
    }
  }

  async guardarAcompanantes(token: string, pasajeros: Record<string, unknown>[], version?: number) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    const ctx = await this.cargarContexto(reserva.id);
    this.validarAbierta(ctx);
    this.validarVersion(ctx, version);

    const max = Number(ctx.config.get('max_pasajeros_reserva') ?? 10);
    if (pasajeros.length > max) {
      throw errorValidacion([{ campo: 'pasajeros', mensaje: `Máximo ${max} pasajeros por reserva.` }]);
    }

    const docs = pasajeros.map((p) => ({
      tipo_doc: String(p.tipo_doc ?? 'V').toUpperCase(),
      documento: String(p.documento ?? ''),
    }));
    const dup = validarDocumentosUnicos(docs);
    if (!dup.ok) {
      throw new ApiError(422, 'DOCUMENTO_DUPLICADO', 'Este documento ya está en la reserva.', [
        { campo: 'pasajeros', codigo: 'DOCUMENTO_DUPLICADO', mensaje: 'Este documento ya está en la reserva.' },
      ]);
    }

    const titular = ctx.pasajeros.find((p) => p.es_titular);
    if (!titular) {
      throw errorValidacion([{ campo: 'pasajeros', mensaje: 'No encontramos al titular de la reserva.' }]);
    }

    // El cliente envía el reemplazo completo; el titular lo identifica el servidor.
    const entranteTitular = pasajeros.find((p) => p.es_titular === true);
    if (entranteTitular) {
      const refNuevo = entranteTitular.ref_cliente ? String(entranteTitular.ref_cliente) : titular.ref_cliente;
      if (refNuevo && refNuevo !== titular.ref_cliente) {
        titular.ref_cliente = refNuevo;
      }
      if (entranteTitular.nombre) titular.nombre = String(entranteTitular.nombre).trim();
      const docIn = String(entranteTitular.documento ?? '');
      if (docIn) {
        const tipo = String(entranteTitular.tipo_doc ?? titular.tipo_doc ?? 'V').toUpperCase();
        const norm =
          tipo === 'OTRO' || tipo === 'P' ? docIn.trim().toUpperCase() : docIn.replace(/\D/g, '');
        titular.documento_enc = cifrarTexto(norm);
        titular.documento_idx = indiceDocumento(tipo, norm);
        titular.documento_ultimos4 = ultimos4(norm);
        titular.tipo_doc = tipo === 'OTRO' ? 'otro' : (tipo as 'V' | 'E' | 'P');
      }
      const fnIn = entranteTitular.fecha_nacimiento ? String(entranteTitular.fecha_nacimiento) : '';
      if (fnIn) {
        titular.fecha_nacimiento_enc = cifrarTexto(fnIn);
        titular.edad_al_viaje = edadEn(fnIn, this.fechaSalida(ctx));
      }
      if (entranteTitular.telefono) titular.telefono = String(entranteTitular.telefono);
      if (entranteTitular.correo) titular.correo = String(entranteTitular.correo);
      if (entranteTitular.contacto_emergencia_nombre) titular.emergencia_nombre = String(entranteTitular.contacto_emergencia_nombre);
      if (entranteTitular.contacto_emergencia_telefono) titular.emergencia_telefono = String(entranteTitular.contacto_emergencia_telefono);
      titular.categoria = CATEGORIA_A_BE(this.categoriaDe(titular, ctx));
      const fotoTitular = await this.fotoDocumentoEntrada(
        reserva.id,
        entranteTitular.documento_imagen,
        titular.documento_imagen_id,
      );
      if (fotoTitular !== undefined) titular.documento_imagen_id = fotoTitular;
      await this.pasajeros.save(titular);
    }

    const companionsIn = pasajeros.filter(
      (p) => p.es_titular !== true && String(p.ref_cliente ?? '') !== (titular.ref_cliente ?? ''),
    );
    const totalNuevo = 1 + companionsIn.length;
    const companionsActuales = ctx.pasajeros.filter((p) => !p.es_titular);
    // Reutiliza filas existentes por ref_cliente; crea las nuevas.
    const porRef = new Map(companionsActuales.map((p) => [p.ref_cliente ?? p.id, p]));
    const nuevos: Pasajero[] = [];
    let orden = 1;
    for (const [i, p] of companionsIn.entries()) {
      const ref = p.ref_cliente ? String(p.ref_cliente) : randomUUID();
      const existente = porRef.get(ref);
      const tipoDoc = String(p.tipo_doc ?? 'V').toUpperCase();
      const doc = String(p.documento ?? '');
      const norm =
        tipoDoc === 'OTRO' || tipoDoc === 'P' ? doc.trim().toUpperCase() : doc.replace(/\D/g, '');
      const fn = String(p.fecha_nacimiento ?? '');
      const respuestas = (p.respuestas ?? {}) as Record<string, unknown>;
      // Foto del documento: `undefined` = no viene en el payload (se
      // conserva la guardada), `null` = el cliente la quitó.
      const idPrevia =
        existente?.documento_imagen_id ??
        (typeof p.documento_imagen_id === 'string' ? p.documento_imagen_id : null);
      const foto = await this.fotoDocumentoEntrada(reserva.id, p.documento_imagen, idPrevia);
      const datos: Partial<Pasajero> = {
        reserva_id: reserva.id,
        orden: orden++,
        es_titular: false,
        ref_cliente: ref,
        nombre: String(p.nombre ?? '').trim(),
        tipo_doc: tipoDoc === 'OTRO' ? ('otro' as const) : (tipoDoc as 'V' | 'E' | 'P'),
        documento_enc: norm ? cifrarTexto(norm) : null,
        documento_idx: norm ? indiceDocumento(tipoDoc, norm) : null,
        documento_ultimos4: norm ? ultimos4(norm) : null,
        fecha_nacimiento_enc: fn ? cifrarTexto(fn) : null,
        edad_al_viaje: fn ? edadEn(fn, this.fechaSalida(ctx)) : null,
        categoria: CATEGORIA_A_BE(String(p.categoria ?? 'Adulto')),
        telefono: p.telefono ? String(p.telefono) : null,
        correo: p.correo ? String(p.correo) : null,
        emergencia_nombre: p.contacto_emergencia_nombre ? String(p.contacto_emergencia_nombre) : null,
        emergencia_telefono: p.contacto_emergencia_telefono ? String(p.contacto_emergencia_telefono) : null,
        declara_representante: p.declara_representante === undefined ? null : Boolean(p.declara_representante),
        respuestas: respuestas as Record<string, unknown>,
        ...(foto !== undefined ? { documento_imagen_id: foto } : {}),
      };
      if (existente) {
        Object.assign(existente, datos);
        nuevos.push(existente);
        porRef.delete(ref);
      } else {
        nuevos.push(this.pasajeros.create(datos));
      }
      void i;
    }
    // Los acompañantes que ya no vienen en la lista se eliminan.
    const eliminados = [...porRef.values()];
    if (eliminados.length) await this.pasajeros.remove(eliminados);
    await this.pasajeros.save(nuevos);
    // Recalcula categorías con la fecha de salida real.
    for (const p of nuevos) {
      p.categoria = CATEGORIA_A_BE(this.categoriaDe(p, ctx));
    }
    await this.pasajeros.save(nuevos);

    // Reajusta el hold si cambió el tamaño del grupo (retiene o libera con
    // control de disponibilidad) y refresca la ventana de inactividad.
    const totalAnterior = ctx.pasajeros.length;
    if (
      ctx.reserva.cupo_estado === 'retenido' &&
      totalNuevo !== totalAnterior &&
      ctx.fecha.estado === 'publicada'
    ) {
      await this.stateMachine.ajustarHold(ctx.reserva, totalNuevo);
    }
    if (ctx.reserva.estado === 'en_registro') {
      ctx.reserva.expira_en = await this.stateMachine.ventanaInactividad();
    }

    ctx.reserva.version += 1;
    ctx.reserva.ultima_actividad_en = new Date();
    await this.reservas.save(ctx.reserva);
    await this.sincronizarClientes(reserva.id);
    const pasajerosFinales = [titular, ...nuevos];
    return {
      version: ctx.reserva.version,
      pasajeros: pasajerosFinales.map((p) => pasajeroPublico(p, this.fechaSalida(ctx), ctx.tarifas.map((t) => ({ categoria: CATEGORIA_A_FE(t.categoria), edad_min: t.edad_min, edad_max: t.edad_max })))),
    };
  }

  async guardarRespuestas(token: string, body: { por_pasajero?: Record<string, Record<string, Respuesta>>; globales?: Record<string, Respuesta> }, version?: number) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    const ctx = await this.cargarContexto(reserva.id);
    this.validarAbierta(ctx);
    this.validarVersion(ctx, version);

    // Los puntos de referencia (p. ej. los específicos de Caracas) no se
    // guardan como respuesta; la pseudo-opción `caracas` sí. Se valida lo que
    // se envía en ESTA llamada, antes de persistir.
    this.validarPuntosSeleccionables(ctx, body.globales ?? {}, body.por_pasajero ?? {});

    if (body.globales) {
      reserva.respuestas_globales = { ...(reserva.respuestas_globales ?? {}), ...body.globales };
    }
    if (body.por_pasajero) {
      for (const p of ctx.pasajeros) {
        const ref = p.ref_cliente ?? p.id;
        const nuevas = body.por_pasajero[ref];
        if (nuevas) p.respuestas = { ...(p.respuestas ?? {}), ...nuevas };
      }
      await this.pasajeros.save(ctx.pasajeros);
    }
    reserva.version += 1;
    reserva.ultima_actividad_en = new Date();
    await this.tocarInactividad(reserva);
    await this.reservas.save(reserva);
    return { version: reserva.version };
  }

  // -------------------------------------------------------------------------
  // Pasos
  // -------------------------------------------------------------------------

  async completarPaso(token: string, paso: string, payload: Record<string, unknown>, version?: number) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    const ctx = await this.cargarContexto(reserva.id);
    this.validarAbierta(ctx);
    this.validarHold(ctx);
    this.validarVersion(ctx, version);

    const detalles: { campo: string; mensaje: string }[] = [];

    if (paso === 'titular') {
      const t = ctx.pasajeros.find((p) => p.es_titular);
      if (!t?.nombre) detalles.push({ campo: 'nombre', mensaje: 'Escribe el nombre completo.' });
      if (!descifrarONull(t?.documento_enc)) detalles.push({ campo: 'documento', mensaje: 'Escribe el número de documento.' });
      if (!descifrarONull(t?.fecha_nacimiento_enc)) detalles.push({ campo: 'fecha_nacimiento', mensaje: 'Escribe la fecha de nacimiento.' });
      if (!t?.documento_imagen_id) {
        detalles.push({ campo: 'documento_imagen', mensaje: 'Sube la foto del documento de identidad.' });
      }
    }

    if (paso === 'acompanantes') {
      const politicaDoc = String(ctx.config.get('documento_menores') ?? 'opcional');
      for (const p of ctx.pasajeros) {
        if (!p.nombre) {
          detalles.push({ campo: `pasajero:${p.ref_cliente ?? p.id}:nombre`, mensaje: 'Escribe el nombre del pasajero.' });
        }
        // Política: cada pasajero viaja con su documento de identidad fotografiado.
        if (!p.documento_imagen_id) {
          detalles.push({
            campo: `pasajero:${p.ref_cliente ?? p.id}:documento_imagen`,
            mensaje: 'Sube la foto del documento de identidad.',
          });
        }
        const fn = descifrarONull(p.fecha_nacimiento_enc);
        const edad = fn ? edadEn(fn, this.fechaSalida(ctx)) : null;
        const esMenor = (edad ?? 99) < 18;
        if (!fn) {
          detalles.push({ campo: `pasajero:${p.ref_cliente ?? p.id}:fecha_nacimiento`, mensaje: 'Escribe la fecha de nacimiento.' });
        } else if (!esMenor || politicaDoc === 'obligatorio') {
          if (!descifrarONull(p.documento_enc)) {
            detalles.push({ campo: `pasajero:${p.ref_cliente ?? p.id}:documento`, mensaje: 'Escribe el número de documento.' });
          }
        }
      }
    }

    if (paso === 'preguntas') {
      const fctx = this.contextoFormulario(ctx);
      const validacion = validarFormulario(fctx);
      for (const e of validacion.errores) {
        detalles.push({
          campo: e.pasajero_ref ? `pasajero:${e.pasajero_ref}:${e.campo}` : e.campo,
          mensaje: e.mensaje,
        });
      }
    }

    if (paso === 'terminos') {
      if (!payload['scroll_completo']) {
        detalles.push({ campo: 'scroll_completo', mensaje: 'Desplázate hasta el final de los términos.' });
      }
      if (!payload['versionTerminosId']) {
        detalles.push({ campo: 'versionTerminosId', mensaje: 'No se identificó la versión de términos.' });
      }
    }

    if (detalles.length > 0) {
      throw new ApiError(422, 'VALIDACION', 'Revisa los datos marcados antes de continuar.', detalles.map((d) => ({ campo: d.campo, codigo: 'VALIDACION', mensaje: d.mensaje })));
    }

    const siguiente: Record<string, string> = {
      titular: 'acompanantes',
      acompanantes: 'preguntas',
      preguntas: 'resumen',
    };

    if (siguiente[paso]) {
      if (ctx.reserva.estado === 'enlace_creado') {
        await this.stateMachine.transicionar(reserva.id, 'iniciar_registro', { tipo: 'cliente' });
        // La transición trabaja sobre otra copia: recargar antes de mutar.
        ctx.reserva = await this.reservas.findOneByOrFail({ id: reserva.id });
      }
      ctx.reserva.paso_registro = siguiente[paso] as Reserva['paso_registro'];
      ctx.reserva.pasos_completados = { ...(ctx.reserva.pasos_completados ?? {}), [paso]: new Date().toISOString() };
      ctx.reserva.version += 1;
      ctx.reserva.ultima_actividad_en = new Date();
      await this.tocarInactividad(ctx.reserva);
      await this.reservas.save(ctx.reserva);
    }

    if (paso === 'resumen') {
      ctx.reserva.pasos_completados = { ...(ctx.reserva.pasos_completados ?? {}), resumen: new Date().toISOString() };
      ctx.reserva.version += 1;
      ctx.reserva.ultima_actividad_en = new Date();
      await this.tocarInactividad(ctx.reserva);
      await this.reservas.save(ctx.reserva);
    }

    if (paso === 'terminos') {
      ctx.reserva.terminos_version_id = String(payload['versionTerminosId']);
      ctx.reserva.version += 1;
      ctx.reserva.ultima_actividad_en = new Date();
      await this.tocarInactividad(ctx.reserva);
      await this.reservas.save(ctx.reserva);
    }

    const ctx2 = await this.cargarContexto(reserva.id);
    const actualizada = ctx2.reserva;
    return {
      version: actualizada.version,
      paso_actual: pasoActualDe(actualizada),
      progreso: progresoPublico(actualizada, ctx2.pasajeros, Boolean(ctx2.firma)),
    };
  }

  // -------------------------------------------------------------------------
  // Resumen y confirmación
  // -------------------------------------------------------------------------

  /**
   * Cálculo interno del precio administrado. Devuelve el detalle completo
   * para `confirmarResumen`; `resumen()` lo recorta antes de responder.
   */
  private async construirResumen(ctx: Contexto): Promise<Record<string, unknown>> {
    const globales = this.globalesDe(ctx);
    const categorias = ctx.pasajeros.map((p) => CATEGORIA_A_FE(p.categoria) || this.categoriaDe(p, ctx));
    const entrada = {
      pasajeros: ctx.pasajeros.map((p, i) => ({ categoria: categorias[i] })),
      tarifas: ctx.tarifas.map((t) => ({ categoria: CATEGORIA_A_FE(t.categoria), precio_usd: String(t.precio_usd) })),
      lineas: ctx.lineas.map((l) => ({
        concepto: l.concepto,
        cantidad: l.cantidad,
        precio_unit_usd: String(l.precio_unit_usd),
      })),
      ajustes: ctx.ajustes
        .filter((a) => !a.anulado_en)
        .map((a) => ({ tipo: a.tipo, monto_usd: String(a.monto_usd), motivo: a.motivo })),
      saldoPrevio: await this.totalPagado(ctx.reserva.id),
    };
    const calculo = calcularPrecioAdministrado(entrada);
    const tasaVigente = ctx.tasa ? String(ctx.tasa.tasa) : null;
    const totalBs = tasaVigente ? (Number(calculo.total_usd) * Number(tasaVigente)).toFixed(2) : null;
    const capacidad = ctx.fecha.cupos_total + (ctx.fecha.sobrecupo_autorizado ?? 0);
    const cuposRestantes = Math.max(0, capacidad - ctx.fecha.cupos_vendidos - ctx.fecha.cupos_retenidos);

    return {
      pasajeros: ctx.pasajeros.map((p) => {
        const pub = pasajeroPublico(p, this.fechaSalida(ctx), ctx.tarifas.map((t) => ({ categoria: CATEGORIA_A_FE(t.categoria), edad_min: t.edad_min, edad_max: t.edad_max })));
        const doc = descifrarONull(p.documento_enc);
        return { ...pub, documento_enmascarado: `${pub.tipo_doc}-****${doc.slice(-4)}` };
      }),
      respuestas_globales: globales,
      lineas: calculo.lineas,
      subtotal_usd: calculo.subtotal_usd,
      adicionales_usd: calculo.adicionales_usd,
      descuento_usd: calculo.descuento_usd,
      total_usd: calculo.total_usd,
      total_bs_estimado: totalBs,
      tasa_vigente: tasaVigente,
      saldo_usd: calculo.saldo_usd,
      estado_pago: ctx.reserva.estado_pago,
      ...(ctx.reserva.requiere_accion_motivo ? { requiere_accion: ctx.reserva.requiere_accion_motivo } : {}),
      cupos_restantes: cuposRestantes,
      _calculo: calculo,
    };
  }

  /** Resumen público: solo el total a pagar, sin desglose ni precios unitarios. */
  async resumen(token: string) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    const ctx = await this.cargarContexto(reserva.id);
    const r = await this.construirResumen(ctx);
    delete r._calculo;
    for (const clave of ['lineas', 'subtotal_usd', 'adicionales_usd', 'descuento_usd']) {
      delete r[clave];
    }
    return r;
  }

  async confirmarResumen(token: string, body: { version?: number; total_visto_usd?: string; acepta_politica?: boolean }, idem?: string) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);

    // Idempotencia (spec §8.2): un reintento con la misma clave devuelve la
    // misma respuesta sin repetir la transición ni duplicar el hold.
    const previa = await this.respuestaIdempotente('confirmar_resumen', reserva.id, idem);
    if (previa) return previa;

    const ctx = await this.cargarContexto(reserva.id);
    this.validarAbierta(ctx);
    this.validarHold(ctx);
    this.validarVersion(ctx, body.version);

    if (!body.acepta_politica) {
      throw errorValidacion([{ campo: 'acepta_politica', mensaje: 'Marca la casilla para continuar.' }], 'Necesitamos que aceptes la política de cancelación.');
    }

    const resumen = await this.construirResumen(ctx);
    const totalVisto = String(body.total_visto_usd ?? '').replace(',', '.');
    if (totalVisto && Math.abs(Number(totalVisto) - Number(resumen.total_usd)) > 0.004) {
      throw new ApiError(409, 'PRECIO_CAMBIO', 'El precio cambió. Revisa el total antes de confirmar.', [
        { campo: 'total', codigo: 'PRECIO_CAMBIO', mensaje: `El total ahora es $${resumen.total_usd}` },
      ]);
    }

    if (ctx.fecha.estado !== 'publicada') {
      throw new ApiError(409, 'FECHA_CERRADA', 'Esta salida ya no está disponible.');
    }
    const capacidad = ctx.fecha.cupos_total + (ctx.fecha.sobrecupo_autorizado ?? 0);
    const libres = capacidad - ctx.fecha.cupos_vendidos - ctx.fecha.cupos_retenidos;
    if (libres < ctx.pasajeros.length) {
      throw new ApiError(409, 'SIN_CUPO', 'Ya no hay cupos suficientes para tu grupo.');
    }

    // Cupos por opción para el hold.
    const opciones = this.calcularOpcionesHold(ctx);

    await this.stateMachine.transicionar(
      reserva.id,
      'confirmar_resumen',
      { tipo: 'cliente' },
      {
        datos: {
          cupo_pasajeros: ctx.pasajeros.length,
          cupo_opciones: opciones,
          calculo: resumen._calculo,
        },
      },
    );

    // Persistir totales y snapshot (autoridad del servidor). La versión ya
    // la incrementó `transicionar` (+1 exacto, sin doble bump).
    const r = await this.reservas.findOneByOrFail({ id: reserva.id });
    r.total_usd = String(resumen.total_usd);
    r.subtotal_usd = String(resumen.subtotal_usd);
    r.adicionales_usd = String(resumen.adicionales_usd);
    r.descuentos_usd = String(resumen.descuento_usd);
    r.desglose = resumen._calculo as Record<string, unknown>;
    r.politica_snapshot = ctx.politica ? politicaPublica(ctx.politica) : null;
    await this.reservas.save(r);

    const expira = r.expira_en ? new Date(r.expira_en).toISOString() : null;
    const respuesta: Record<string, unknown> = { total_usd: String(resumen.total_usd), expira_en: expira, version: r.version };
    await this.guardarRespuestaIdempotente('confirmar_resumen', reserva.id, idem, respuesta);
    return respuesta;
  }

  /** Cupos por opción: cuenta pasajeros efectivos por (campo, valor). */
  private calcularOpcionesHold(ctx: Contexto): { campo_id: string; valor: string; n: number }[] {
    const campos = this.camposFormulario(ctx);
    const porRef = this.respuestasPorPasajero(ctx);
    const globales = this.globalesDe(ctx);
    const mapa = new Map<string, number>();
    for (const cupo of ctx.cupos) {
      const campo = campos.find((c) => c.id === cupo.campo_id);
      let n = 0;
      if (campo?.alcance === 'por_pasajero') {
        for (const p of ctx.pasajeros) {
          const ref = p.ref_cliente ?? p.id;
          const resp = porRef[ref] ?? {};
          const efectivo = resp[cupo.campo_id] ?? (campo.permite_por_pasajero ? globales[cupo.campo_id] : undefined);
          const valores = Array.isArray(efectivo) ? efectivo : [efectivo];
          if (valores.includes(cupo.valor)) n += 1;
        }
      } else {
        const g = globales[cupo.campo_id];
        const valores = Array.isArray(g) ? g : [g];
        if (valores.includes(cupo.valor)) n = ctx.pasajeros.length;
        else {
          // Valores por pasajero que sobreescriben el global.
          let cuenta = 0;
          for (const p of ctx.pasajeros) {
            const ref = p.ref_cliente ?? p.id;
            const propio = porRef[ref]?.[cupo.campo_id];
            const efectivo = propio !== undefined ? propio : g;
            const vals = Array.isArray(efectivo) ? efectivo : [efectivo];
            if (vals.includes(cupo.valor)) cuenta += 1;
          }
          n = cuenta;
        }
      }
      if (n > 0) mapa.set(`${cupo.campo_id}:${cupo.valor}`, n);
    }
    return [...mapa.entries()].map(([k, n]) => {
      const [campo_id, valor] = k.split(':');
      return { campo_id, valor, n };
    });
  }

  // -------------------------------------------------------------------------
  // Términos y firma
  // -------------------------------------------------------------------------

  async terminos(token: string) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    void reserva;
    const t = await this.terminosVigente();
    if (!t) throw ApiError.noEncontrado('No encontramos los términos publicados.');
    return terminosPublico(t.version, t.plantilla);
  }

  async firmar(token: string, body: Record<string, unknown>, ip?: string, userAgent?: string, idem?: string) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);

    // Idempotencia (spec §8.2): un reintento con la misma clave devuelve la
    // misma respuesta sin crear otra firma ni repetir la transición.
    const previa = await this.respuestaIdempotente('firma', reserva.id, idem);
    if (previa) return previa;

    const ctx = await this.cargarContexto(reserva.id);
    this.validarAbierta(ctx);
    this.validarHold(ctx);

    // Los términos se aceptan una sola vez y la aceptación queda registrada en
    // la reserva (`terminos_version_id`, ver `completarPaso('terminos')`).
    // Exigir `scroll_completo` en cada intento hacía fallar siempre el primero:
    // el cliente firmaba sin haber vuelto a leer los términos en esa sesión
    // (recarga del enlace, otro dispositivo) y el backend lo rechazaba.
    const scrollCompleto = Boolean(body.scroll_completo);
    const terminosYaAceptados = Boolean(ctx.reserva.terminos_version_id);
    if (!scrollCompleto && !terminosYaAceptados) {
      throw new ApiError(422, 'VALIDACION', 'Desplázate hasta el final de los términos para poder firmar.');
    }
    const trazos = (body.trazos ?? {}) as Record<string, unknown>;
    const nTrazos = Number(trazos.n_trazos ?? body.n_trazos ?? 0);
    const longitudPx = Number(trazos.longitud_px ?? body.longitud_px ?? 0);
    const duracionMs = Number(trazos.duracion_ms ?? body.duracion_ms ?? 0);
    if (nTrazos < 1 || longitudPx < 150 || duracionMs < 300) {
      throw new ApiError(422, 'FIRMA_INVALIDA', 'La firma es muy pequeña o muy corta. Firma ocupando más espacio.');
    }

    // El frontend envía `firma_png_base64` (y aceptamos `imagen_png_base64`
    // por compatibilidad). Antes el backend leía sólo el segundo nombre y
    // guardaba archivos de 0 bytes.
    const imagenB64 = String(body.firma_png_base64 ?? body.imagen_png_base64 ?? '');
    if (!imagenB64) {
      throw new ApiError(422, 'FIRMA_INVALIDA', 'No se recibió la imagen de la firma. Intenta de nuevo.');
    }
    if (imagenB64.length > 700_000) {
      throw new ApiError(422, 'FIRMA_INVALIDA', 'La imagen de la firma es demasiado grande.');
    }

    // El frontend envía `version_terminos_id` (y aceptamos
    // `terminos_version_id` por compatibilidad con el contrato anterior).
    // Se usa `||` (no `??`) porque el cliente puede mandar cadena vacía al
    // reabrir el enlace: en ese caso vale lo registrado en la reserva.
    const versionTerminosId = String(
      body.terminos_version_id || body.version_terminos_id || reserva.terminos_version_id || '',
    );
    if (!versionTerminosId) {
      // Sin guard, un id vacío llega a Postgres como cast a uuid → 500.
      throw errorValidacion([{ campo: 'versionTerminosId', mensaje: 'No se identificó la versión de términos.' }]);
    }
    const versionTerminos = await this.terminosVersions.findOne({ where: { id: versionTerminosId } });
    if (!versionTerminos) {
      throw errorValidacion([{ campo: 'versionTerminosId', mensaje: 'No se identificó la versión de términos.' }]);
    }

    // Defensa: si ya hay una firma vigente (reintento sin clave o pestaña
    // doble), no se crea otra; se responde con la existente.
    const firmaExistente = await this.firmas.findOne({
      where: { reserva_id: reserva.id, vigente: true },
      order: { creado_en: 'DESC' },
    });
    if (firmaExistente) {
      const reservaAhora = await this.reservas.findOneByOrFail({ id: reserva.id });
      const pub = firmaPublica(firmaExistente);
      return { ok: true, hash_imagen: pub.hash_imagen, firmada_en: pub.firmada_en, version: reservaAhora.version };
    }

    // Archivo de la firma (PNG en base64 → guardado local en data/files).
    const archivo = await this.guardarArchivo(reserva.id, 'firma_cliente', imagenB64, 'image/png');
    const firma = this.firmas.create({
      reserva_id: reserva.id,
      vigente: true,
      archivo_id: archivo.id,
      hash_imagen: sha256Hex(imagenB64),
      hash_documento: sha256Hex(versionTerminos.contenido),
      contenido_hash: versionTerminos.hash_sha256,
      terminos_version_id: versionTerminos.id,
      ip: (ip ?? '0.0.0.0').slice(0, 45),
      user_agent: (userAgent ?? 'web').slice(0, 500),
      scroll_completo: scrollCompleto,
      trazos: {
        n_trazos: nTrazos,
        longitud_px: longitudPx,
        duracion_ms: duracionMs,
      },
      firmada_en: new Date(),
    });
    await this.firmas.save(firma);
    await this.stateMachine.transicionar(reserva.id, 'firmar', { tipo: 'cliente' });
    const pub = firmaPublica(firma);

    // La transición incrementó la versión del server (fuente de verdad).
    const reservaNueva = await this.reservas.findOneByOrFail({ id: reserva.id });
    const respuesta: Record<string, unknown> = {
      ok: true,
      hash_imagen: pub.hash_imagen,
      firmada_en: pub.firmada_en,
      version: reservaNueva.version,
    };
    await this.guardarRespuestaIdempotente('firma', reserva.id, idem, respuesta);
    return respuesta;
  }

  /** Devuelve la respuesta guardada para esa clave, o `null`. */
  private async respuestaIdempotente(
    endpoint: string,
    reservaId: string,
    clave: string | undefined,
  ): Promise<Record<string, unknown> | null> {
    if (!clave) return null;
    const claveAmbito = this.claveIdempotencia(endpoint, reservaId, clave);
    const existente = await this.idempotencias.findOne({ where: { clave_ambito: claveAmbito } });
    return existente ? existente.respuesta : null;
  }

  /** Guarda la respuesta de una acción exitosa (ignora carreras de pestañas). */
  private async guardarRespuestaIdempotente(
    endpoint: string,
    reservaId: string,
    clave: string | undefined,
    respuesta: Record<string, unknown>,
  ): Promise<void> {
    if (!clave) return;
    try {
      await this.idempotencias.save(
        this.idempotencias.create({
          clave_ambito: this.claveIdempotencia(endpoint, reservaId, clave),
          reserva_id: reservaId,
          endpoint,
          respuesta,
          creado_en: new Date(),
        }),
      );
    } catch {
      // Ya existe la clave: otro request ganó la carrera. Nada que hacer.
    }
  }

  private claveIdempotencia(endpoint: string, reservaId: string, clave: string): string {
    return `${endpoint}|${reservaId}|${clave}`.slice(0, 128);
  }

  private async guardarArchivo(reservaId: string, proposito: Archivo['proposito'], dataUrlOBase64: string, mime: string): Promise<Archivo> {
    const base64 = dataUrlOBase64.includes(',') ? dataUrlOBase64.split(',')[1] : dataUrlOBase64;
    const buffer = Buffer.from(base64, 'base64');
    const nombreOriginal = `${proposito}-${reservaId}-${Date.now()}.bin`;
    const archivoId = await this.archivosService.subir(buffer, nombreOriginal, mime, proposito, undefined, reservaId);
    const archivo = await this.archivos.findOne({ where: { id: archivoId } });
    if (!archivo) throw ApiError.noEncontrado('Archivo');
    return archivo;
  }

  /** Formatos y límite de la foto del documento de identidad (política: 5 MB). */
  private static readonly MIME_FOTO_DOC = new Set([
    'image/jpeg',
    'image/png',
    'image/webp',
    'application/pdf',
  ]);
  private static readonly MAX_FOTO_DOC_BYTES = 5 * 1024 * 1024;

  /**
   * Foto del documento de identidad de un pasajero: se guarda en el storage
   * privado (proposito `documento_identidad`) y devuelve su `archivo_id`.
   * Rechaza formatos fuera de la política (415) y tamaños > 5 MB (413).
   */
  private async guardarFotoDocumento(
    reservaId: string,
    entrada: unknown,
    archivoActualId?: string | null,
  ): Promise<string> {
    const datos = (entrada && typeof entrada === 'object' ? entrada : {}) as { data?: unknown; tipo?: unknown };
    const data = typeof datos.data === 'string' ? datos.data : '';
    const tipo = String(datos.tipo ?? '').toLowerCase().split(';')[0];
    if (!data || !PublicoService.MIME_FOTO_DOC.has(tipo)) {
      throw new ApiError(
        415,
        'ARCHIVO_TIPO_INVALIDO',
        'Formato no permitido: usa una foto JPG, PNG o WebP, o un PDF.',
        [{ campo: 'documento_imagen', codigo: 'ARCHIVO_TIPO_INVALIDO', mensaje: 'Formato no permitido: usa una foto JPG, PNG o WebP, o un PDF.' }],
      );
    }
    const base64 = data.includes(',') ? data.split(',')[1] : data;
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) {
      throw new ApiError(422, 'VALIDACION', 'No pudimos leer la foto del documento. Tómala de nuevo.', [
        { campo: 'documento_imagen', codigo: 'VALIDACION', mensaje: 'No pudimos leer la foto del documento. Tómala de nuevo.' },
      ]);
    }
    if (buffer.length > PublicoService.MAX_FOTO_DOC_BYTES) {
      throw new ApiError(413, 'ARCHIVO_GRANDE', 'La foto del documento supera el máximo de 5 MB.', [
        { campo: 'documento_imagen', codigo: 'ARCHIVO_GRANDE', mensaje: 'La foto del documento supera el máximo de 5 MB.' },
      ]);
    }
    // Idempotencia: si es exactamente la misma imagen que ya está guardada,
    // se conserva el archivo actual (evita duplicados en cada autoguardado).
    const sha = createHash('sha256').update(buffer).digest('hex');
    if (archivoActualId) {
      const actual = await this.archivos.findOne({ where: { id: archivoActualId } });
      if (actual && actual.sha256 === sha) return archivoActualId;
    }
    const archivo = await this.guardarArchivo(reservaId, 'documento_identidad', data, tipo);
    return archivo.id;
  }

  /**
   * Resuelve la foto enviada en un payload: `undefined` = no se envió (no
   * toca el valor guardado), `null` = el cliente la quitó, objeto = imagen
   * nueva que se guarda.
   */
  private async fotoDocumentoEntrada(
    reservaId: string,
    entrada: unknown,
    archivoActualId?: string | null,
  ): Promise<string | null | undefined> {
    if (entrada === undefined) return undefined;
    if (entrada === null) return null;
    return this.guardarFotoDocumento(reservaId, entrada, archivoActualId);
  }

  // -------------------------------------------------------------------------
  // Pagos (público)
  // -------------------------------------------------------------------------

  async metodosPago(token: string) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    void reserva;
    const metodos = await this.metodos.find({ where: { activo: true }, order: { orden: 'ASC' } });
    const tasa = await this.tasaVigente();
    return {
      metodos: metodos.filter((m) => !m.solo_operador).map((m) => metodoPagoPublico(m)),
      tasa_vigente: tasaPublica(tasa),
    };
  }

  async reportarPago(token: string, body: Record<string, unknown>, _idem?: string) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    const ctx = await this.cargarContexto(reserva.id);
    this.validarAbierta(ctx);
    this.validarReportePagoCliente(ctx);

    const metodoClave = String(body.metodo_clave ?? body.metodo ?? '');
    const metodo = await this.metodos.findOne({ where: { clave: metodoClave, activo: true } });
    if (!metodo) throw ApiError.noEncontrado('Método de pago');

    const montoReportado = String(body.monto ?? '0');
    const moneda = String(body.moneda ?? 'USD');
    const tasa = moneda === 'VES' ? Number(ctx.tasa?.tasa ?? 0) : 1;
    const total = Number(ctx.reserva.total_usd ?? 0);
    const montoNum = Number(montoReportado);
    const montoUsd = moneda === 'VES' && tasa > 0 ? montoNum / tasa : moneda === 'USDT' ? montoNum : montoNum;
    if (total > 0 && moneda === 'USD' && montoUsd > total * 2) {
      throw errorValidacion([{ campo: 'monto', mensaje: 'Revisa el monto; parece demasiado alto.' }], 'Revisa el monto; parece demasiado alto.');
    }

    // Comprobante inline (preview base64) → archivo + metadatos en campos_extra.
    let comprobanteArchivoId: string | null = null;
    const extra: Record<string, unknown> = { ...(body.campos_extra as Record<string, unknown> ?? {}) };
    const compB64 = body.comprobante_archivo_id ? null : (body.comprobante_preview as string | undefined);
    if (compB64 || body.comprobante_nombre) {
      if (compB64) {
        const archivo = await this.guardarArchivo(reserva.id, 'comprobante', String(compB64), String(body.comprobante_tipo ?? 'image/png'));
        comprobanteArchivoId = archivo.id;
      }
      extra._comprobante = {
        nombre: String(body.comprobante_nombre ?? 'comprobante'),
        tipo: String(body.comprobante_tipo ?? 'image/png'),
        tamano: Number(body.comprobante_tamano ?? 0),
        ...(compB64 ? { preview: String(compB64).slice(0, 200000) } : {}),
      };
    }

    const referencia = body.referencia ? String(body.referencia) : null;
    const referenciaNorm = referencia ? referencia.toUpperCase().replace(/[^A-Z0-9]/g, '') : null;

    // Anti-duplicado: mismo método + referencia normalizada en otra reserva.
    let duplicadoDe: string | null = null;
    if (referenciaNorm) {
      const dup = await this.pagos
        .createQueryBuilder('p')
        .innerJoin(MetodoPago, 'm', 'm.id = p.metodo_id')
        .where('m.clave = :clave', { clave: metodoClave })
        .andWhere('p.referencia_norm = :ref', { ref: referenciaNorm })
        .andWhere('p.reserva_id != :rid', { rid: reserva.id })
        .andWhere('p.estado != :anulado', { anulado: 'anulado' })
        .getOne();
      duplicadoDe = dup?.id ?? null;
    }

    const esperado = ctx.reserva.total_usd ?? '0.00';
    const pago = this.pagos.create({
      reserva_id: reserva.id,
      metodo_id: metodo.id,
      origen: 'cliente',
      estado: 'reportado',
      monto_reportado: montoReportado,
      monto: montoReportado,
      moneda: moneda as 'USD' | 'VES' | 'USDT',
      tasa: tasa ? tasa.toFixed(4) : '1',
      monto_usd_equivalente: montoUsd.toFixed(2),
      esperado_usd: String(esperado),
      fecha_pago: String(body.fecha_pago ?? new Date().toISOString().slice(0, 10)),
      referencia,
      referencia_norm: referenciaNorm,
      comprobante_archivo_id: comprobanteArchivoId,
      campos_extra: extra,
      duplicado_de_pago_id: duplicadoDe,
    });
    const guardado = await this.pagos.save(pago);

    // El pago del cliente es un acuse: queda `reportado` sin cambiar el estado
    // de la reserva ni congelar el hold. La agencia confirma la reserva cuando
    // le corresponde y registra el pago definitivo desde el panel.
    await this.pagosService.recalcularEstadoPago(reserva.id);
    return { pago_id: guardado.id };
  }

  async pagosPublicos(token: string) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    const ctx = await this.cargarContexto(reserva.id);
    const metodos = await this.metodos.find();
    const clavePorId = new Map(metodos.map((m) => [m.id, m.clave]));
    return ctx.pagos.map((p) => pagoPublico(p, clavePorId.get(p.metodo_id) ?? 'otro'));
  }

  async solicitarCorreccionPublica(token: string, pagoId: string, body: { referencia?: string; monto?: string; comprobante?: Record<string, unknown> }) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    const ctx = await this.cargarContexto(reserva.id);
    this.validarReportePagoCliente(ctx);
    const pago = await this.pagos.findOne({ where: { id: pagoId, reserva_id: reserva.id } });
    if (!pago) throw ApiError.noEncontrado('No encontramos ese pago.');
    if (body.referencia) pago.referencia = String(body.referencia);
    if (body.monto) {
      pago.monto_reportado = String(body.monto);
      pago.monto = String(body.monto);
    }
    if (body.comprobante) {
      const extra = { ...(pago.campos_extra ?? {}) };
      extra._comprobante = body.comprobante;
      pago.campos_extra = extra;
    }
    pago.estado = 'reportado';
    pago.correccion_texto = null;
    await this.pagos.save(pago);
    await this.pagosService.recalcularEstadoPago(reserva.id);
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // Voucher público
  // -------------------------------------------------------------------------

  async voucherPublico(token: string) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    if (reserva.estado === 'cancelada' || reserva.estado === 'expirada') {
      throw new ApiError(409, 'RESERVA_CERRADA', 'Esta reserva está cerrada.');
    }
    // El voucher se crea en confirmar_pago y lo procesa el worker.
    const voucher = await this.vouchers.findOne({ where: { reserva_id: reserva.id, vigente: true }, order: { version: 'DESC' } });
    if (!voucher) {
      return { estado: 'generando' };
    }
    // El worker procesa 'generando' → 'listo'/'error'.
    return {
      estado: voucher.estado,
      ...(voucher.estado === 'listo' && voucher.archivo_id ? { url_descarga: await this.archivosService.obtenerUrlFirmada(voucher.archivo_id) } : {}),
      version: voucher.version,
    };
  }

  async descargarVoucherPublico(voucherId: string, token?: string) {
    // El token de enlace es obligatorio y debe pertenecer a la misma reserva.
    if (!token) throw ApiError.noAutenticado('Enlace de reserva requerido');
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    const voucher = await this.vouchers.findOne({ where: { id: voucherId } });
    if (!voucher || voucher.reserva_id !== reserva.id || !voucher.archivo_id) {
      throw ApiError.noEncontrado('Voucher');
    }
    // URL firmada del storage abstraction (S3: absoluta; local: ruta firmada HMAC).
    const urlFirmada = await this.archivosService.obtenerUrlFirmada(voucher.archivo_id);
    // Storage local/s3: si la URL es relativa (driver local), leer el buffer
    // server-side y devolverlo directamente.
    if (!urlFirmada.startsWith('http')) {
      const { buffer, mime } = await this.archivosService.obtenerBuffer(voucher.archivo_id);
      return { contenido: buffer, mime };
    }
    return { url: urlFirmada };
  }

  async reabrirEdicion(token: string, motivo?: string) {
    const { reserva } = await this.stateMachine.resolverPorToken(token);
    this.validarAbierta({ reserva } as Contexto);
    if (!['pendiente_firma', 'pendiente_pago', 'pago_en_verificacion'].includes(reserva.estado)) {
      throw new ApiError(409, 'TRANSICION_INVALIDA', 'Ahora mismo no puedes editar esta reserva.');
    }
    await this.stateMachine.transicionar(reserva.id, 'reabrir_edicion', { tipo: 'cliente' }, { motivo });
    const r = await this.reservas.findOneByOrFail({ id: reserva.id });
    return { version: r.version };
  }

  // ---------------------------------------------------------------------------
  // Verificación pública (QR)
  // ---------------------------------------------------------------------------

  async verificar(token: string) {
    const reserva = await this.reservas.findOne({ where: { verif_token: token } });
    if (!reserva) throw ApiError.noEncontrado('Reserva');

    const [fecha, pasajeros] = await Promise.all([
      this.fechas.findOne({ where: { id: reserva.fecha_tour_id } }),
      this.pasajeros.find({ where: { reserva_id: reserva.id } }),
    ]);
    const tour = fecha ? await this.tours.findOne({ where: { id: fecha.tour_id } }) : null;

    const titular = pasajeros.find((p) => p.es_titular) ?? pasajeros[0];
    const partes = (titular?.nombre ?? '').trim().split(/\s+/).filter(Boolean);
    const titularParcial =
      partes.length > 1
        ? `${partes[0]} ${partes[partes.length - 1][0]}.`
        : (partes[0] ?? 'Cliente');

    return {
      codigo: reserva.codigo ?? reserva.ref_corta ?? reserva.id,
      titular_parcial: titularParcial,
      tour: tour?.nombre ?? '',
      fecha: fecha?.fecha_salida ?? '',
      hora: fecha?.hora_salida ?? '',
      pasajeros: pasajeros.length,
      estado: reserva.estado,
      verif_token: reserva.verif_token ?? token,
    };
  }
}
