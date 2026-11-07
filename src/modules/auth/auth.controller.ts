import { Body, Controller, Get, Headers, HttpCode, Ip, Post, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Public } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';
import { AuthService } from './auth.service';
import { LoginDto, PasswordCambiarDto, PasswordOlvideDto, PasswordRestablecerDto } from './auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Cookie HttpOnly con el refresh token (sólo la API la lee; el front no la toca). */
  private cookieRefresh(reply: FastifyReply, token: string | undefined, maxAgeSegundos: number) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    if (!token) {
      reply.header('set-cookie', `refresh_token=; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=0${secure}`);
      return;
    }
    reply.header(
      'set-cookie',
      `refresh_token=${encodeURIComponent(token)}; Path=/api/v1/auth; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSegundos}${secure}`,
    );
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
