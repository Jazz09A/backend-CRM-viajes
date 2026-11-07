import { Controller, Get, Param, Post } from '@nestjs/common';
import { NotificacionesService } from './notificaciones.service';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';

@Controller('notificaciones')
export class NotificacionesController {
  constructor(private readonly service: NotificacionesService) {}

  @Get()
  listar(@CurrentUser() user: UsuarioActual) {
    // Un usuario puede tener varios roles: union de notificaciones.
    const rolPrincipal = user.roles[0] ?? 'operador';
    return this.service.listarParaRol(rolPrincipal);
  }

  @Post(':id/leer')
  leer(@Param('id') id: string) {
    return this.service.marcarLeida(id);
  }
}
