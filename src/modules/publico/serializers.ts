import {
  CodigoPromocional,
  Configuracion,
  CupoOpcion,
  FechaTour,
  Firma,
  MetodoPago,
  Pasajero,
  Pago,
  PlantillaTerminos,
  PlantillaTerminosVersion,
  PoliticaCancelacion,
  Reserva,
  ReservaAjuste,
  TasaCambio,
  Tour,
  TourFormVersion,
  PuntoSalida,
  Voucher,
} from '../../database/entities';
import { descifrarONull } from '../../common/datos-sensibles';

/**
 * Serializadores entidad → contrato del frontend (`src/lib/domain/types.ts`).
 * El frontend espera snake_case con las formas del mock; aquí se traduce
 * sin exponer datos sensibles (documentos viajan descifrados SOLO en el
 * flujo público por enlace; en admin van enmascarados).
 */

export const CATEGORIA_A_FE = (c?: string | null): string =>
  ({ adulto: 'Adulto', nino: 'Niño', tercera_edad: 'Tercera Edad', infante: 'Infante' } as Record<string, string>)[
    (c ?? '').toLowerCase()
  ] ?? 'Adulto';

export type CategoriaBe = 'adulto' | 'nino' | 'tercera_edad' | 'infante';
export const CATEGORIA_A_BE = (c: string): CategoriaBe =>
  ({ Adulto: 'adulto', Niño: 'nino', 'Tercera Edad': 'tercera_edad', Infante: 'infante' } as Record<string, CategoriaBe>)[c] ??
  'adulto';

const iso = (d?: Date | string | null): string | null => {
  if (!d) return null;
  const date = d instanceof Date ? d : new Date(d);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

// ---------------------------------------------------------------------------
// Pasajero
// ---------------------------------------------------------------------------

export function pasajeroPublico(p: Pasajero, fechaSalida: string, tarifas: { categoria: string; edad_min: number; edad_max: number }[]): Record<string, unknown> {
  const documento = descifrarONull(p.documento_enc);
  const fechaNacimiento = descifrarONull(p.fecha_nacimiento_enc);
  void fechaSalida;
  void tarifas;
  return {
    ref_cliente: p.ref_cliente ?? p.id,
    es_titular: p.es_titular,
    nombre: p.nombre,
    tipo_doc: (p.tipo_doc ?? 'otro').toUpperCase(),
    documento,
    fecha_nacimiento: fechaNacimiento,
    categoria: CATEGORIA_A_FE(p.categoria),
    respuestas: p.respuestas ?? {},
    // Sólo el id: la imagen se sirve con URL firmada desde el panel (auditada).
    documento_imagen_id: p.documento_imagen_id ?? null,
    ...(p.telefono ? { telefono: p.telefono } : {}),
    ...(p.correo ? { correo: p.correo } : {}),
    ...(p.emergencia_nombre || p.emergencia_telefono
      ? {
          contacto_emergencia_nombre: p.emergencia_nombre ?? undefined,
          contacto_emergencia_telefono: p.emergencia_telefono ?? undefined,
        }
      : {}),
    ...(p.declara_representante !== null && p.declara_representante !== undefined
      ? { declara_representante: p.declara_representante }
      : {}),
  };
}

/** Versión admin: nunca expone documento ni fecha de nacimiento en claro. */
export function pasajeroAdmin(p: Pasajero): Record<string, unknown> {
  const { documento_enc, fecha_nacimiento_enc, documento_idx, ...resto } = p as Pasajero & Record<string, unknown>;
  void documento_enc;
  void fecha_nacimiento_enc;
  void documento_idx;
  const u4 = p.documento_ultimos4 ?? '';
  return {
    ...resto,
    tipo_doc: (p.tipo_doc ?? 'otro').toUpperCase(),
    categoria: CATEGORIA_A_FE(p.categoria),
    documento: u4 ? `********${u4}` : '',
    fecha_nacimiento: '',
    documento_enmascarado: u4 ? `***${u4}` : null,
  };
}

// ---------------------------------------------------------------------------
// Reserva / progreso
// ---------------------------------------------------------------------------

export function pasoActualDe(r: Reserva): string {
  switch (r.estado) {
    case 'enlace_creado':
      return 'paso_registro';
    case 'en_registro':
      return r.paso_registro ?? 'titular';
    case 'pendiente_firma':
      return 'firma';
    case 'pendiente_pago':
      return 'pago';
    case 'pago_en_verificacion':
      return 'verificacion';
    case 'confirmada':
    case 'completada':
      return 'confirmada';
    default:
      return 'cerrada';
  }
}

export function progresoPublico(
  r: Reserva,
  pasajeros: Pasajero[],
  tieneFirma: boolean,
  estadoPago: string,
  reportePagoActivo = true,
): Record<string, unknown> {
  const ORDEN = ['titular', 'acompanantes', 'preguntas', 'resumen', 'firma', 'pago'];
  const LABEL: Record<string, string> = {
    titular: 'Titular',
    acompanantes: 'Acompañantes',
    preguntas: 'Preguntas',
    resumen: 'Confirmación',
    firma: 'Firma',
    // Con el reporte del cliente desactivado, la agencia es quien anota el
    // pago: el paso pasa a leerse como coordinación, no como acción del cliente.
    pago: reportePagoActivo ? 'Pago' : 'Coordinación de pago',
  };
  const pasoActual = pasoActualDe(r);
  const indiceActual = ORDEN.indexOf(pasoActual);
  const cerrada = r.estado === 'cancelada' || r.estado === 'expirada' || r.estado === 'completada';

  const pasos = ORDEN.map((id, i) => {
    let estado: string;
    if (r.estado === 'confirmada' || r.estado === 'completada') estado = 'completo';
    else if (cerrada) estado = i <= Math.max(indiceActual, -1) ? 'completo' : 'bloqueado';
    else if (indiceActual < 0) estado = 'pendiente';
    else if (i < indiceActual) estado = 'completo';
    else if (i === indiceActual) estado = 'actual';
    else estado = 'bloqueado';
    return { id, label: LABEL[id] ?? id, estado };
  });

  const camposFaltantes: string[] = [];
  const titular = pasajeros.find((p) => p.es_titular);
  const docTitular = titular ? descifrarONull(titular.documento_enc) : '';
  const nacTitular = titular ? descifrarONull(titular.fecha_nacimiento_enc) : '';
  if (!titular?.nombre) camposFaltantes.push('titular.nombre');
  if (!docTitular) camposFaltantes.push('titular.documento');
  if (!nacTitular) camposFaltantes.push('titular.fecha_nacimiento');
  if (!titular?.telefono) camposFaltantes.push('titular.telefono');
  if (!titular?.correo) camposFaltantes.push('titular.correo');
  if (pasajeros.length < 1) camposFaltantes.push('pasajeros');
  if (!tieneFirma) camposFaltantes.push('firma');
  // El pago sólo falta como acción del cliente si él mismo debe reportarlo.
  if (reportePagoActivo && estadoPago !== 'pagado') camposFaltantes.push('pago');

  let mensajeReanudacion: string | undefined;
  if (r.estado === 'en_registro' && indiceActual > 0) {
    mensajeReanudacion = `Continuamos donde te quedaste: ${LABEL[pasoActual] ?? pasoActual} del tour`;
  }

  const motivoCierre =
    r.estado === 'expirada'
      ? 'expiracion'
      : r.estado === 'cancelada'
        ? (r.cancelacion_origen ?? 'agencia')
        : r.estado === 'completada'
          ? undefined
          : undefined;

  return {
    paso_actual: pasoActual,
    pasos,
    campos_faltantes: camposFaltantes,
    ultima_actividad_en: iso(r.ultima_actividad_en) ?? new Date().toISOString(),
    cerrada,
    ...(motivoCierre ? { motivo_cierre: motivoCierre } : {}),
    ...(mensajeReanudacion ? { mensaje_reanudacion: mensajeReanudacion } : {}),
  };
}

// ---------------------------------------------------------------------------
// Reserva (contrato frontend)
// ---------------------------------------------------------------------------

export function reservaPublica(opts: {
  r: Reserva;
  pasajeros: Pasajero[];
  fechaSalida: string;
  tarifas: { categoria: string; edad_min: number; edad_max: number }[];
  firma?: Firma | null;
  voucher?: Voucher | null;
  promocion?: Record<string, unknown> | null;
  terminosVersionId?: string | null;
}): Record<string, unknown> {
  const { r, pasajeros, fechaSalida, tarifas, firma, voucher, promocion, terminosVersionId } = opts;
  const pasoActual = pasoActualDe(r);
  const total = Number(r.total_usd ?? 0);
  const neto = Number(r.aprobado_usd ?? 0) - Number(r.reembolsado_usd ?? 0);
  const saldo = Math.max(0, total - neto).toFixed(2);

  return {
    id: r.id,
    codigo: r.codigo ?? '',
    ref_corta: r.ref_corta,
    tour_id: '', // el cliente lo completa desde `tour`
    fecha_tour_id: r.fecha_tour_id,
    formulario_id: '',
    estado: r.estado,
    estado_pago: r.estado_pago,
    pasajeros: pasajeros.map((p) => pasajeroPublico(p, fechaSalida, tarifas)),
    respuestas_globales: (r.respuestas_globales ?? {}) as Record<string, unknown>,
    total_usd: (r.total_usd ?? '0.00').toString(),
    saldo_usd: saldo,
    tasa_aplicada: null,
    expira_en: iso(r.expira_en),
    version: r.version,
    paso_actual: pasoActual,
    ...(r.referencia_interna ? { referencia_interna: r.referencia_interna } : {}),
    ...(r.requiere_accion || r.requiere_accion_motivo
      ? { requiere_accion: r.requiere_accion_motivo ?? 'Acción requerida' }
      : {}),
    ...(r.estado === 'cancelada' || r.estado === 'expirada'
      ? { motivo_cierre: r.estado === 'expirada' ? 'expiracion' : (r.cancelacion_origen ?? 'agencia') }
      : {}),
    ...(terminosVersionId ?? firma?.terminos_version_id
      ? { terminos_version_id: terminosVersionId ?? firma?.terminos_version_id }
      : {}),
    ...(firma ? { firma: firmaPublica(firma) } : {}),
    ...(voucher ? { voucher: voucherPublico(voucher, '', r.verif_token ?? '') } : {}),
    ...(promocion ? { promocion } : {}),
    creado_en: iso(r.creado_en) ?? new Date().toISOString(),
    ultima_actividad_en: iso(r.ultima_actividad_en) ?? new Date().toISOString(),
    titular: pasajeros.find((p) => p.es_titular)
      ? pasajeroPublico(pasajeros.find((p) => p.es_titular)!, fechaSalida, tarifas)
      : null,
    acompanantes: pasajeros
      .filter((p) => !p.es_titular)
      .map((p) => pasajeroPublico(p, fechaSalida, tarifas)),
  };
}

export function firmaPublica(f: Firma): Record<string, unknown> {
  const trazos = (f.trazos ?? {}) as Record<string, unknown>;
  const { _preview, ...restoTrazos } = trazos;
  void restoTrazos;
  return {
    id: f.id,
    hash_imagen: f.hash_imagen,
    hash_documento: f.hash_documento,
    version_terminos_id: f.terminos_version_id,
    firmada_en: iso(f.firmada_en) ?? new Date().toISOString(),
    ip: f.ip,
    user_agent: f.user_agent,
    n_trazos: f.trazos?.n_trazos ?? 0,
    longitud_px: f.trazos?.longitud_px ?? 0,
    duracion_ms: f.trazos?.duracion_ms ?? 0,
    integridad: 'ok',
    ...(_preview ? { preview: String(_preview) } : {}),
  };
}

export function voucherPublico(v: Voucher, baseUrl = '', verifToken = ''): Record<string, unknown> {
  return {
    id: v.id,
    version: v.version,
    estado: v.estado === 'listo' ? 'listo' : v.estado === 'error' ? 'error' : 'generando',
    vigente: v.vigente,
    generado_en: iso(v.generado_en ?? v.creado_en) ?? new Date().toISOString(),
    ...(v.estado === 'listo' && v.archivo_id
      ? { url_descarga: `${baseUrl}/api/v1/public/voucher/${v.id}/descarga?t=${encodeURIComponent(verifToken)}` }
      : {}),
    verif_token: verifToken,
  };
}

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

/**
 * Puntos de abordaje de un tour: la **hora es la del tour**, no la del
 * catálogo global (el mismo punto se recoge a distinta hora según el viaje).
 */
export interface PuntoTourPublico {
  clave: string;
  nombre: string;
  hora: string;
  referencia?: string | null;
  confirmar_hora?: boolean;
}

export function tourPublico(
  tour: Tour,
  puntos: PuntoSalida[],
  formVersionId: string | null,
  terminosVersionId: string | null,
  puntosTour?: PuntoTourPublico[],
): Record<string, unknown> {
  const propio = (puntosTour ?? []).map((p) => ({
    id: p.clave,
    clave: p.clave,
    nombre: p.nombre,
    hora: p.hora,
    referencia_ubicacion: p.referencia ?? '',
    mapa_url: '',
    confirmar_hora: p.confirmar_hora === true,
  }));
  return {
    id: tour.id,
    nombre: tour.nombre,
    tipo: tour.tipo,
    familia: tour.familia ?? '',
    duracion_dias: tour.duracion_dias ?? null,
    duracion_noches: tour.duracion_noches ?? null,
    descripcion: tour.descripcion ?? '',
    itinerario: tour.itinerario ?? [],
    incluye: tour.incluye ?? [],
    no_incluye: tour.no_incluye ?? [],
    imagenes: tour.imagenes ?? [],
    puntos_abordaje:
      propio.length > 0
        ? propio
        : puntos
            .filter((p) => p.activo)
            .sort((a, b) => a.orden - b.orden)
            .map((p) => ({
              id: p.id,
              clave: p.clave,
              nombre: p.nombre,
              hora: p.hora,
              referencia_ubicacion: p.referencia ?? '',
              mapa_url: '',
              confirmar_hora: false,
            })),
    estado: tour.estado,
    politica_cancelacion_id: tour.politica_cancelacion_id ?? '',
    terminos_version_id: terminosVersionId ?? '',
    formulario_id: formVersionId ?? '',
    fecha_creacion: iso(tour.creado_en) ?? new Date().toISOString(),
  };
}

export function fechaPublica(f: FechaTour, cupos: CupoOpcion[]): Record<string, unknown> {
  return {
    id: f.id,
    tour_id: f.tour_id,
    fecha_salida: f.fecha_salida,
    hora_salida: f.hora_salida,
    cupos_total: f.cupos_total + (f.sobrecupo_autorizado ?? 0),
    cupos_retenidos: f.cupos_retenidos,
    cupos_vendidos: f.cupos_vendidos,
    estado: f.estado,
    corte_venta_horas: f.corte_venta_horas,
    ...(f.cierre_motivo === 'sin_cupo' || f.cancelada_motivo
      ? { motivo_cierre: f.cancelada_motivo ?? 'Cierre manual' }
      : {}),
    opciones_cupo: cupos.map((c) => ({
      campo_id: c.campo_id,
      opcion: c.valor,
      cupo: c.cupo,
      agotados: c.vendidos + c.retenidos,
    })),
    sobrecupo_autorizado: (f.sobrecupo_autorizado ?? 0) > 0,
  };
}

export function tarifaPublica(t: { id: string; fecha_tour_id: string; categoria: string; edad_min: number; edad_max: number; precio_usd: string }): Record<string, unknown> {
  return {
    id: t.id,
    fecha_tour_id: t.fecha_tour_id,
    categoria: CATEGORIA_A_FE(t.categoria),
    edad_min: t.edad_min,
    edad_max: t.edad_max,
    precio_usd: String(t.precio_usd),
  };
}

export function formularioPublico(v: TourFormVersion): Record<string, unknown> {
  const def = (v.definicion ?? {}) as Record<string, unknown>;
  return {
    id: v.id,
    tour_id: v.tour_id,
    definicion: { campos: (def.campos as unknown[]) ?? [] },
    actualizado_en: iso(v.publicada_en ?? v.actualizado_en ?? v.creado_en) ?? new Date().toISOString(),
  };
}

export function politicaPublica(p: PoliticaCancelacion): Record<string, unknown> {
  const tramos = (p.tramos ?? []) as { dias_min: number; dias_max: number | null; reembolso_pct: number }[];
  return {
    id: p.id,
    clave: p.clave ?? '',
    nombre: p.nombre,
    tramos: tramos.map((t) => ({
      dias_desde_salida: t.dias_min,
      porcentaje_reembolso: t.reembolso_pct,
      descripcion:
        t.dias_max === null
          ? `Con ${t.dias_min} días o más de anticipación: reembolso del ${t.reembolso_pct} %.`
          : `Entre ${t.dias_min} y ${t.dias_max} días antes de la salida: reembolso del ${t.reembolso_pct} %.`,
    })),
  };
}

/** Tramos del frontend → formato entidad {dias_min,dias_max,reembolso_pct}. */
export function tramosAEntidad(tramos: { dias_desde_salida: number; porcentaje_reembolso: number }[]) {
  const ordenados = [...tramos].sort((a, b) => b.dias_desde_salida - a.dias_desde_salida);
  return ordenados.map((t, i) => {
    const siguiente = ordenados[i + 1];
    return {
      dias_min: t.dias_desde_salida,
      dias_max: siguiente ? siguiente.dias_desde_salida - 1 : null,
      reembolso_pct: t.porcentaje_reembolso,
    };
  });
}

export function configPublica(mapa: Map<string, unknown>): Record<string, unknown> {
  const get = <T>(k: string, def: T): T => (mapa.has(k) ? (mapa.get(k) as T) : def);
  const whatsapp = mapa.get('agencia_whatsapp') ?? mapa.get('whatsapp_agencia') ?? '+584121234567';
  return {
    agencia_nombre: get('agencia_nombre', 'Ruta Clara Viajes'),
    agencia_whatsapp: whatsapp,
    agencia_email: get('agencia_email', 'hola@rutaclara.ve'),
    agencia_direccion: get('agencia_direccion', 'Caracas, Venezuela'),
    idioma: 'es',
    zona_horaria: get('zona_horaria', 'America/Caracas'),
    hold_horas: Number(get('hold_horas', 24)),
    enlace_vigencia_horas: Number(mapa.get('enlace_vigencia_horas') ?? mapa.get('enlace_vigencia_h') ?? 72),
    abono_minimo_porcentaje: Number(mapa.get('abono_minimo_porcentaje') ?? mapa.get('abono_minimo_pct') ?? 50),
    max_pasajeros_reserva: Number(get('max_pasajeros_reserva', 10)),
    permite_sobreventa: Boolean(get('permite_sobreventa', false)),
    Requires_autorizacion_menores: Boolean(
      mapa.get('Requires_autorizacion_menores') ?? mapa.get('requires_autorizacion_menores') ?? true,
    ),
    documento_menores: get('documento_menores', 'opcional'),
    minutos_inactividad: Number(get('minutos_inactividad', 30)),
    ...(mapa.has('firma_empresa_fecha') ? { firma_empresa_fecha: mapa.get('firma_empresa_fecha') } : {}),
    ...(mapa.has('firma_empresa_archivo_id') ? { firma_empresa_archivo_id: mapa.get('firma_empresa_archivo_id') } : {}),
    tour_activo_default: get('tour_activo_default', ''),
    /**
     * Banderas globales del formulario (spec: se reactivan desde el panel sin
     * desplegar código):
     * - `comidas_deshabilitadas`: oculta la selección de comida al cliente.
     * - `reporte_pago_cliente`: oculta el paso de pago del cliente; la agencia
     *   anota los datos del pago desde la reserva.
     */
    comidas_deshabilitadas: get<boolean>('comidas_deshabilitadas', true) !== false,
    reporte_pago_cliente: get<boolean>('reporte_pago_cliente', false) === true,
  };
}

export function tasaPublica(t: TasaCambio | null, nombreRegistrador?: string): Record<string, unknown> | null {
  if (!t) return null;
  return {
    id: t.id,
    valor: String(t.tasa),
    registrada_por: nombreRegistrador ?? 'Sistema',
    registrada_en: iso(t.vigente_desde ?? t.creado_en) ?? new Date().toISOString(),
    vigente: true,
  };
}

export function metodoPagoPublico(m: MetodoPago): Record<string, unknown> {
  const datos = (m.datos_cuenta ?? {}) as Record<string, unknown>;
  const items = Array.isArray(datos.items) ? (datos.items as Record<string, unknown>[]) : [];
  return {
    id: m.clave,
    nombre: m.nombre,
    moneda: m.moneda === 'VES' ? 'VES' : 'USD',
    activo: m.activo,
    orden: m.orden,
    datos: items.map((i) => ({
      etiqueta: String(i.etiqueta ?? ''),
      valor: String(i.valor ?? ''),
      ...(i.copiable ? { copiable: true } : {}),
    })),
    campos_requeridos: (m.campos_requeridos ?? []).map((c) => c.clave ?? c.etiqueta),
    requiere_comprobante: m.requiere_comprobante,
    ...(datos.instrucciones ? { instrucciones: String(datos.instrucciones) } : {}),
  };
}

export function pagoPublico(p: Pago, metodoClave: string): Record<string, unknown> {
  const extra = (p.campos_extra ?? {}) as Record<string, unknown>;
  const comp = extra._comprobante as Record<string, unknown> | undefined;
  return {
    id: p.id,
    reserva_id: p.reserva_id,
    metodo: metodoClave,
    monto: String(p.monto_reportado ?? p.monto),
    moneda: p.moneda === 'USDT' ? 'USD' : p.moneda,
    tasa: p.tasa ? String(p.tasa) : null,
    fecha_pago: p.fecha_pago,
    referencia: p.referencia ?? '',
    estado: p.estado,
    ...(p.motivo_rechazo_codigo || p.motivo_rechazo_texto
      ? { motivo_rechazo: p.motivo_rechazo_codigo ?? p.motivo_rechazo_texto ?? undefined }
      : {}),
    ...(p.correccion_texto || p.motivo_rechazo_texto
      ? { comentario_validador: p.correccion_texto ?? p.motivo_rechazo_texto ?? undefined }
      : {}),
    ...(p.duplicado_de_pago_id ? { duplicado_de_pago_id: p.duplicado_de_pago_id } : {}),
    alertas: p.duplicado_de_pago_id
      ? [{ codigo: 'duplicado_referencia', mensaje: 'Esta referencia ya se usó en otra reserva.' }]
      : [],
    ...(extra._registrado_por_nombre ? { registrado_por: String(extra._registrado_por_nombre) } : {}),
    ...(p.validado_en ? { validado_en: iso(p.validado_en) ?? undefined } : {}),
    ...(comp
      ? {
          comprobante: {
            nombre: String(comp.nombre ?? 'comprobante'),
            tipo: String(comp.tipo ?? 'image/png'),
            tamano: Number(comp.tamano ?? 0),
            ...(comp.preview ? { preview: String(comp.preview) } : {}),
          },
        }
      : {}),
    creado_en: iso(p.creado_en) ?? new Date().toISOString(),
  };
}

export function terminosPublico(v: PlantillaTerminosVersion, plantilla?: PlantillaTerminos | null): Record<string, unknown> {
  return {
    id: v.id,
    version: v.version,
    titulo: plantilla?.nombre ?? 'Términos y condiciones',
    /** Clave de la plantilla: así un tour la referencia (`escapate-v1`). */
    clave: plantilla?.clave ?? '',
    plantilla_id: plantilla?.id ?? null,
    cuerpo: v.contenido,
    publicada_en: iso(v.publicada_en ?? v.creado_en) ?? new Date().toISOString(),
    activa: v.estado === 'publicada',
    hash: v.hash_sha256,
  };
}

export function promoPublica(p: CodigoPromocional): Record<string, unknown> {
  return {
    id: p.id,
    codigo: p.codigo,
    tipo: p.tipo,
    valor: Number(p.valor),
    vigente_desde: iso(p.desde) ?? '',
    vigente_hasta: iso(p.hasta) ?? '',
    usos_max: p.usos_max ?? 0,
    usos: p.usos,
    ...(p.tour_id ? { tour_id: p.tour_id } : {}),
    activo: p.activo,
  };
}

export function notificacionPublica(n: { id: string; tipo: string; titulo: string; cuerpo?: string | null; datos?: Record<string, unknown> | null; leida: boolean; creado_en: Date }): Record<string, unknown> {
  return {
    id: n.id,
    tipo: n.tipo,
    titulo: n.titulo,
    detalle: n.cuerpo ?? '',
    ...(n.datos?.entidad_id ? { entidad_id: String(n.datos.entidad_id) } : {}),
    leida: n.leida,
    fecha: iso(n.creado_en) ?? new Date().toISOString(),
  };
}

export function auditoriaPublica(a: {
  id: number;
  usuario_id?: string | null;
  entidad: string;
  entidad_id?: string | null;
  accion: string;
  valor_anterior?: unknown;
  valor_nuevo?: unknown;
  ocurrido_en: Date;
  hash?: string | null;
}, usuarioNombre?: string): Record<string, unknown> {
  const texto = (v: unknown) => (v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v));
  return {
    id: String(a.id),
    usuario_id: a.usuario_id ?? '',
    usuario_nombre: usuarioNombre ?? 'Sistema',
    entidad: a.entidad,
    entidad_id: a.entidad_id ?? '',
    accion: a.accion,
    valor_anterior: texto(a.valor_anterior),
    valor_nuevo: texto(a.valor_nuevo),
    fecha: iso(a.ocurrido_en) ?? new Date().toISOString(),
    cadena: 'ok',
  };
}

