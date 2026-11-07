import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PagosService } from './pagos.service';
import { AprobarPagoDto, RechazarPagoDto, ReembolsoDto, SolicitarCorreccionDto } from './pagos.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';
import { IsOptional, IsString } from 'class-validator';

class AnularDto {
  @IsString()
  motivo!: string;
}

@Controller()
export class PagosController {
  constructor(private readonly service: PagosService) {}

  @Get('pagos/motivos-rechazo')
  motivos() {
    return [
      { codigo: 'referencia_invalida', nombre: 'Referencia inválida' },
      { codigo: 'monto_incorrecto', nombre: 'Monto incorrecto' },
      { codigo: 'comprobante_ilegible', nombre: 'Comprobante ilegible' },
      { codigo: 'pago_no_encontrado', nombre: 'Pago no encontrado' },
      { codigo: 'otro', nombre: 'Otro' },
    ];
  }

  @Get('pagos')
  @Roles('validador', 'superadmin', 'operador')
  cola(@Query('estado') estado?: string) {
    return this.service.cola(estado ?? 'reportado,correccion_solicitada');
  }

  @Get('pagos/:id')
  @Roles('validador', 'superadmin', 'operador')
  detalle(@Param('id') id: string) {
    return this.service.detalle(id);
  }

  @Post('pagos/:id/aprobar')
  @Roles('validador', 'superadmin')
  aprobar(@Param('id') id: string, @Body() dto: AprobarPagoDto, @CurrentUser() user: UsuarioActual) {
    return this.service.aprobar(id, dto, user.id);
  }

  @Post('pagos/:id/rechazar')
  @Roles('validador', 'superadmin')
  rechazar(@Param('id') id: string, @Body() dto: RechazarPagoDto, @CurrentUser() user: UsuarioActual) {
    return this.service.rechazar(id, dto, user.id);
  }

  @Post('pagos/:id/solicitar-correccion')
  @Roles('validador', 'superadmin')
  correccion(@Param('id') id: string, @Body() dto: SolicitarCorreccionDto, @CurrentUser() user: UsuarioActual) {
    return this.service.solicitarCorreccion(id, dto, user.id);
  }

  @Post('pagos/:id/anular')
  @Roles('superadmin')
  anular(@Param('id') id: string, @Body() dto: AnularDto, @CurrentUser() user: UsuarioActual) {
    return this.service.anular(id, dto.motivo, user.id);
  }

  @Post('pagos/:id/reembolsos')
  @Roles('superadmin')
  reembolso(@Param('id') id: string, @Body() dto: ReembolsoDto, @CurrentUser() user: UsuarioActual) {
    return this.service.registrarReembolso(id, dto, user.id);
  }
}
