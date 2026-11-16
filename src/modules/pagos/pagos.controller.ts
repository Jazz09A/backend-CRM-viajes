import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { PagosService } from './pagos.service';
import { ReembolsoDto } from './pagos.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';
import { IsOptional, IsString } from 'class-validator';

class AnularDto {
  @IsString()
  motivo!: string;
}

/**
 * Ciclo de vida de pagos. Ya no hay aprobación: el pago nace aprobado cuando
 * la agencia lo registra. Quedan anular y reembolsos como acciones correctivas.
 */
@Controller()
export class PagosController {
  constructor(private readonly service: PagosService) {}

  @Get('pagos')
  @Roles('validador', 'superadmin', 'operador')
  cola(@Query('estado') estado?: string) {
    return this.service.cola(estado ?? 'aprobado');
  }

  @Get('pagos/:id')
  @Roles('validador', 'superadmin', 'operador')
  detalle(@Param('id') id: string) {
    return this.service.detalle(id);
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
