import { Controller, Get, Query } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { Roles } from '../../common/decorators/roles.decorator';
import { ApiError } from '../../common/errors';
import { afectados } from '../../common/sql.util';

/** Reportes y dashboard (spec 6.7). Consultas agregadas portables. */
@Controller()
export class ReportesController {
  constructor(@InjectDataSource() private readonly ds: DataSource) {}

  private get driver() {
    return this.ds.options.type as string;
  }

  @Get('dashboard')
  @Roles('superadmin', 'operador', 'validador')
  async dashboard() {
    const d = this.driver;
    const reservasPorEstado = await this.ds.query(
      `SELECT estado, COUNT(*) AS n FROM reserva GROUP BY estado`,
    );
    const porConfirmar = await this.ds.query(
      `SELECT COUNT(*) AS n FROM reserva WHERE estado = 'pendiente_pago'`,
    );
    const ocupacion = await this.ds.query(
      `SELECT ft.fecha_salida, ft.cupos_total, ft.cupos_vendidos, ft.cupos_retenidos
       FROM fecha_tour ft WHERE ft.estado = 'publicada' ORDER BY ft.fecha_salida LIMIT 30`,
    );
    void d;
    void afectados;
    return {
      reservas_por_estado: this.normalizar(reservasPorEstado),
      por_confirmar: Number(this.primera(porConfirmar)?.n ?? 0),
      proximas_fechas: this.normalizar(ocupacion),
    };
  }

  @Get('reportes/ocupacion')
  @Roles('superadmin', 'operador', 'guia')
  ocupacion(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    const params: string[] = [];
    let sql = `SELECT ft.id, ft.fecha_salida, ft.hora_salida, t.nombre AS tour,
                      ft.cupos_total, ft.cupos_vendidos, ft.cupos_retenidos, ft.sobrecupo_autorizado
               FROM fecha_tour ft JOIN tour t ON t.id = ft.tour_id
               WHERE ft.estado = 'publicada'`;
    if (desde) { sql += ` AND ft.fecha_salida >= '${desde}'`; }
    if (hasta) { sql += ` AND ft.fecha_salida <= '${hasta}'`; }
    sql += ` ORDER BY ft.fecha_salida`;
    void params;
    return this.ds.query(sql);
  }

  @Get('reportes/ventas')
  @Roles('superadmin')
  ventas(@Query('desde') desde?: string, @Query('hasta') hasta?: string) {
    void desde;
    void hasta;
    // TODO: ingresos por dimensión (tour|fecha|metodo) — RF-11.4.
    throw ApiError.noEncontrado('Reporte');
  }

  private normalizar(res: unknown) {
    const d = this.driver;
    const { filas } = require('../../common/sql.util') as typeof import('../../common/sql.util');
    return filas(d, res);
  }

  private primera(res: unknown): Record<string, unknown> | undefined {
    const filas = this.normalizar(res);
    return filas[0];
  }
}
