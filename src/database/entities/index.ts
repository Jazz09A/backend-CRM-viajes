import { AuditLog, EmailLog, Idempotencia, NotificacionPanel, OutboxEvento, ReservaEstadoHistorial } from './soporte.entities';
import { Archivo, Exportacion, Factura, Firma, Pago, Reembolso, Voucher } from './operacion.entities';
import { Cliente, ContadorCodigo, CupoMovimiento, EnlaceReserva, Pasajero, Reserva, ReservaAjuste, ReservaLinea } from './reserva.entities';
import { CampoBiblioteca, CupoOpcion, FechaSobrecupo, FechaTour, PuntoSalida, Tarifa, Tour, TourFormVersion, TourPrecio, TourPuntoAbordaje } from './catalogo.entities';
import { CodigoPromocional, Configuracion, MetodoPago, PlantillaMensaje, PlantillaTerminos, PlantillaTerminosVersion, PoliticaCancelacion, TasaCambio } from './config.entities';
import { Sesion, Usuario, UsuarioRecoveryCode } from './auth.entities';
import type { ActorTipo } from './soporte.entities';
import type { TipoTour, CategoriaPasajero, EstadoTour, EstadoFecha, EstadoFormVersion } from './catalogo.entities';
import type { EstadoReserva, EstadoPagoReserva, PasoRegistro, CupoEstado } from './reserva.entities';
import type { EstadoPago, PropositoArchivo, TipoExportacion, EstadoExportacion } from './operacion.entities';
import type { Rol } from '../../common/decorators/roles.decorator';

export type {
  ActorTipo, TipoTour, CategoriaPasajero, EstadoTour, EstadoFecha, EstadoFormVersion,
  EstadoReserva, EstadoPagoReserva, PasoRegistro, CupoEstado, EstadoPago, PropositoArchivo, Rol,
  TipoExportacion, EstadoExportacion,
};

export {
  AuditLog, Archivo, CampoBiblioteca, Cliente, CodigoPromocional, Configuracion,
  ContadorCodigo, CupoMovimiento, CupoOpcion, EmailLog, EnlaceReserva, Exportacion,
  Factura,
  FechaSobrecupo, FechaTour, Firma, MetodoPago, NotificacionPanel, OutboxEvento,
  Pasajero, Pago, PlantillaMensaje, PlantillaTerminos, PlantillaTerminosVersion,
  PoliticaCancelacion, Reembolso, Reserva, ReservaAjuste, ReservaEstadoHistorial,
  ReservaLinea, Sesion, TasaCambio, Tarifa, Tour, TourFormVersion, TourPrecio, TourPuntoAbordaje,
  PuntoSalida,
  Usuario, UsuarioRecoveryCode, Voucher, Idempotencia,
};

export const TODAS_ENTIDADES = [
  Usuario, UsuarioRecoveryCode, Sesion,
  Configuracion, TasaCambio, MetodoPago, PlantillaTerminos, PlantillaTerminosVersion,
  PlantillaMensaje, PoliticaCancelacion, CodigoPromocional,
  Tour, TourPuntoAbordaje, PuntoSalida, CampoBiblioteca, TourFormVersion, TourPrecio,
  FechaTour, FechaSobrecupo, Tarifa, CupoOpcion,
  Cliente, Reserva, EnlaceReserva, Pasajero, ReservaLinea, ReservaAjuste,
  CupoMovimiento, ContadorCodigo,
  Archivo, Firma, Pago, Reembolso, Voucher, Factura, Exportacion,
  ReservaEstadoHistorial, AuditLog, OutboxEvento, EmailLog, NotificacionPanel,
  Idempotencia,
];
