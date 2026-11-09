import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply } from 'fastify';
import { AppConfig } from '../../config/configuration';
import { Public } from '../../common/decorators/roles.decorator';
import { MAX_AGE_REFRESH_SEGUNDOS, escribirCookieRefresh } from '../../common/refresh-cookie';
import { SetupService } from './setup.service';
import { SetupLimiteGuard } from './setup-limite.guard';
import { IniciarSetupDto } from './setup.dto';

/**
 * Onboarding del primer arranque.
 *
 * Sólo sirve mientras no exista un administrador: en cuanto se crea, ambos
 * endpoints devuelven 409 (`SETUP_YA_COMPLETADO`) y el formulario deja de
 * estar disponible.
 */
@Controller('setup')
@Public()
export class SetupController {
  constructor(
    private readonly service: SetupService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  @Get('estado')
  estado() {
    return this.service.estado();
  }

  @Post('iniciar')
  @HttpCode(200)
  @UseGuards(SetupLimiteGuard)
  async iniciar(
    @Body() dto: IniciarSetupDto,
    @Ip() ip: string,
    @Headers('user-agent') ua?: string,
    @Res({ passthrough: true }) reply?: FastifyReply,
  ) {
    const res = await this.service.iniciar(dto, ip, ua);
    if (res && typeof res === 'object' && 'refresh_token' in res) {
      escribirCookieRefresh(reply!, String(res.refresh_token), MAX_AGE_REFRESH_SEGUNDOS, this.config);
    }
    return res;
  }
}
