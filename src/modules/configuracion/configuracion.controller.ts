import { Body, Controller, Delete, Get, Param, Post, Put } from '@nestjs/common';
import { ConfiguracionService, PuntoSalidaDto } from './configuracion.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';
import { IsBoolean, IsNumber, IsOptional, IsString } from 'class-validator';

class TasaDto {
  @IsNumber()
  tasa!: number;

  @IsOptional()
  @IsString()
  nota?: string;
}

class PuntoSalidaBodyDto implements PuntoSalidaDto {
  @IsOptional()
  @IsString()
  clave?: string;

  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsString()
  hora?: string;

  @IsOptional()
  @IsString()
  referencia?: string;

  @IsOptional()
  @IsNumber()
  orden?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
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

  // ── puntos de salida (catálogo global) ────────────────────────────────

  @Get('puntos-salida')
  @Roles('superadmin', 'operador', 'validador')
  puntos() {
    return this.service.listarPuntos(true);
  }

  @Post('puntos-salida')
  @Roles('superadmin')
  crearPunto(@Body() dto: PuntoSalidaBodyDto) {
    return this.service.crearPunto(dto);
  }

  @Put('puntos-salida/:id')
  @Roles('superadmin')
  actualizarPunto(@Param('id') id: string, @Body() dto: PuntoSalidaBodyDto) {
    return this.service.actualizarPunto(id, dto);
  }

  @Delete('puntos-salida/:id')
  @Roles('superadmin')
  eliminarPunto(@Param('id') id: string) {
    return this.service.eliminarPunto(id);
  }
}
