import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminFxService } from './adminfx.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';

/**
 * Capa de compatibilidad admin: expone el contrato que consume el frontend
 * (`ApiAdmin` en src/lib/domain/api.ts) sobre los servicios/entidades reales.
 * Pensada para desarrollo; en producción puede migrarse a los endpoints REST
 * canónicos (/reservas, /pagos, /tours...) con el mismo servicio.
 */
@Controller('adminfx')
@Roles('superadmin', 'operador', 'validador', 'guia')
export class AdminFxController {
  constructor(private readonly service: AdminFxService) {}

  // ── dashboard y utilidades ────────────────────────────────────────────

  @Get('dashboard')
  dashboard() {
    return this.service.dashboard();
  }

  @Get('notificaciones')
  notificaciones() {
    return this.service.notificaciones();
  }

  @Post('notificaciones/:id/leer')
  marcarLeida(@Param('id') id: string) {
    return this.service.marcarNotificacionLeida(id);
  }

  @Get('auditoria')
  auditoria(
    @Query('entidad') entidad?: string,
    @Query('usuario_id') usuario_id?: string,
    @Query('accion') accion?: string,
  ) {
    return this.service.auditoria({ entidad, usuario_id, accion });
  }

  // ── reservas ──────────────────────────────────────────────────────────

  @Get('reservas')
  reservas(@Query() q: Record<string, string>) {
    return this.service.reservas(q);
  }

  @Post('reservas')
  @Roles('superadmin', 'operador')
  crearReserva(@Body() body: Record<string, unknown>, @CurrentUser() user: UsuarioActual) {
    return this.service.crearReserva(body as never, user.id);
  }

  @Get('tablero')
  tablero(@Query('fecha_tour_id') fecha_tour_id?: string) {
    return this.service.tablero(fecha_tour_id);
  }

  @Get('reservas/:id')
  reserva(@Param('id') id: string) {
    return this.service.reservaDetalle(id);
  }

  @Post('reservas/:id/enlace/regenerar')
  @Roles('superadmin', 'operador')
  regenerarEnlace(@Param('id') id: string, @Body() _body: Record<string, unknown>, @CurrentUser() user: UsuarioActual) {
    return this.service.regenerarEnlace(id, user.id);
  }

  @Post('reservas/:id/enlace/revocar')
  @Roles('superadmin', 'operador')
  revocarEnlace(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: UsuarioActual) {
    return this.service.revocarEnlace(id, String(body.motivo ?? ''), user.id);
  }

  @Post('reservas/:id/hold')
  @Roles('superadmin', 'operador')
  extenderHold(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: UsuarioActual) {
    return this.service.extenderHold(id, Number(body.horas ?? 24), String(body.motivo ?? ''), user.id);
  }

  @Post('reservas/:id/editar')
  @Roles('superadmin', 'operador')
  editarReserva(@Param('id') id: string, @Body() body: { motivo: string; cambios: Record<string, unknown> }, @CurrentUser() user: UsuarioActual) {
    return this.service.editarReserva(id, body, user.id);
  }

  @Put('reservas/:id/precio')
  @Roles('superadmin', 'operador')
  guardarPrecio(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: UsuarioActual) {
    return this.service.guardarPrecio(id, body as never, user.id);
  }

  @Post('reservas/:id/revelar')
  revelar(@Param('id') id: string, @Body() body: { campo: string; pasajero_ref?: string; motivo: string }) {
    return this.service.revelar(id, body);
  }

  @Get('reservas/:id/simular-cancelacion')
  simularCancelacion(@Param('id') id: string) {
    return this.service.simularCancelacion(id);
  }

  @Post('reservas/:id/cancelar')
  @Roles('superadmin', 'operador')
  cancelarReserva(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: UsuarioActual) {
    return this.service.cancelarReserva(id, body as never, user.id);
  }

  @Post('reservas/:id/reprogramar')
  @Roles('superadmin', 'operador')
  reprogramar(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: UsuarioActual) {
    return this.service.reprogramar(id, body as never, user.id);
  }

  @Post('reservas/:id/reactivar')
  @Roles('superadmin', 'operador')
  reactivar(@Param('id') id: string, @Body() _body: Record<string, unknown>, @CurrentUser() user: UsuarioActual) {
    return this.service.reactivar(id, user.id);
  }

  // ── pagos ─────────────────────────────────────────────────────────────

  @Get('pagos')
  pagos(@Query() q: Record<string, string>) {
    return this.service.pagos(q);
  }

  @Get('pagos/:id')
  pago(@Param('id') id: string) {
    return this.service.pagoDetalle(id);
  }

  @Post('pagos/:id/validar')
  @Roles('superadmin', 'validador')
  validarPago(@Param('id') id: string, @Body() body: Record<string, unknown>, @CurrentUser() user: UsuarioActual) {
    return this.service.validarPago(id, body as never, user.id);
  }

  @Post('pagos/:id/efectivo')
  @Roles('superadmin', 'operador')
  pagoEfectivo(@Param('id') id: string, @Body() body: { monto: string; referencia?: string; nota?: string }, @CurrentUser() user: UsuarioActual) {
    return this.service.registrarPagoEfectivo(id, body, user.id);
  }

  @Post('pagos/:id/reembolso')
  @Roles('superadmin')
  reembolso(@Param('id') id: string, @Body() body: { monto: string; metodo: string; motivo: string }, @CurrentUser() user: UsuarioActual) {
    return this.service.reembolsar(id, body, user.id);
  }

  // ── tours / fechas / tarifas / formulario ─────────────────────────────

  @Get('tours')
  tours() {
    return this.service.tours();
  }

  @Post('tours')
  @Roles('superadmin', 'operador')
  crearTour(@Body() body: Record<string, unknown>) {
    return this.service.guardarTour(null, body);
  }

  @Get('tours/:id')
  tour(@Param('id') id: string) {
    return this.service.tourDetalle(id);
  }

  @Put('tours/:id')
  @Roles('superadmin', 'operador')
  actualizarTour(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.service.guardarTour(id, body);
  }

  @Post('tours/:id/duplicar')
  @Roles('superadmin', 'operador')
  duplicarTour(@Param('id') id: string) {
    return this.service.duplicarTour(id);
  }

  @Post('tours/:id/estado')
  @Roles('superadmin')
  estadoTour(@Param('id') id: string, @Body() body: { estado: 'activo' | 'archivado' }, @CurrentUser() user: UsuarioActual) {
    return this.service.cambiarEstadoTour(id, body.estado, user.id);
  }

  @Get('fechas')
  fechasTodas() {
    return this.service.fechasTodas();
  }

  @Get('tours/:tourId/fechas')
  fechas(@Param('tourId') tourId: string) {
    return this.service.fechas(tourId);
  }

  @Post('fechas')
  @Roles('superadmin', 'operador')
  guardarFecha(@Body() body: Record<string, unknown>) {
    return this.service.guardarFecha(body);
  }

  @Post('fechas/:id/cerrar')
  @Roles('superadmin', 'operador')
  cerrarFecha(@Param('id') id: string, @Body() body: { expirar_pendientes: boolean; motivo?: string }, @CurrentUser() user: UsuarioActual) {
    return this.service.cerrarFecha(id, body, user.id);
  }

  @Post('fechas/:id/cancelar')
  @Roles('superadmin')
  cancelarFecha(@Param('id') id: string, @Body() body: { motivo: string; confirmacion: string }, @CurrentUser() user: UsuarioActual) {
    return this.service.cancelarFecha(id, body, user.id);
  }

  @Get('fechas-cancelacion/:tareaId')
  progresoCancelacion(@Param('tareaId') tareaId: string) {
    return this.service.progresoCancelacion(tareaId);
  }

  @Post('fechas/:id/sobrecupo')
  @Roles('superadmin')
  sobrecupo(@Param('id') id: string, @Body() body: { cupos_extra: number; motivo: string; codigo_totp?: string }, @CurrentUser() user: UsuarioActual) {
    return this.service.autorizarSobrecupo(id, body, user.id);
  }

  @Post('tarifas')
  @Roles('superadmin', 'operador')
  guardarTarifa(@Body() body: Record<string, unknown>) {
    return this.service.guardarTarifa(body);
  }

  @Delete('tarifas/:id')
  @Roles('superadmin', 'operador')
  eliminarTarifa(@Param('id') id: string) {
    return this.service.eliminarTarifa(id);
  }

  @Get('tours/:tourId/formulario')
  formulario(@Param('tourId') tourId: string) {
    return this.service.formulario(tourId);
  }

  @Post('tours/:tourId/formulario')
  @Roles('superadmin', 'operador')
  guardarFormulario(@Param('tourId') tourId: string, @Body() body: { definicion: { campos: Record<string, unknown>[] } }, @CurrentUser() user: UsuarioActual) {
    return this.service.guardarFormulario(tourId, body, user.id);
  }

  // ── salidas ───────────────────────────────────────────────────────────

  @Get('salidas')
  salidas(@Query('mes') mes?: string, @Query('tour_id') tour_id?: string) {
    return this.service.salidas({ mes, tour_id });
  }

  @Get('salidas/:id')
  salida(@Param('id') id: string) {
    return this.service.salida(id);
  }

  // ── clientes ──────────────────────────────────────────────────────────

  @Get('clientes')
  clientes(@Query('busqueda') busqueda?: string) {
    return this.service.clientes({ busqueda });
  }

  @Get('clientes/:id')
  cliente(@Param('id') id: string) {
    return this.service.cliente(id);
  }

  @Post('clientes/:id/nota')
  guardarNotaCliente(@Param('id') id: string, @Body() body: { notas: string }, @CurrentUser() user: UsuarioActual) {
    return this.service.guardarNotaCliente(id, body, user.id);
  }

  // ── reportes ──────────────────────────────────────────────────────────

  @Get('reportes')
  reportes(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    return this.service.reportes({ desde: desde ?? '', hasta: hasta ?? '' });
  }

  // ── configuración ─────────────────────────────────────────────────────

  @Get('configuracion')
  configuracion() {
    return this.service.configuracion();
  }

  @Put('configuracion')
  @Roles('superadmin')
  guardarConfiguracion(@Body() body: Record<string, unknown>, @CurrentUser() user: UsuarioActual) {
    return this.service.guardarConfiguracion(body, user.id);
  }

  @Post('tasas')
  @Roles('superadmin')
  registrarTasa(@Body() body: { valor: string }, @CurrentUser() user: UsuarioActual) {
    return this.service.registrarTasa(body, user.id);
  }

  @Post('metodos-pago')
  @Roles('superadmin')
  guardarMetodoPago(@Body() body: Record<string, unknown>) {
    return this.service.guardarMetodoPago(body);
  }

  @Post('terminos')
  @Roles('superadmin')
  publicarTerminos(@Body() body: { titulo: string; cuerpo: string }, @CurrentUser() user: UsuarioActual) {
    return this.service.publicarTerminos(body, user.id);
  }

  @Post('plantillas')
  @Roles('superadmin')
  guardarPlantilla(@Body() body: Record<string, unknown>) {
    return this.service.guardarPlantilla(body);
  }

  @Post('politicas')
  @Roles('superadmin')
  guardarPolitica(@Body() body: Record<string, unknown>) {
    return this.service.guardarPolitica(body);
  }

  @Post('promos')
  @Roles('superadmin')
  guardarPromo(@Body() body: Record<string, unknown>) {
    return this.service.guardarPromo(body);
  }

  @Post('usuarios')
  @Roles('superadmin')
  guardarUsuario(@Body() body: Record<string, unknown>, @CurrentUser() user: UsuarioActual) {
    return this.service.guardarUsuario(body, user.id);
  }

  @Post('firma-empresa')
  @Roles('superadmin')
  subirFirmaEmpresa(@Body() body: { nombre: string; tamano: number }, @CurrentUser() user: UsuarioActual) {
    return this.service.subirFirmaEmpresa(body, user.id);
  }
}
