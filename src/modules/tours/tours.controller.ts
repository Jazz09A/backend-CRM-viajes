import { Body, Controller, Get, Param, Patch, Post, Put, Query } from '@nestjs/common';
import { ToursService } from './tours.service';
import { ActualizarTourDto, CrearTourDto, PuntoAbordajeDto } from './tours.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';
import { IsIn, IsOptional, IsString } from 'class-validator';

class EstadoTourDto {
  @IsIn(['borrador', 'activo', 'archivado'])
  estado!: 'borrador' | 'activo' | 'archivado';
}

class BorradorFormDto {
  @IsOptional()
  definicion?: Record<string, unknown>;
}

@Controller()
export class ToursController {
  constructor(private readonly service: ToursService) {}

  @Get('tours')
  listar(
    @Query('estado') estado?: string,
    @Query('tipo') tipo?: string,
    @Query('q') q?: string,
  ) {
    return this.service.listar({ estado, tipo, q });
  }

  @Post('tours')
  @Roles('superadmin')
  crear(@Body() dto: CrearTourDto, @CurrentUser() user: UsuarioActual) {
    return this.service.crear(dto, user.id);
  }

  @Get('tours/:id')
  obtener(@Param('id') id: string) {
    return this.service.obtener(id);
  }

  @Patch('tours/:id')
  @Roles('superadmin')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarTourDto) {
    return this.service.actualizar(id, dto);
  }

  @Post('tours/:id/estado')
  @Roles('superadmin')
  cambiarEstado(@Param('id') id: string, @Body() dto: EstadoTourDto, @CurrentUser() user: UsuarioActual) {
    return this.service.cambiarEstado(id, dto.estado, user.id);
  }

  @Get('tours/:id/puntos-abordaje')
  puntos(@Param('id') id: string) {
    return this.service.listarPuntos(id);
  }

  @Put('tours/:id/puntos-abordaje')
  @Roles('superadmin')
  reemplazarPuntos(@Param('id') id: string, @Body() lista: PuntoAbordajeDto[]) {
    return this.service.reemplazarPuntos(id, lista);
  }

  @Get('tours/:id/formulario')
  formulario(@Param('id') id: string) {
    return this.service.obtenerFormulario(id);
  }

  @Put('tours/:id/formulario/borrador')
  @Roles('superadmin')
  guardarBorrador(@Param('id') id: string, @Body() dto: BorradorFormDto) {
    return this.service.guardarBorrador(id, dto.definicion ?? {});
  }

  @Post('tours/:id/formulario/publicar')
  @Roles('superadmin')
  publicar(@Param('id') id: string, @CurrentUser() user: UsuarioActual) {
    return this.service.publicarFormulario(id, user.id);
  }
}
