import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { Archivo } from '../../database/entities';
import { ApiError } from '../../common/errors';
import { Roles, Public } from '../../common/decorators/roles.decorator';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';
import { ArchivosService } from './archivos.service';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB (spec 7)
const MIMES_OK = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

/**
 * Archivos privados (spec 10.7). En producción van a un bucket S3-compatible
 * con URLs firmadas; en desarrollo se guardan en disco local.
 */
@Controller('archivos')
export class ArchivosController {
  constructor(
    private readonly archivosService: ArchivosService,
    @InjectRepository(Archivo) private readonly archivos: Repository<Archivo>,
  ) {}

  @Post()
  @Roles('operador', 'superadmin', 'validador')
  async subir(@Req() req: FastifyRequest, @CurrentUser() user: UsuarioActual) {
    const parte = await req.file();
    if (!parte) throw ApiError.validacion('Archivo requerido');

    const chunks: Buffer[] = [];
    let total = 0;
    for await (const chunk of parte.file) {
      total += chunk.length;
      if (total > MAX_BYTES) {
        throw new ApiError(413, 'ARCHIVO_GRANDE', 'El archivo supera el máximo de 10 MB');
      }
      chunks.push(chunk as Buffer);
    }
    const buffer = Buffer.concat(chunks);
    const mime = parte.mimetype ?? 'application/octet-stream';
    if (!MIMES_OK.has(mime)) {
      throw new ApiError(415, 'ARCHIVO_TIPO_INVALIDO', 'Tipo de archivo no permitido');
    }

    const archivoId = await this.archivosService.subir(
      buffer,
      parte.filename,
      mime,
      'comprobante',
      user.id,
    );
    return { archivo_id: archivoId };
  }

  /**
   * Sirve archivos del adaptador local con URL firmada HMAC.
   * Solo aplica cuando STORAGE_DRIVER=local (dev/tests); en S3 las
   * URLs firmadas apuntan directo al bucket y nunca llegan aquí.
   */
  @Get('local/*')
  @Public()
  async descargarLocal(@Req() req: FastifyRequest, @Res() reply: FastifyReply) {
    const key = (req.params as Record<string, string>)['*'] ?? '';
    const exp = Number((req.query as Record<string, string>).exp ?? 0);
    const sig = String((req.query as Record<string, string>).sig ?? '');
    const resultado = await this.archivosService.descargarLocal(key, exp, sig);
    if (!resultado) throw ApiError.noEncontrado('Archivo');
    return reply
      .header('content-type', resultado.mime)
      .header('cache-control', 'private, no-store')
      .send(resultado.buffer);
  }

  @Get(':id/url')
  @Roles('operador', 'superadmin', 'validador')
  async obtenerUrl(@Param('id') id: string) {
    const url = await this.archivosService.obtenerUrlFirmada(id);
    return { url };
  }

  @Get(':id')
  obtener(@Param('id') id: string) {
    // Endpoint temporal para compatibilidad; preferir :id/url en lo adelante
    return this.archivos.findOne({ where: { id } });
  }
}
