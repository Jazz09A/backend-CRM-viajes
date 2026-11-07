import { Controller, Get, Param, Query } from '@nestjs/common';
import { AuditoriaService } from './auditoria.service';
import { Roles } from '../../common/decorators/roles.decorator';

@Controller('auditoria')
@Roles('superadmin')
export class AuditoriaController {
  constructor(private readonly service: AuditoriaService) {}

  @Get()
  listar(
    @Query('entidad') entidad?: string,
    @Query('entidad_id') entidad_id?: string,
    @Query('usuario_id') usuario_id?: string,
    @Query('accion') accion?: string,
    @Query('desde') desde?: string,
    @Query('hasta') hasta?: string,
  ) {
    return this.service.listar({ entidad, entidad_id, usuario_id, accion, desde, hasta });
  }

  @Get('verificar-cadena')
  verificar(@Query('desde') desde?: string) {
    return this.service.verificarCadena(desde);
  }
}
