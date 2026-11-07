import { HttpException, HttpStatus } from '@nestjs/common';

export interface DetalleError {
  campo?: string;
  codigo: string;
  mensaje: string;
}

/**
 * Error de dominio con formato RFC 7807 adaptado (spec sección 3.1).
 * `codigo` es estable para el front; `mensaje` es apto para mostrar al cliente.
 */
export class ApiError extends HttpException {
  readonly codigo: string;
  readonly tipo: string;
  readonly detalles?: DetalleError[];
  readonly data?: Record<string, unknown>;

  constructor(
    httpStatus: HttpStatus,
    codigo: string,
    mensaje: string,
    detalles?: DetalleError[],
    tipo?: string,
    data?: Record<string, unknown>,
  ) {
    super(
      {
        tipo: tipo ?? `https://agencia-viajes.local/errores/${codigo}`,
        codigo,
        mensaje,
        ...(detalles?.length ? { detalles } : {}),
        ...(data ? { data } : {}),
      },
      httpStatus,
    );
    this.codigo = codigo;
    this.tipo = tipo ?? `https://agencia-viajes.local/errores/${codigo}`;
    this.detalles = detalles;
    this.data = data;
  }

  static noAutenticado(mensaje = 'Debes iniciar sesión') {
    return new ApiError(HttpStatus.UNAUTHORIZED, 'NO_AUTENTICADO', mensaje);
  }

  static sinPermiso(permiso?: string) {
    return new ApiError(
      HttpStatus.FORBIDDEN,
      'SIN_PERMISO',
      permiso ? `No tienes permiso para ${permiso}` : 'No tienes permiso para esta acción',
    );
  }

  static noEncontrado(que = 'Recurso') {
    return new ApiError(HttpStatus.NOT_FOUND, 'NO_ENCONTRADO', `${que} no encontrado`);
  }

  static validacion(mensaje: string, detalles?: DetalleError[]) {
    return new ApiError(HttpStatus.UNPROCESSABLE_ENTITY, 'VALIDACION', mensaje, detalles);
  }

  static transicionInvalida(mensaje: string) {
    return new ApiError(HttpStatus.CONFLICT, 'TRANSICION_INVALIDA', mensaje);
  }

  static versionDesactualizada() {
    return new ApiError(
      HttpStatus.CONFLICT,
      'VERSION_DESACTUALIZADA',
      'El recurso fue modificado por otra sesión. Recarga e intenta de nuevo.',
    );
  }

  static enlaceInvalido() {
    return new ApiError(HttpStatus.NOT_FOUND, 'ENLACE_INVALIDO', 'Este enlace no es válido o fue revocado');
  }

  static enlaceVencido(whatsapp?: string) {
    return new ApiError(
      HttpStatus.GONE,
      'ENLACE_VENCIDO',
      whatsapp
        ? `Este enlace venció. Contacta a la agencia por WhatsApp: ${whatsapp}`
        : 'Este enlace venció. Contacta a la agencia para obtener uno nuevo.',
    );
  }
}
