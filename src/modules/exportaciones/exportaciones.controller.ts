import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ExportacionesService } from './exportaciones.service';
import { CurrentUser, UsuarioActual } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiError } from '../../common/errors';
import { TipoExportacion } from '../../database/entities';

const TIPOS_VALIDOS: TipoExportacion[] = [
  'reservas',
  'tours',
  'pasajeros_tour',
  'clientes',
  'pagos',
  'manifest',
  'cocina',
];

@Controller('exportaciones')
@Roles('superadmin', 'operador', 'validador', 'guia')
export class ExportacionesController {
  constructor(private readonly exportaciones: ExportacionesService) {}

  /**
   * Solicita una exportación XLSX asíncrona.
   * POST /exportaciones { tipo, filtros }
   */
  @Post()
  async solicitar(
    @Body() body: { tipo: string; filtros?: Record<string, unknown> },
    @CurrentUser() usuario: UsuarioActual,
  ) {
    if (!TIPOS_VALIDOS.includes(body.tipo as TipoExportacion)) {
      throw ApiError.validacion(`Tipo de exportación inválido: ${body.tipo}`);
    }
    return this.exportaciones.solicitar(
      body.tipo as TipoExportacion,
      body.filtros ?? {},
      usuario,
    );
  }

  /**
   * Historial de exportaciones del usuario (todas para superadmin).
   * GET /exportaciones
   */
  @Get()
  listar(@CurrentUser() usuario: UsuarioActual) {
    return this.exportaciones.listar(usuario);
  }

  /**
   * Estado de una exportación.
   * GET /exportaciones/:id
   */
  @Get(':id')
  obtener(@Param('id') id: string, @CurrentUser() usuario: UsuarioActual) {
    return this.exportaciones.obtener(id, usuario);
  }

  /**
   * URL firmada de descarga (solo si está lista y no expirada).
   * GET /exportaciones/:id/descarga
   */
  @Get(':id/descarga')
  descargar(@Param('id') id: string, @CurrentUser() usuario: UsuarioActual) {
    return this.exportaciones.descargar(id, usuario);
  }
}
