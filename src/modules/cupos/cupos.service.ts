import { Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CupoMovimiento, CupoOpcion, FechaTour } from '../../database/entities';
import { ApiError } from '../../common/errors';
import { filas, max2, ph } from '../../common/sql.util';

export interface OpcionCupo {
  campo_id: string;
  valor: string;
  n: number;
}

/**
 * Motor de cupos (spec 8.1). Los contadores se actualizan con UPDATE
 * condicional atómico — portable entre SQLite y Postgres. En Postgres las
 * rutas críticas deben usar `SELECT ... FOR UPDATE` dentro de transacción.
 */
@Injectable()
export class CuposService {
  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(FechaTour) private readonly fechas: Repository<FechaTour>,
    @InjectRepository(CupoOpcion) private readonly cuposOpcion: Repository<CupoOpcion>,
    @InjectRepository(CupoMovimiento) private readonly movimientos: Repository<CupoMovimiento>,
  ) {}

  private get driver() {
    return this.ds.options.type as string;
  }

  /**
   * Intenta retener `n` cupos generales (+ opcionales por campo).
   * Devuelve false si no hay disponibilidad (nunca sobrevende).
   */
  async retener(
    fechaId: string,
    reservaId: string,
    n: number,
    opciones: OpcionCupo[] = [],
    tipo: 'hold' | 'ajuste_hold' | 'venta' = 'hold',
    requestId?: string,
  ): Promise<boolean> {
    const d = this.driver;
    return this.ds.transaction(async (em) => {
      const res = await em.query(
        `UPDATE fecha_tour
         SET cupos_retenidos = cupos_retenidos + ${ph(d, 0)}
         WHERE id = ${ph(d, 1)}
           AND cupos_retenidos + cupos_vendidos + ${ph(d, 2)} <= cupos_total + COALESCE(sobrecupo_autorizado, 0)
         RETURNING id`,
        [n, fechaId, n],
      );
      if (filas(d, res).length === 0) return false;

      for (const op of opciones) {
        const r = await em.query(
          `UPDATE cupo_opcion
           SET retenidos = retenidos + ${ph(d, 0)}
           WHERE fecha_tour_id = ${ph(d, 1)} AND campo_id = ${ph(d, 2)} AND valor = ${ph(d, 3)}
             AND retenidos + vendidos + ${ph(d, 4)} <= cupo
           RETURNING fecha_tour_id`,
          [op.n, fechaId, op.campo_id, op.valor, op.n],
        );
        if (filas(d, r).length === 0) {
          // Rollback automático de la transacción.
          throw ApiError.transicionInvalida('Opción sin cupo disponible');
        }
      }

      await em.save(CupoMovimiento, {
        reserva_id: reservaId,
        fecha_tour_id: fechaId,
        tipo,
        cantidad: n,
        opciones,
        request_id: requestId ?? null,
        creado_en: new Date(),
      } as CupoMovimiento);
      return true;
    });
  }

  /** Libera cupos retenidos o vendidos (cancelación, expiración). */
  async liberar(
    fechaId: string,
    reservaId: string,
    n: number,
    opciones: OpcionCupo[] = [],
    tipo: 'liberacion' | 'venta_liberada' = 'liberacion',
    requestId?: string,
  ) {
    const d = this.driver;
    await this.ds.transaction(async (em) => {
      await em.query(
        `UPDATE fecha_tour
         SET cupos_vendidos = CASE WHEN cupos_vendidos >= ${ph(d, 0)} THEN cupos_vendidos - ${ph(d, 1)} ELSE cupos_vendidos END,
             cupos_retenidos = cupos_retenidos - CASE WHEN cupos_vendidos >= ${ph(d, 2)} THEN 0 ELSE ${ph(d, 3)} END
         WHERE id = ${ph(d, 4)}`,
        [n, n, n, n, fechaId],
      );
      for (const op of opciones) {
        await em.query(
          `UPDATE cupo_opcion
           SET vendidos = CASE WHEN vendidos >= ${ph(d, 0)} THEN vendidos - ${ph(d, 1)} ELSE vendidos END,
               retenidos = retenidos - CASE WHEN vendidos >= ${ph(d, 2)} THEN 0 ELSE ${ph(d, 3)} END
           WHERE fecha_tour_id = ${ph(d, 4)} AND campo_id = ${ph(d, 5)} AND valor = ${ph(d, 6)}`,
          [op.n, op.n, op.n, op.n, fechaId, op.campo_id, op.valor],
        );
      }
      await em.save(CupoMovimiento, {
        reserva_id: reservaId,
        fecha_tour_id: fechaId,
        tipo,
        cantidad: -n,
        opciones,
        request_id: requestId ?? null,
        creado_en: new Date(),
      } as CupoMovimiento);
    });
  }

  /** Convierte retenidos en vendidos (al confirmar o vender). */
  async vender(fechaId: string, n: number) {
    const d = this.driver;
    await this.ds.query(
      `UPDATE fecha_tour
       SET cupos_retenidos = ${max2(d, `cupos_retenidos - ${ph(d, 0)}`, '0')},
           cupos_vendidos = cupos_vendidos + ${ph(d, 1)}
       WHERE id = ${ph(d, 2)}`,
      [n, n, fechaId],
    );
  }

  /** Disponibilidad actual de la fecha. */
  async disponibilidad(fechaId: string) {
    const f = await this.fechas.findOne({ where: { id: fechaId } });
    if (!f) throw ApiError.noEncontrado('Fecha');
    const capacidad = f.cupos_total + f.sobrecupo_autorizado;
    return {
      cupos_total: f.cupos_total,
      sobrecupo_autorizado: f.sobrecupo_autorizado,
      retenidos: f.cupos_retenidos,
      vendidos: f.cupos_vendidos,
      disponible: Math.max(0, capacidad - f.cupos_retenidos - f.cupos_vendidos),
    };
  }
}
