import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AppConfig } from '../../config/configuration';
import { Public } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';
import { escribirCookieRefresh } from '../../common/refresh-cookie';
import { AuthService } from './auth.service';
import { LoginDto, PasswordCambiarDto, PasswordOlvideDto, PasswordRestablecerDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Cookie HttpOnly con el refresh token (sólo la API la lee; el front no la toca).
   *
   * `COOKIE_SAMESITE=none` para frontend y API en dominios distintos
   * (Vercel ↔ Koyeb): el navegador rechaza cookies cross-site con Lax/Strict
   * y exige Secure junto a None.
   */
  private cookieRefresh(reply: FastifyReply, token: string | undefined, maxAgeSegundos: number) {
    escribirCookieRefresh(reply, token, maxAgeSegundos, this.config);
  }

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Ip() ip: string, @Headers('user-agent') ua?: string, @Res({ passthrough: true }) reply?: FastifyReply) {
    const res = await this.auth.login(dto, ip, ua);
    if (res && typeof res === 'object' && 'refresh_token' in res) {
      this.cookieRefresh(reply!, String(res.refresh_token), 30 * 24 * 3600);
    }
    return res;
  }

  @Public()
  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: FastifyRequest, @Ip() ip: string, @Res({ passthrough: true }) reply?: FastifyReply) {
    const cookie = req.headers.cookie ?? '';
    const token = cookie.match(/refresh_token=([^;]+)/)?.[1];
    const res = await this.auth.refresh(token ? decodeURIComponent(token) : undefined, ip, req.headers['user-agent']);
    if (res && typeof res === 'object' && 'refresh_token' in res) {
      this.cookieRefresh(reply!, String(res.refresh_token), 30 * 24 * 3600);
    }
    return res;
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply?: FastifyReply) {
    const cookie = req.headers.cookie ?? '';
    const token = cookie.match(/refresh_token=([^;]+)/)?.[1];
    const res = await this.auth.logout(token ? decodeURIComponent(token) : undefined);
    this.cookieRefresh(reply!, undefined, 0);
    return res;
  }

  @Get('yo')
  yo(@CurrentUser() user: UsuarioActual) {
    return this.auth.yo(user.id);
  }

  @Public()
  @Post('password/olvide')
  @HttpCode(202)
  olvide(@Body() _dto: PasswordOlvideDto) {
    // Siempre 202: no revelar si el correo existe (spec 6.1).
    // TODO: enviar enlace de un solo uso (30 min) por correo.
    return { estado: 'aceptado' };
  }

  @Public()
  @Post('password/restablecer')
  @HttpCode(200)
  restablecer(@Body() _dto: PasswordRestablecerDto) {
    throw new Error('pendiente: implementar restablecimiento');
  }

  @Post('password/cambiar')
  @HttpCode(200)
  cambiar(@CurrentUser() user: UsuarioActual, @Body() _dto: PasswordCambiarDto) {
    void user;
    throw new Error('pendiente: implementar cambio de contraseña');
  }
}
