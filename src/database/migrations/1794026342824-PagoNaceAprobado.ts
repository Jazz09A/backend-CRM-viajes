import { MigrationInterface, QueryRunner } from 'typeorm';
import { filas, ph, type DriverDb } from '../../common/sql.util';

/**
 * El pago nace aprobado (fin de la cola del validador).
 *
 * Ya no hay aprobación de pagos: la agencia confirma la reserva primero y el
 * pago se registra después, aprobado desde el inicio. Esta migración:
 *
 *  1. Convierte los pagos en cola (`reportado`, `correccion_solicitada`) a
 *     `aprobado` — el histórico de la cola se asume cobrado.
 *  2. Devuelve las reservas `pago_en_verificacion` a `pendiente_pago` y apaga
 *     `tiene_pago_por_validar` (columna que queda obsoleta).
 *  3. Descongela los holds congelados por la cola: su vencimiento vuelve a
 *     correr con lo que le quedaba.
 *  4. Recalcula `aprobado_usd` / `reembolsado_usd` / `estado_pago` de cada
 *     reserva con los pagos ya aprobados.
 *
 * Portable SQLite/Postgres: booleanos con `TRUE`/`FALSE` (Postgres rechaza
 * `= 0/1` sobre columnas boolean) y placeholders vía `ph()` (`?` vs `$n`).
 */
export class PagoNaceAprobado1794026342824 implements MigrationInterface {
  name = 'PagoNaceAprobado1794026342824';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const d = (queryRunner.connection.options.type ?? 'sqlite') as DriverDb;

    // 1. La cola se cierra: todo lo reportado se aprueba.
    await queryRunner.query(
      `UPDATE pago SET estado = 'aprobado' WHERE estado IN ('reportado', 'correccion_solicitada')`,
    );

    // 2. Estados de reserva y flag obsoleto (boolean portable: TRUE/FALSE
    //    lo entienden Postgres y SQLite; `0/1` sólo SQLite).
    await queryRunner.query(
      `UPDATE reserva SET estado = 'pendiente_pago' WHERE estado = 'pago_en_verificacion'`,
    );
    await queryRunner.query(
      `UPDATE reserva SET tiene_pago_por_validar = false WHERE tiene_pago_por_validar = true`,
    );

    // 3. Descongelar holds: expira_en vuelve a correr desde ahora.
    const congeladas = filas<{ id: string; hold_restante_seg: number }>(
      d,
      await queryRunner.query(
        `SELECT id, hold_restante_seg FROM reserva WHERE hold_restante_seg IS NOT NULL`,
      ),
    );
    for (const fila of congeladas) {
      const expira = new Date(Date.now() + Number(fila.hold_restante_seg ?? 0) * 1000);
      await queryRunner.query(
        `UPDATE reserva SET expira_en = ${ph(d, 0)}, hold_restante_seg = NULL WHERE id = ${ph(d, 1)}`,
        [expira.toISOString(), fila.id],
      );
    }

    // 4. Recalcular los derivados de pago con la suma de los aprobados.
    const reservas = filas<{ id: string; total_usd: string | null }>(
      d,
      await queryRunner.query(`SELECT id, total_usd FROM reserva`),
    );
    for (const r of reservas) {
      const pagos = filas<{ monto_usd_equivalente: string }>(
        d,
        await queryRunner.query(
          `SELECT monto_usd_equivalente FROM pago WHERE reserva_id = ${ph(d, 0)} AND estado = 'aprobado'`,
          [r.id],
        ),
      );
      const reembolsos = filas<{ monto_usd: string }>(
        d,
        await queryRunner.query(
          `SELECT monto_usd FROM reembolso WHERE reserva_id = ${ph(d, 0)}`,
          [r.id],
        ),
      );

      const aprobado = pagos.reduce((s, p) => s + Number(p.monto_usd_equivalente), 0);
      const reembolsado = reembolsos.reduce((s, x) => s + Number(x.monto_usd), 0);
      const total = Number(r.total_usd ?? 0);

      let estadoPago = 'sin_pago';
      if (aprobado > 0 && reembolsado >= aprobado) estadoPago = 'reembolsado';
      else if (aprobado - reembolsado >= total && total > 0) estadoPago = 'pagado';
      else if (aprobado > 0) estadoPago = 'parcial';

      await queryRunner.query(
        `UPDATE reserva SET aprobado_usd = ${ph(d, 0)}, reembolsado_usd = ${ph(d, 1)}, estado_pago = ${ph(d, 2)} WHERE id = ${ph(d, 3)}`,
        [aprobado.toFixed(2), reembolsado.toFixed(2), estadoPago, r.id],
      );
    }
  }

  public async down(): Promise<void> {
    // Irreversible: los pagos aprobados no vuelven a la cola.
  }
}
