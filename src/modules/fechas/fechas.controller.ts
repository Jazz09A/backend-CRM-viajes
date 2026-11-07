import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { FechasService } from './fechas.service';
import { ActualizarFechaDto, CrearFechaDto, SobrecupoDto } from './fechas.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';
import { IsIn, IsOptional, IsString } from 'class-validator';

class MotivoDto {
  @IsOptional()
  @IsString()
  motivo?: string;
}

@Controller()
export class FechasController {
  constructor(private readonly service: FechasService) {}

  @Get('fechas')
  listar(
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
    @Query('tour_id') tour_id?: string,
    @Query('estado') estado?: string,
  ) {
    return this.service.listar({ desde, hasta, tour_id, estado });
  }

  @Post('tours/:id/fechas')
  @Roles('superadmin')
  crear(@Param('id') tourId: string, @Body() dto: CrearFechaDto) {
    return this.service.crear(tourId, dto);
  }

  @Get('fechas/:id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Patch('fechas/:id')
  @Roles('superadmin')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarFechaDto) {
    return this.service.actualizar(id, dto);
  }

  @Post('fechas/:id/publicar')
  @Roles('superadmin')
  publicar(@Param('id') id: string, @CurrentUser() user: UsuarioActual) {
    return this.service.cambiarEstado(id, 'publicar', user.id);
  }

  @Post('fechas/:id/cerrar')
  @Roles('superadmin')
  cerrar(@Param('id') id: string, @Body() dto: MotivoDto, @CurrentUser() user: UsuarioActual) {
    return this.service.cambiarEstado(id, 'cerrar', user.id, dto.motivo);
  }

  @Post('fechas/:id/reabrir')
  @Roles('superadmin')
  reabrir(@Param('id') id: string, @CurrentUser() user: UsuarioActual) {
    return this.service.cambiarEstado(id, 'reabrir', user.id);
  }

  @Post('fechas/:id/cancelar')
  @Roles('superadmin')
  cancelar(@Param('id') id: string, @Body() dto: MotivoDto, @CurrentUser() user: UsuarioActual) {
    return this.service.cambiarEstado(id, 'cancelar', user.id, dto.motivo);
  }

  @Post('fechas/:id/sobrecupo')
  @Roles('superadmin')
  sobrecupo(@Param('id') id: string, @Body() dto: SobrecupoDto, @CurrentUser() user: UsuarioActual) {
    return this.service.sobrecupo(id, dto, user.id);
  }

  @Delete('fechas/:id')
  @Roles('superadmin')
  eliminar(@Param('id') id: string) {
    return this.service.eliminar(id);
  }
}
