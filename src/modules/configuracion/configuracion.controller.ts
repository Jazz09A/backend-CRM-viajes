import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { ConfiguracionService } from './configuracion.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';
import { IsNumber, IsOptional, IsString } from 'class-validator';

class TasaDto {
  @IsNumber()
  tasa!: number;

  @IsOptional()
  @IsString()
  nota?: string;
}

@Controller()
export class ConfiguracionController {
  constructor(private readonly service: ConfiguracionService) {}

  @Get('config')
  @Roles('superadmin')
  listar() {
    return this.service.listar();
  }

  @Get('config/:clave')
  @Roles('superadmin', 'operador', 'validador')
  obtener(@Param('clave') clave: string) {
    return this.service.obtener(clave);
  }

  @Put('config/:clave')
  @Roles('superadmin')
  guardar(@Param('clave') clave: string, @Body('valor') valor: unknown, @CurrentUser() user: UsuarioActual) {
    return this.service.guardar(clave, valor, user.id);
  }

  @Get('tasas-cambio')
  @Roles('superadmin')
  tasas() {
    return this.service.listarTasas();
  }

  @Get('tasas-cambio/vigente')
  @Roles('superadmin', 'operador', 'validador')
  tasaVigente() {
    return this.service.tasaVigente();
  }

  @Post('tasas-cambio')
  @Roles('superadmin')
  registrarTasa(@Body() dto: TasaDto, @CurrentUser() user: UsuarioActual) {
    return this.service.registrarTasa(dto.tasa, user.id, dto.nota);
  }

  @Get('metodos-pago')
  listarMetodos() {
    return this.service.listarMetodos(false);
  }

  @Get('terminos')
  listarPlantillas() {
    return []; // TODO: CRUD de plantillas_terminos
  }

  @Post('terminos/:id/versiones/:vid/publicar')
  @Roles('superadmin')
  publicarTerminos(@Param('id') id: string, @Param('vid') vid: string, @CurrentUser() user: UsuarioActual) {
    return this.service.publicarTerminos(id, vid, user.id);
  }

  @Get('politicas-cancelacion')
  politicas() {
    return this.service.listarPoliticas();
  }

  @Get('codigos-promocionales')
  @Roles('superadmin')
  promos() {
    return this.service.listarPromos();
  }
}
