import { ApiError } from '../../common/errors';

/**
 * Dominio de negocio del flujo público — port fiel de
 * `src/lib/domain/{pricing,validators,form-engine}.ts` del frontend.
 *
 * El servidor es la autoridad (Spec Backend §6.3): aquí se recalculan
 * precios, categorías, visibilidad y validaciones del formulario dinámico.
 * Los montos viajan como strings decimales (FD-09): nunca float para dinero.
 */

export type Respuesta = string | number | boolean | string[] | null;
export type Categoria = string;
export type TipoDocumento = 'V' | 'E' | 'P' | 'OTRO';

export interface CampoDef {
  id: string;
  label: string;
  ayuda?: string;
  tipo: string;
  alcance: 'por_reserva' | 'por_pasajero';
  obligatorio?: boolean;
  aplica_a?: Categoria[];
  permite_por_pasajero?: boolean;
  visible_si?: { campo: string } & Record<string, unknown>;
  opciones?: { valor: string; label: string; cupo?: number; agotada?: boolean; precio_usd?: string; cantidad_max?: number }[];
  precio_usd?: string;
  cantidad_max?: number;
  unidad?: string;
  max_length?: number;
  min?: number;
  max?: number;
  step?: number;
  valor_defecto?: unknown;
  /** Marca de origen para opciones dinámicas: `puntos_salida` usa el catálogo global. */
  fuente?: string;
  /** Agrupación funcional; `comida` se oculta con el flag global de comidas. */
  grupo?: string;
}

/**
 * ¿El campo es una selección de comida (almuerzo, menú infantil…)?
 * Con el flag global `comidas_deshabilitadas` estos campos se ocultan del
 * formulario público sin borrarlos de la definición.
 *
 * Además reconoce los ids de los formularios anteriores a la marca `grupo`
 * (`almuerzo`, `menu_infantil`), para no depender de republicar formularios
 * ya publicados.
 */
const CAMPOS_COMIDA_LEGADO: ReadonlySet<string> = new Set(['almuerzo', 'menu_infantil']);

export function esCampoComida(campo: CampoDef): boolean {
  return campo.grupo === 'comida' || CAMPOS_COMIDA_LEGADO.has(campo.id);
}

/**
 * ¿El campo sus opciones vienen del catálogo global de puntos de salida?
 * Se reconoce por la marca explícita o por la convención de id establecida
 * desde la primera versión de los formularios.
 */
export function esCampoPuntoSalida(campo: CampoDef): boolean {
  return campo.fuente === 'puntos_salida' || campo.id === 'punto_abordaje';
}

/** "06:30" → "6:30 a. m." para las etiquetas visibles al cliente. */
export function horaLegible(hora: string): string {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(String(hora ?? '').trim());
  if (!m) return hora;
  const h = Number(m[1]);
  const minutos = m[2];
  const sufijo = h < 12 ? 'a. m.' : 'p. m.';
  const doce = h % 12 === 0 ? 12 : h % 12;
  return `${doce}:${minutos} ${sufijo}`;
}

export interface ContextoFormulario {
  campos: CampoDef[];
  globales: Record<string, Respuesta>;
  porPasajero: Record<string, Record<string, Respuesta>>;
  categorias: Record<string, Categoria>;
  agotadas?: Record<string, boolean>;
}

// ---------------------------------------------------------------------------
// Decimales (port de src/lib/format.ts)
// ---------------------------------------------------------------------------

export function toDecimalString(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0.00';
  const normalizado = String(value).replace(',', '.').replace(/[^0-9.-]/g, '');
  const n = Number.parseFloat(normalizado);
  if (Number.isNaN(n)) return '0.00';
  return n.toFixed(2);
}

export function addDecimals(a: string, b: string): string {
  const cents = (v: string) => Math.round(Number.parseFloat(toDecimalString(v)) * 100);
  return ((cents(a) + cents(b)) / 100).toFixed(2);
}

export function subtractDecimals(a: string, b: string): string {
  const cents = (v: string) => Math.round(Number.parseFloat(toDecimalString(v)) * 100);
  return ((cents(a) - cents(b)) / 100).toFixed(2);
}

export function multiplyDecimal(a: string, factor: number): string {
  const cents = Math.round(Number.parseFloat(toDecimalString(a)) * 100);
  return ((cents * factor) / 100).toFixed(2);
}

export function plural(n: number, singular: string, pluralForma: string): string {
  return `${n} ${n === 1 ? singular : pluralForma}`;
}

export function isValidEmail(correo: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test((correo || '').trim().toLowerCase());
}

export function isValidPhone(telefono: string): boolean {
  const d = (telefono || '').replace(/\D/g, '');
  return d.length >= 10 && d.length <= 15;
}

export function edadEn(fechaNacimiento: string, fechaReferencia: string): number | null {
  if (!fechaNacimiento || !fechaReferencia) return null;
  const nac = new Date(`${fechaNacimiento.slice(0, 10)}T00:00:00.000Z`);
  const ref = new Date(`${fechaReferencia.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(nac.getTime()) || Number.isNaN(ref.getTime())) return null;
  let edad = ref.getUTCFullYear() - nac.getUTCFullYear();
  const m = ref.getUTCMonth() - nac.getUTCMonth();
  if (m < 0 || (m === 0 && ref.getUTCDate() < nac.getUTCDate())) edad -= 1;
  return edad;
}

/** Fecha local de hoy YYYY-MM-DD. */
export function hoyIso(): string {
  const h = new Date();
  const m = String(h.getMonth() + 1).padStart(2, '0');
  const d = String(h.getDate()).padStart(2, '0');
  return `${h.getFullYear()}-${m}-${d}`;
}

// ---------------------------------------------------------------------------
// Validadores de datos del cliente/titular (port de validators.ts)
// ---------------------------------------------------------------------------

export interface ResultadoValidacion {
  ok: boolean;
  mensaje?: string;
}

export function validarNombre(nombre: string): ResultadoValidacion {
  const limpio = nombre.trim();
  if (limpio.length === 0) {
    return { ok: false, mensaje: 'Escribe el nombre del pasajero, por ejemplo Juan Pérez' };
  }
  if (limpio.length > 120) {
    return { ok: false, mensaje: 'El nombre no puede tener más de 120 caracteres' };
  }
  return { ok: true };
}

export function validarDocumento(tipo: string, documento: string): ResultadoValidacion {
  const limpio = documento.trim();
  if (limpio.length === 0) {
    return { ok: false, mensaje: 'Escribe el número de documento, por ejemplo 12345678' };
  }
  if (tipo === 'V' || tipo === 'E') {
    if (!/^\d+$/.test(limpio)) {
      return { ok: false, mensaje: 'La cédula debe tener solo números, por ejemplo 12345678' };
    }
    if (limpio.length < 6 || limpio.length > 9) {
      return { ok: false, mensaje: 'La cédula debe tener entre 6 y 9 dígitos, por ejemplo 12345678' };
    }
    return { ok: true };
  }
  if (tipo === 'P') {
    if (!/^[a-zA-Z0-9]+$/.test(limpio)) {
      return { ok: false, mensaje: 'El pasaporte debe tener solo letras y números, por ejemplo A1234567' };
    }
    if (limpio.length < 6 || limpio.length > 12) {
      return { ok: false, mensaje: 'El pasaporte debe tener entre 6 y 12 caracteres, por ejemplo A1234567' };
    }
    return { ok: true };
  }
  if (limpio.length < 3 || limpio.length > 32) {
    return { ok: false, mensaje: 'El documento debe tener entre 3 y 32 caracteres, por ejemplo DOC-1234' };
  }
  return { ok: true };
}

export function validarFechaNacimiento(fecha: string): ResultadoValidacion {
  const limpio = fecha.trim();
  if (limpio.length === 0) {
    return { ok: false, mensaje: 'Escribe la fecha de nacimiento, por ejemplo 1990-05-14' };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(limpio)) {
    return { ok: false, mensaje: 'Escribe la fecha de nacimiento en formato AAAA-MM-DD, por ejemplo 1990-05-14' };
  }
  const [anio, mes, dia] = limpio.split('-').map((n) => Number.parseInt(n, 10));
  const fechaUtc = new Date(Date.UTC(anio, mes - 1, dia));
  if (fechaUtc.getUTCFullYear() !== anio || fechaUtc.getUTCMonth() !== mes - 1 || fechaUtc.getUTCDate() !== dia) {
    return { ok: false, mensaje: 'Esa fecha no existe. Revisa el día y el mes, por ejemplo 1990-05-14' };
  }
  if (limpio > hoyIso()) {
    return { ok: false, mensaje: 'La fecha de nacimiento no puede ser una fecha futura' };
  }
  const edad = edadEn(limpio, hoyIso());
  if (edad === null || edad > 120) {
    return { ok: false, mensaje: 'Revisa la fecha de nacimiento: no parece correcta' };
  }
  return { ok: true };
}

export function validarTelefono(telefono: string): ResultadoValidacion {
  const limpio = telefono.trim();
  if (limpio.length === 0) {
    return { ok: false, mensaje: 'Escribe el teléfono de contacto, por ejemplo +58 412 1234567' };
  }
  if (!isValidPhone(limpio)) {
    return { ok: false, mensaje: 'Escribe un teléfono válido, por ejemplo +58 412 1234567' };
  }
  return { ok: true };
}

export function validarCorreo(correo: string): ResultadoValidacion {
  const limpio = correo.trim();
  if (limpio.length === 0) {
    return { ok: false, mensaje: 'Escribe el correo, por ejemplo nombre@gmail.com' };
  }
  if (!isValidEmail(limpio)) {
    return { ok: false, mensaje: 'Escribe un correo válido, por ejemplo nombre@gmail.com' };
  }
  return { ok: true };
}

function claveDocumento(tipo: string, documento: string): string {
  const limpio = documento.trim();
  if (tipo === 'OTRO') return `OTRO:${limpio.toUpperCase().replace(/\s+/g, ' ')}`;
  return limpio.replace(/\D/g, '');
}

export function validarDocumentosUnicos(
  documentos: { tipo_doc: string; documento: string }[],
): { ok: boolean; mensaje?: string; indiceDuplicado?: number } {
  const vistos = new Map<string, number>();
  for (const [indice, doc] of documentos.entries()) {
    const clave = claveDocumento(doc.tipo_doc, doc.documento);
    if (clave.length === 0) continue;
    if (vistos.has(clave)) {
      return { ok: false, mensaje: 'Este documento ya está en la reserva', indiceDuplicado: indice };
    }
    vistos.set(clave, indice);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Pricing (port de pricing.ts)
// ---------------------------------------------------------------------------

export interface ExtraCalculo {
  id: string;
  label: string;
  precio_usd: string;
  cantidad_max: number;
}

export interface EntradaCalculo {
  pasajeros: { categoria: Categoria; respuestas: Record<string, Respuesta> }[];
  tarifas: { categoria: Categoria; precio_usd: string }[];
  camposExtra: ExtraCalculo[];
  respuestasGlobales: Record<string, Respuesta>;
  cuposOpcion?: { campo_id: string; opcion: string; cupo: number; agotados: number }[];
  promocion?: { tipo: 'porcentaje' | 'monto'; valor: number };
  saldoPrevio?: string;
}

export interface LineaPrecio {
  concepto: string;
  detalle: string;
  cantidad: number;
  precio_usd: string;
  total_usd: string;
}

export interface ResultadoCalculo {
  lineas: LineaPrecio[];
  subtotal_usd: string;
  adicionales_usd: string;
  descuento_usd: string;
  total_usd: string;
  saldo_usd: string;
  advertencias: string[];
}

function noNegativo(valor: string): string {
  const normalizado = toDecimalString(valor);
  return Number.parseFloat(normalizado) < 0 ? '0.00' : normalizado;
}

function aCantidad(valor: Respuesta | undefined): number | null {
  if (typeof valor === 'number' && Number.isFinite(valor)) return valor;
  if (typeof valor === 'string' && valor.trim() !== '') {
    const n = Number.parseFloat(valor);
    if (!Number.isNaN(n)) return n;
  }
  return null;
}

function cantidadExtra(id: string, entrada: EntradaCalculo): number {
  const global = aCantidad(entrada.respuestasGlobales[id]);
  if (global !== null) return global;
  let total = 0;
  for (const pasajero of entrada.pasajeros) {
    const valor = aCantidad(pasajero.respuestas[id]);
    if (valor !== null) total += valor;
  }
  return total;
}

export function calcularPrecio(entrada: EntradaCalculo): ResultadoCalculo {
  const advertencias: string[] = [];
  const lineas: LineaPrecio[] = [];

  const porCategoria = new Map<Categoria, number>();
  for (const pasajero of entrada.pasajeros) {
    porCategoria.set(pasajero.categoria, (porCategoria.get(pasajero.categoria) ?? 0) + 1);
  }

  let subtotal = '0.00';
  for (const [categoria, cantidad] of porCategoria) {
    const tarifa = entrada.tarifas.find((t) => t.categoria === categoria);
    if (!tarifa) {
      advertencias.push(
        `No tenemos tarifa para la categoría ${categoria}. Contacta a la agencia para regularizar el pago.`,
      );
      continue;
    }
    const unitario = toDecimalString(tarifa.precio_usd);
    const total = multiplyDecimal(unitario, cantidad);
    lineas.push({
      concepto: categoria,
      detalle: `${plural(cantidad, 'pasajero', 'pasajeros')} x $${unitario}`,
      cantidad,
      precio_usd: unitario,
      total_usd: total,
    });
    subtotal = addDecimals(subtotal, total);
  }

  let adicionales = '0.00';
  for (const extra of entrada.camposExtra) {
    const cantidad = cantidadExtra(extra.id, entrada);
    if (cantidad <= 0) continue;
    if (extra.cantidad_max > 0 && cantidad > extra.cantidad_max) {
      advertencias.push(
        `La cantidad de «${extra.label}» (${cantidad}) supera el máximo permitido (${extra.cantidad_max}).`,
      );
    }
    const unitario = toDecimalString(extra.precio_usd);
    const total = multiplyDecimal(unitario, cantidad);
    lineas.push({
      concepto: extra.label,
      detalle: `${plural(cantidad, 'unidad', 'unidades')} x $${unitario}`,
      cantidad,
      precio_usd: unitario,
      total_usd: total,
    });
    adicionales = addDecimals(adicionales, total);
  }

  const base = addDecimals(subtotal, adicionales);
  let descuento = '0.00';
  if (entrada.promocion) {
    if (entrada.promocion.tipo === 'porcentaje') {
      descuento = multiplyDecimal(base, entrada.promocion.valor / 100);
    } else {
      descuento = toDecimalString(entrada.promocion.valor);
    }
    if (Number.parseFloat(descuento) > Number.parseFloat(base)) descuento = base;
  }

  const total = noNegativo(subtractDecimals(base, descuento));
  const saldo = noNegativo(subtractDecimals(total, entrada.saldoPrevio ?? '0.00'));

  return {
    lineas,
    subtotal_usd: subtotal,
    adicionales_usd: adicionales,
    descuento_usd: toDecimalString(descuento),
    total_usd: total,
    saldo_usd: saldo,
    advertencias,
  };
}

// ---------------------------------------------------------------------------
// Pricing administrado (precio gestionado por la agencia)
// ---------------------------------------------------------------------------

export interface LineaAdminCalculo {
  concepto: string;
  cantidad: number;
  precio_unit_usd: string;
}

export interface AjusteAdminCalculo {
  tipo: 'descuento' | 'recargo';
  monto_usd: string;
  motivo?: string;
}

export interface EntradaCalculoAdministrado {
  pasajeros: { categoria: Categoria }[];
  tarifas: { categoria: Categoria; precio_usd: string }[];
  /** Cargos extra gestionados por el admin (reserva_linea tipo 'extra'). */
  lineas?: LineaAdminCalculo[];
  /** Ajustes manuales del admin (reserva_ajuste origen 'manual'). */
  ajustes?: AjusteAdminCalculo[];
  saldoPrevio?: string;
}

/**
 * Precio administrado: la base de tarifas se calcula con los pasajeros
 * reales; el admin solo gestiona deltas (extras tipo toldo y ajustes con
 * motivo). Misma forma de salida que `ResultadoCalculo`.
 */
export function calcularPrecioAdministrado(entrada: EntradaCalculoAdministrado): ResultadoCalculo {
  const advertencias: string[] = [];
  const lineas: LineaPrecio[] = [];

  const porCategoria = new Map<Categoria, number>();
  for (const pasajero of entrada.pasajeros) {
    porCategoria.set(pasajero.categoria, (porCategoria.get(pasajero.categoria) ?? 0) + 1);
  }

  let subtotal = '0.00';
  for (const [categoria, cantidad] of porCategoria) {
    const tarifa = entrada.tarifas.find((t) => t.categoria === categoria);
    if (!tarifa) {
      advertencias.push(
        `No tenemos tarifa para la categoría ${categoria}. Contacta a la agencia para regularizar el pago.`,
      );
      continue;
    }
    const unitario = toDecimalString(tarifa.precio_usd);
    const total = multiplyDecimal(unitario, cantidad);
    lineas.push({
      concepto: categoria,
      detalle: `${plural(cantidad, 'pasajero', 'pasajeros')} x $${unitario}`,
      cantidad,
      precio_usd: unitario,
      total_usd: total,
    });
    subtotal = addDecimals(subtotal, total);
  }

  let adicionales = '0.00';
  for (const linea of entrada.lineas ?? []) {
    const cantidad = Math.max(0, Math.floor(linea.cantidad));
    if (cantidad <= 0) continue;
    const unitario = toDecimalString(linea.precio_unit_usd);
    const total = multiplyDecimal(unitario, cantidad);
    lineas.push({
      concepto: linea.concepto,
      detalle: `${plural(cantidad, 'unidad', 'unidades')} x $${unitario}`,
      cantidad,
      precio_usd: unitario,
      total_usd: total,
    });
    adicionales = addDecimals(adicionales, total);
  }

  let recargos = '0.00';
  let descuentos = '0.00';
  for (const ajuste of entrada.ajustes ?? []) {
    const monto = toDecimalString(ajuste.monto_usd);
    const concepto = ajuste.motivo?.trim() || (ajuste.tipo === 'descuento' ? 'Descuento' : 'Recargo');
    if (ajuste.tipo === 'descuento') {
      descuentos = addDecimals(descuentos, monto);
      lineas.push({ concepto, detalle: 'Descuento administrativo', cantidad: 1, precio_usd: `-${monto}`, total_usd: `-${monto}` });
    } else {
      recargos = addDecimals(recargos, monto);
      lineas.push({ concepto, detalle: 'Recargo administrativo', cantidad: 1, precio_usd: monto, total_usd: monto });
      adicionales = addDecimals(adicionales, monto);
    }
  }

  const base = addDecimals(subtotal, adicionales);
  const total = noNegativo(subtractDecimals(base, descuentos));
  const saldo = noNegativo(subtractDecimals(total, entrada.saldoPrevio ?? '0.00'));

  return {
    lineas,
    subtotal_usd: subtotal,
    adicionales_usd: adicionales,
    descuento_usd: toDecimalString(descuentos),
    total_usd: total,
    saldo_usd: saldo,
    advertencias,
  };
}

export function categoriaPorEdad(
  tarifas: { categoria: Categoria; edad_min: number; edad_max: number }[],
  fechaSalida: string,
  fechaNacimiento: string,
): Categoria | null {
  const edad = edadEn(fechaNacimiento, fechaSalida);
  if (edad === null) return null;
  const tarifa = tarifas.find((t) => edad >= t.edad_min && edad <= t.edad_max);
  return tarifa ? tarifa.categoria : null;
}

export function detectarOpcionesAgotadas(
  cuposOpcion: { campo_id: string; opcion: string; cupo: number; agotados: number }[],
  respuestas: Record<string, Respuesta>,
): Record<string, boolean> {
  const agotadas: Record<string, boolean> = {};
  const estadoPorOpcion = new Map<string, boolean>();
  for (const cupo of cuposOpcion) {
    const clave = `${cupo.campo_id}:${cupo.opcion}`;
    const agotado = cupo.cupo <= cupo.agotados;
    estadoPorOpcion.set(clave, agotado);
    if (agotado) agotadas[clave] = true;
  }
  for (const [campoId, valor] of Object.entries(respuestas)) {
    const valores = Array.isArray(valor) ? valor : [valor];
    for (const v of valores) {
      if (typeof v !== 'string') continue;
      const clave = `${campoId}:${v}`;
      if (estadoPorOpcion.get(clave) === true) agotadas[clave] = true;
    }
  }
  return agotadas;
}

// ---------------------------------------------------------------------------
// Form engine (port de form-engine.ts — subconjunto fiel)
// ---------------------------------------------------------------------------

const TIPOS_SOPORTADOS = new Set(['text', 'textarea', 'select', 'multiselect', 'checkbox', 'number', 'date', 'extra']);
const LONGITUD_TEXTO = 500;
const LONGITUD_TEXTAREA = 1000;

function esVacio(valor: Respuesta | undefined): boolean {
  if (valor === null || valor === undefined) return true;
  if (valor === '') return true;
  if (Array.isArray(valor) && valor.length === 0) return true;
  if (valor === false) return true;
  return false;
}

function valoresIguales(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export function evaluarCondicion(cond: Record<string, unknown>, respuestas: Record<string, Respuesta>): boolean {
  const actual = respuestas[cond.campo as string];
  const resultados: boolean[] = [];
  if ('igual_a' in cond) resultados.push(valoresIguales(actual ?? null, cond.igual_a));
  if ('en' in cond) {
    const opciones = Array.isArray(cond.en) ? (cond.en as unknown[]) : [];
    resultados.push(opciones.some((opcion) => valoresIguales(actual ?? null, opcion)));
  }
  if ('distinto_de' in cond) resultados.push(!valoresIguales(actual ?? null, cond.distinto_de));
  if ('no_vacio' in cond) resultados.push(!esVacio(actual));
  if (resultados.length === 0) return true;
  return resultados.every(Boolean);
}

function esVisible(campo: CampoDef, respuestas: Record<string, Respuesta>): boolean {
  const condicion = campo.visible_si;
  if (!condicion) return true;
  return evaluarCondicion(condicion, respuestas);
}

function dependenciaFueraDeAlcance(campo: CampoDef, dependencia: CampoDef): boolean {
  if (campo.alcance === 'por_reserva' && dependencia.alcance === 'por_pasajero') return true;
  if (
    campo.alcance === 'por_pasajero' &&
    dependencia.alcance === 'por_reserva' &&
    dependencia.permite_por_pasajero !== true
  ) {
    return true;
  }
  return false;
}

function respuestasDeAmbito(
  campo: CampoDef,
  ctx: ContextoFormulario,
  refPasajero?: string,
): Record<string, Respuesta> {
  if (campo.alcance === 'por_pasajero') {
    if (!refPasajero) return {};
    return { ...ctx.globales, ...(ctx.porPasajero[refPasajero] ?? {}) };
  }
  return ctx.globales;
}

function campoAplicaA(campo: CampoDef, categoria: Categoria): boolean {
  const categorias = campo.aplica_a ?? [];
  return categorias.length === 0 || categorias.includes(categoria);
}

function visibleEnContexto(
  campo: CampoDef,
  ctx: ContextoFormulario,
  refPasajero: string | undefined,
  porId: Map<string, CampoDef>,
): boolean {
  const condicion = campo.visible_si;
  if (!condicion) return true;
  const dependencia = porId.get(condicion.campo as string);
  if (dependencia && dependenciaFueraDeAlcance(campo, dependencia)) return true;
  return esVisible(campo, respuestasDeAmbito(campo, ctx, refPasajero));
}

function esValorAgotado(campo: CampoDef, valor: Respuesta, agotadas?: Record<string, boolean>): boolean {
  if (!agotadas) return false;
  if (campo.tipo === 'select' && typeof valor === 'string') {
    return agotadas[`${campo.id}:${valor}`] === true;
  }
  if (campo.tipo === 'multiselect' && Array.isArray(valor)) {
    return valor.some((v) => typeof v === 'string' && agotadas[`${campo.id}:${v}`] === true);
  }
  return false;
}

function esMultiploDe(valor: number, paso: number): boolean {
  if (paso === 0) return true;
  const cociente = valor / paso;
  return Math.abs(cociente - Math.round(cociente)) < 1e-9;
}

function esFechaIso(iso: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) return false;
  const [anio, mes, dia] = iso.split('-').map((n) => Number.parseInt(n, 10));
  const fecha = new Date(Date.UTC(anio, mes - 1, dia));
  return fecha.getUTCFullYear() === anio && fecha.getUTCMonth() === mes - 1 && fecha.getUTCDate() === dia;
}

function esValorVacio(valor: Respuesta, tipo: string): boolean {
  if (valor === null) return true;
  switch (tipo) {
    case 'text':
    case 'textarea':
    case 'select':
    case 'date':
      return typeof valor === 'string' && valor.trim() === '';
    case 'multiselect':
      return Array.isArray(valor) && valor.length === 0;
    case 'checkbox':
    case 'number':
    case 'extra':
      return false;
    default:
      return esVacio(valor);
  }
}

export function validarCampo(
  campo: CampoDef,
  valor: Respuesta,
  opcionesAgotadas: Record<string, boolean>,
): { ok: boolean; mensaje?: string } {
  if (!TIPOS_SOPORTADOS.has(campo.tipo)) {
    return campo.obligatorio
      ? { ok: false, mensaje: 'Hay una pregunta que no se puede mostrar. Contáctanos' }
      : { ok: true };
  }
  if (esValorAgotado(campo, valor, opcionesAgotadas)) {
    return { ok: false, mensaje: 'Esta opción se agotó. Elige otra' };
  }
  if (esValorVacio(valor, campo.tipo)) {
    if (!campo.obligatorio) return { ok: true };
    return { ok: false, mensaje: 'Esta pregunta es obligatoria' };
  }

  switch (campo.tipo) {
    case 'text':
    case 'textarea': {
      if (typeof valor !== 'string') return { ok: false, mensaje: 'Escribe una respuesta de texto' };
      const max = campo.max_length ?? (campo.tipo === 'text' ? LONGITUD_TEXTO : LONGITUD_TEXTAREA);
      if (valor.length > max) return { ok: false, mensaje: `Escribe máximo ${max} caracteres` };
      return { ok: true };
    }
    case 'select': {
      if (typeof valor !== 'string') return { ok: false, mensaje: 'Elige una de las opciones disponibles' };
      const opciones = campo.opciones ?? [];
      if (!opciones.some((opcion) => opcion.valor === valor)) {
        return { ok: false, mensaje: 'Elige una de las opciones disponibles' };
      }
      return { ok: true };
    }
    case 'multiselect': {
      if (!Array.isArray(valor)) return { ok: false, mensaje: 'Elige una o varias opciones de la lista' };
      const valores = valor.filter((v): v is string => typeof v === 'string');
      if (valores.length !== valor.length) return { ok: false, mensaje: 'Elige una o varias opciones de la lista' };
      if (new Set(valores).size !== valores.length) return { ok: false, mensaje: 'No repitas la misma opción' };
      const opciones = campo.opciones ?? [];
      if (valores.some((v) => !opciones.some((opcion) => opcion.valor === v))) {
        return { ok: false, mensaje: 'Elige solo opciones de la lista' };
      }
      return { ok: true };
    }
    case 'checkbox': {
      if (typeof valor !== 'boolean') return { ok: false, mensaje: 'Indica sí o no' };
      return { ok: true };
    }
    case 'number': {
      if (typeof valor !== 'number' || !Number.isFinite(valor)) {
        return { ok: false, mensaje: 'Escribe un número válido, por ejemplo 2' };
      }
      if (campo.min !== undefined && valor < campo.min) {
        return { ok: false, mensaje: `El valor no puede ser menor que ${campo.min}` };
      }
      if (campo.max !== undefined && valor > campo.max) {
        return { ok: false, mensaje: `El valor no puede ser mayor que ${campo.max}` };
      }
      if (campo.step !== undefined && !esMultiploDe(valor, campo.step)) {
        return { ok: false, mensaje: `El valor debe ir en pasos de ${campo.step}` };
      }
      return { ok: true };
    }
    case 'date': {
      if (typeof valor !== 'string' || !esFechaIso(valor)) {
        return { ok: false, mensaje: 'Escribe una fecha válida, por ejemplo 2026-12-14' };
      }
      return { ok: true };
    }
    case 'extra': {
      if (typeof valor !== 'number' || !Number.isInteger(valor)) {
        return { ok: false, mensaje: 'Escribe una cantidad válida, por ejemplo 1' };
      }
      if (valor < 0) return { ok: false, mensaje: 'La cantidad no puede ser menos de 0' };
      if (campo.cantidad_max !== undefined && valor > campo.cantidad_max) {
        return { ok: false, mensaje: `La cantidad máxima es ${campo.cantidad_max}` };
      }
      return { ok: true };
    }
    default:
      return { ok: true };
  }
}

export interface ErrorFormulario {
  campo: string;
  pasajero_ref?: string;
  mensaje: string;
}

export function validarFormulario(ctx: ContextoFormulario): { ok: boolean; errores: ErrorFormulario[] } {
  const errores: ErrorFormulario[] = [];
  const porId = new Map(ctx.campos.map((campo) => [campo.id, campo]));
  const agotadas = ctx.agotadas ?? {};

  for (const campo of ctx.campos) {
    if (!TIPOS_SOPORTADOS.has(campo.tipo)) {
      if (campo.obligatorio) {
        errores.push({ campo: campo.id, mensaje: 'Hay una pregunta que no se puede mostrar. Contáctanos' });
      }
      continue;
    }

    if (campo.alcance === 'por_reserva') {
      if (!visibleEnContexto(campo, ctx, undefined, porId)) continue;
      const porPasajero = campo.permite_por_pasajero
        ? Object.keys(ctx.categorias).filter((ref) => ctx.porPasajero[ref]?.[campo.id] !== undefined)
        : [];
      if (porPasajero.length > 0) {
        for (const ref of porPasajero) {
          const valor = ctx.porPasajero[ref]?.[campo.id] ?? null;
          const resultado = validarCampo(campo, valor, agotadas);
          if (!resultado.ok && resultado.mensaje) {
            errores.push({ campo: campo.id, pasajero_ref: ref, mensaje: resultado.mensaje });
          }
        }
        continue;
      }
      const resultado = validarCampo(campo, ctx.globales[campo.id] ?? null, agotadas);
      if (!resultado.ok && resultado.mensaje) {
        errores.push({ campo: campo.id, mensaje: resultado.mensaje });
      }
      continue;
    }

    for (const [ref, categoria] of Object.entries(ctx.categorias)) {
      if (!campoAplicaA(campo, categoria)) continue;
      if (!visibleEnContexto(campo, ctx, ref, porId)) continue;
      const valor = ctx.porPasajero[ref]?.[campo.id] ?? null;
      const resultado = validarCampo(campo, valor, agotadas);
      if (!resultado.ok && resultado.mensaje) {
        errores.push({ campo: campo.id, pasajero_ref: ref, mensaje: resultado.mensaje });
      }
    }
  }

  return { ok: errores.length === 0, errores };
}

/** Detalle de error con formato RFC 7807 + detalles por campo. */
export function errorValidacion(detalles: { campo: string; mensaje: string }[], titulo = 'Revisa los datos marcados antes de continuar.') {
  return ApiError.validacion(titulo, detalles.map((d) => ({ campo: d.campo, codigo: 'VALIDACION', mensaje: d.mensaje })));
}
