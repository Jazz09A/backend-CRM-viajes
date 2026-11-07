import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { VouchersService } from './vouchers.service';
import { Roles } from '../../common/decorators/roles.decorator';
import { IsNotEmpty, IsString } from 'class-validator';

class RegenerarDto {
  @IsString()
  @IsNotEmpty()
  motivo!: string;
}

@Controller()
export class VouchersController {
  constructor(private readonly service: VouchersService) {}

  @Get('reservas/:id/vouchers')
  @Roles('operador', 'validador', 'superadmin')
  listar(@Param('id') id: string) {
    return this.service.listarPorReserva(id);
  }

  @Post('reservas/:id/vouchers/regenerar')
  @Roles('operador', 'superadmin')
  regenerar(@Param('id') id: string, @Body() dto: RegenerarDto) {
    return this.service.regenerar(id, dto.motivo);
  }

  @Get('vouchers/:id/descarga')
  @Roles('operador', 'validador', 'superadmin')
  descarga(@Param('id') id: string) {
    return this.service.urlDescarga(id);
  }
}
