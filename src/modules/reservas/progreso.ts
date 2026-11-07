import { Reserva, EstadoReserva, PasoRegistro } from '../../database/entities';

export interface PasoProgreso {
  clave: string;
  estado: 'completo' | 'actual' | 'pendiente' | 'bloqueado';
  completado_en?: string | null;
}

export interface Progreso {
  estado: EstadoReserva;
  estado_pago: string;
  paso_actual: string;
  pasos: PasoProgreso[];
  siguiente_accion: string;
  puede_editar: boolean;
  expira_en: string | null;
  version: number;
  motivo_cierre?: { motivo: string; texto?: string } | null;
}

/** Deriva el objeto `progreso` del contrato (spec 4.5). */
export function construirProgreso(r: Reserva): Progreso {
  const pasoActual = mapearPasoActual(r);
  const pasos: PasoProgreso[] = [];

  if (r.estado === 'en_registro' || r.estado === 'enlace_creado') {
    const orden: PasoRegistro[] = ['titular', 'acompanantes', 'preguntas', 'resumen'];
    const completados = r.pasos_completados ?? {};
    let pasoVisto = false;
    for (const clave of orden) {
      const hecho = Boolean(completados[clave]);
      let estado: PasoProgreso['estado'];
      if (hecho) estado = 'completo';
      else if (!pasoVisto && r.paso_registro === clave) {
        estado = 'actual';
        pasoVisto = true;
      } else if (!pasoVisto) {
        estado = 'pendiente';
        pasoVisto = true;
      } else estado = 'pendiente';
      pasos.push({ clave, estado, completado_en: (completados[clave] as string) ?? null });
    }
  } else {
    pasos.push({ clave: pasoActual, estado: 'actual', completado_en: null });
  }

  return {
    estado: r.estado,
    estado_pago: r.estado_pago,
    paso_actual: pasoActual,
    pasos,
    siguiente_accion: siguienteAccion(r),
    puede_editar: ['en_registro', 'pendiente_firma', 'pendiente_pago'].includes(r.estado) &&
      !r.tiene_pago_por_validar,
    expira_en: r.expira_en?.toISOString() ?? null,
    version: r.version,
    motivo_cierre: motivoCierre(r),
  };
}

function mapearPasoActual(r: Reserva): string {
  switch (r.estado) {
    case 'enlace_creado':
    case 'en_registro':
      return r.paso_registro ?? 'titular';
    case 'pendiente_firma':
      return 'firma';
    case 'pendiente_pago':
      return 'pago';
    case 'pago_en_verificacion':
      return 'verificacion';
    case 'confirmada':
      return 'confirmada';
    default:
      return 'cerrada';
  }
}

function siguienteAccion(r: Reserva): string {
  switch (r.estado) {
    case 'en_registro':
      return `Completa el paso ${r.paso_registro ?? 'titular'}`;
    case 'pendiente_firma':
      return 'Revisa y firma los términos';
    case 'pendiente_pago':
      return 'Realiza el pago y reporta tu comprobante';
    case 'pago_en_verificacion':
      return 'Tu pago está en verificación';
    case 'confirmada':
      return '¡Reserva confirmada! Revisa tu voucher';
    case 'cancelada':
      return 'Reserva cancelada';
    case 'expirada':
      return 'El enlace de registro venció';
    case 'completada':
      return 'Viaje completado';
    default:
      return 'Comienza tu registro';
  }
}

function motivoCierre(r: Reserva) {
  if (r.estado === 'cancelada') return { motivo: 'cancelada', texto: r.cancelacion_motivo ?? undefined };
  if (r.estado === 'expirada') return { motivo: 'expirada' };
  if (r.estado === 'completada') return { motivo: 'completada' };
  return null;
}
