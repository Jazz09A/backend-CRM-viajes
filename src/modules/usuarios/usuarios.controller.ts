import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { UsuariosService } from './usuarios.service';
import { ActualizarUsuarioDto, CrearUsuarioDto } from './usuarios.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';

@Controller('usuarios')
@Roles('superadmin')
export class UsuariosController {
  constructor(private readonly service: UsuariosService) {}

  @Get()
  listar() {
    return this.service.listar();
  }

  @Post()
  crear(@Body() dto: CrearUsuarioDto) {
    return this.service.crear(dto);
  }

  @Patch(':id')
  actualizar(@Param('id') id: string, @Body() dto: ActualizarUsuarioDto, @CurrentUser() user: UsuarioActual) {
    return this.service.actualizar(id, dto, user.id);
  }

  // POST /usuarios/:id/reset-2fa y /revocar-sesiones → pendientes (spec 6.2).
}
