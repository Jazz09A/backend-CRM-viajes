import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ReservasService } from './reservas.service';
import { CancelarReservaDto, CrearReservaDto, ExtenderHoldDto } from './reservas.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';

@Controller('reservas')
export class ReservasController {
  constructor(private readonly service: ReservasService) {}

  @Post()
  @Roles('operador', 'superadmin')
  crear(@Body() dto: CrearReservaDto, @CurrentUser() user: UsuarioActual) {
    return this.service.crear(dto, user.id);
  }

  @Get()
  @Roles('operador', 'validador', 'superadmin')
  listar(
    @Query('tour_id') tour_id?: string,
    @Query('fecha_tour_id') fecha_tour_id?: string,
    @Query('estado') estado?: string,
    @Query('estado_pago') estado_pago?: string,
    @Query('q') q?: string,
    @Query('limite') limite?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.service.listar({ tour_id, fecha_tour_id, estado, estado_pago, q, limite, cursor });
  }

  @Get(':id')
  @Roles('operador', 'validador', 'superadmin')
  detalle(@Param('id') id: string) {
    return this.service.detalle(id);
  }

  @Post(':id/cancelar')
  @Roles('operador', 'superadmin')
  cancelar(@Param('id') id: string, @Body() dto: CancelarReservaDto, @CurrentUser() user: UsuarioActual) {
    return this.service.cancelar(id, dto, user.id);
  }

  @Post(':id/reactivar')
  @Roles('operador', 'superadmin')
  reactivar(@Param('id') id: string, @CurrentUser() user: UsuarioActual) {
    return this.service.reactivar(id, user.id);
  }

  @Post(':id/enlace/regenerar')
  @Roles('operador', 'superadmin')
  regenerar(@Param('id') id: string, @CurrentUser() user: UsuarioActual) {
    return this.service.regenerarEnlace(id, user.id);
  }

  @Post(':id/extender-hold')
  @Roles('operador', 'superadmin')
  extender(@Param('id') id: string, @Body() dto: ExtenderHoldDto, @CurrentUser() user: UsuarioActual) {
    return this.service.extenderHold(id, dto.horas, dto.motivo, user.id);
  }

  @Get(':id/tablero')
  tablero(@Query('fecha_tour_id') fechaId?: string) {
    void fechaId;
    return { columnas: [] }; // TODO: tablero por estado (spec 6.5)
  }
}
