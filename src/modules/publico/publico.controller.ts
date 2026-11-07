import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { EnlaceAuthGuard } from './enlace-auth.guard';
import { PublicoService } from './publico.service';
import { Public } from '../../common/decorators/roles.decorator';

type ReqConReserva = FastifyRequest;

/**
 * API pública del cliente (contrato del frontend, spec 7).
 * Autenticación: header `X-Enlace-Token`; la reserva se resuelve por hash.
 */
@Controller('public')
@Public()
export class PublicoController {
  constructor(private readonly service: PublicoService) {}

  // ── lectura principal ─────────────────────────────────────────────────

  @Get('reserva')
  @UseGuards(EnlaceAuthGuard)
  async reserva(@Req() req: ReqConReserva, @Headers('x-enlace-token') token: string) {
    void req;
    return this.service.reserva(token);
  }

  // ── T1: iniciar registro ──────────────────────────────────────────────

  @Post('reserva/iniciar')
  @UseGuards(EnlaceAuthGuard)
  async iniciar(@Headers('x-enlace-token') token: string, @Body() body: Record<string, unknown>) {
    return this.service.iniciar(token, {
      acepta_aviso_privacidad: body['acepta_aviso_privacidad'] === true,
    });
  }

  // ── borradores de pasos ───────────────────────────────────────────────

  @Put('reserva/titular')
  @UseGuards(EnlaceAuthGuard)
  async guardarTitular(@Headers('x-enlace-token') token: string, @Body() body: Record<string, unknown>) {
    const { version, ...datos } = body;
    return this.service.guardarTitular(token, datos, typeof version === 'number' ? version : undefined);
  }

  @Put('reserva/acompanantes')
  @UseGuards(EnlaceAuthGuard)
  async guardarAcompanantes(@Headers('x-enlace-token') token: string, @Body() body: Record<string, unknown>) {
    const { version, pasajeros } = body;
    return this.service.guardarAcompanantes(
      token,
      Array.isArray(pasajeros) ? (pasajeros as Record<string, unknown>[]) : [],
      typeof version === 'number' ? version : undefined,
    );
  }

  @Put('reserva/respuestas')
  @UseGuards(EnlaceAuthGuard)
  async guardarRespuestas(@Headers('x-enlace-token') token: string, @Body() body: Record<string, unknown>) {
    const { version, ...resto } = body;
    return this.service.guardarRespuestas(
      token,
      resto as { por_pasajero?: Record<string, Record<string, never>>; globales?: Record<string, never> },
      typeof version === 'number' ? version : undefined,
    );
  }

  @Post('reserva/pasos/:paso/completar')
  @UseGuards(EnlaceAuthGuard)
  async completarPaso(
    @Headers('x-enlace-token') token: string,
    @Param('paso') paso: string,
    @Body() body: Record<string, unknown>,
  ) {
    const { version, ...payload } = body;
    return this.service.completarPaso(
      token,
      paso,
      payload,
      typeof version === 'number' ? version : undefined,
    );
  }

  // ── resumen y confirmación (precio administrado) ──────────────────────

  @Get('reserva/resumen')
  @UseGuards(EnlaceAuthGuard)
  async resumen(@Headers('x-enlace-token') token: string) {
    return this.service.resumen(token);
  }

  @Post('reserva/resumen/confirmar')
  @UseGuards(EnlaceAuthGuard)
  async confirmarResumen(@Headers('x-enlace-token') token: string, @Body() body: Record<string, unknown>) {
    return this.service.confirmarResumen(
      token,
      {
        version: typeof body['version'] === 'number' ? (body['version'] as number) : undefined,
        total_visto_usd: body['total_visto_usd'] !== undefined ? String(body['total_visto_usd']) : undefined,
        acepta_politica: body['acepta_politica'] === true,
      },
      typeof body['idempotency_key'] === 'string' ? (body['idempotency_key'] as string) : undefined,
    );
  }

  @Post('reserva/reabrir-edicion')
  @UseGuards(EnlaceAuthGuard)
  async reabrirEdicion(@Headers('x-enlace-token') token: string, @Body() body: Record<string, unknown>) {
    return this.service.reabrirEdicion(token, body['motivo'] ? String(body['motivo']) : undefined);
  }

  // ── términos y firma (T3) ─────────────────────────────────────────────

  @Get('terminos')
  @UseGuards(EnlaceAuthGuard)
  async terminos(@Headers('x-enlace-token') token: string) {
    return this.service.terminos(token);
  }

  @Post('reserva/firma')
  @UseGuards(EnlaceAuthGuard)
  async firmar(
    @Headers('x-enlace-token') token: string,
    @Body() body: Record<string, unknown>,
    @Req() req: FastifyRequest,
  ) {
    const idem =
      typeof body['idempotency_key'] === 'string'
        ? (body['idempotency_key'] as string)
        : typeof req.headers['idempotency-key'] === 'string'
          ? (req.headers['idempotency-key'] as string)
          : undefined;
    return this.service.firmar(token, body, req.ip, req.headers['user-agent'], idem);
  }

  // ── pagos (T5) ────────────────────────────────────────────────────────

  @Get('pago/instrucciones')
  @UseGuards(EnlaceAuthGuard)
  async metodosPago(@Headers('x-enlace-token') token: string) {
    return this.service.metodosPago(token);
  }

  @Post('reserva/pagos')
  @UseGuards(EnlaceAuthGuard)
  async reportarPago(@Headers('x-enlace-token') token: string, @Body() body: Record<string, unknown>) {
    return this.service.reportarPago(token, body);
  }

  @Get('reserva/pagos')
  @UseGuards(EnlaceAuthGuard)
  async pagosPublicos(@Headers('x-enlace-token') token: string) {
    return this.service.pagosPublicos(token);
  }

  @Post('reserva/pagos/:pagoId/correccion')
  @UseGuards(EnlaceAuthGuard)
  async solicitarCorreccion(
    @Headers('x-enlace-token') token: string,
    @Param('pagoId') pagoId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.service.solicitarCorreccionPublica(token, pagoId, body as never);
  }

  // ── voucher y QR ──────────────────────────────────────────────────────

  @Get('reserva/voucher')
  @UseGuards(EnlaceAuthGuard)
  async voucher(@Headers('x-enlace-token') token: string) {
    return this.service.voucherPublico(token);
  }

  /** Descarga del voucher — el token va en query (el front lo incluye en url_descarga). */
  @Get('voucher/:id/descarga')
  async descargarVoucher(
    @Param('id') id: string,
    @Query('t') token: string | undefined,
    @Res() reply: FastifyReply,
  ) {
    const resultado = await this.service.descargarVoucherPublico(id, token);
    if ('url' in resultado && resultado.url) {
      // S3: redirigir a URL firmada
      return reply.redirect(resultado.url);
    }
    if ('contenido' in resultado) {
      return reply.header('content-type', resultado.mime).header('content-disposition', 'attachment; filename="voucher.pdf"').send(resultado.contenido);
    }
    throw new Error('Respuesta inválida de descargarVoucherPublico');
  }

  /** Verificación QR pública — sin auth, datos mínimos (spec 7). */
  @Get('verificar/:token')
  async verificar(@Param('token') token: string) {
    return this.service.verificar(token);
  }
}
