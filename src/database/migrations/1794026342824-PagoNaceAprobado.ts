import { MigrationInterface, QueryRunner } from 'typeorm';

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
 */
export class PagoNaceAprobado1794026342824 implements MigrationInterface {
  name = 'PagoNaceAprobado1794026342824';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. La cola se cierra: todo lo reportado se aprueba.
    await queryRunner.query(
      `UPDATE pago SET estado = 'aprobado' WHERE estado IN ('reportado', 'correccion_solicitada')`,
    );

    // 2. Estados de reserva y flag obsoleto.
    await queryRunner.query(
      `UPDATE reserva SET estado = 'pendiente_pago' WHERE estado = 'pago_en_verificacion'`,
    );
    await queryRunner.query(
      `UPDATE reserva SET tiene_pago_por_validar = 0 WHERE tiene_pago_por_validar = 1`,
    );

    // 3. Descongelar holds: expira_en vuelve a correr desde ahora.
    const congeladas = (await queryRunner.query(
      `SELECT id, hold_restante_seg FROM reserva WHERE hold_restante_seg IS NOT NULL`,
    )) as { id: string; hold_restante_seg: number }[];
    for (const fila of congeladas) {
      const expira = new Date(Date.now() + Number(fila.hold_restante_seg ?? 0) * 1000);
      await queryRunner.query(
        `UPDATE reserva SET expira_en = ?, hold_restante_seg = NULL WHERE id = ?`,
        [expira.toISOString(), fila.id],
      );
    }

    // 4. Recalcular los derivados de pago con la suma de los aprobados.
    const reservas = (await queryRunner.query(
      `SELECT id, total_usd FROM reserva`,
    )) as { id: string; total_usd: string | null }[];
    for (const r of reservas) {
      const pagos = (await queryRunner.query(
        `SELECT monto_usd_equivalente FROM pago WHERE reserva_id = ? AND estado = 'aprobado'`,
        [r.id],
      )) as { monto_usd_equivalente: string }[];
      const reembolsos = (await queryRunner.query(
        `SELECT monto_usd FROM reembolso WHERE reserva_id = ?`,
        [r.id],
      )) as { monto_usd: string }[];

      const aprobado = pagos.reduce((s, p) => s + Number(p.monto_usd_equivalente), 0);
      const reembolsado = reembolsos.reduce((s, x) => s + Number(x.monto_usd), 0);
      const total = Number(r.total_usd ?? 0);

      let estadoPago = 'sin_pago';
      if (aprobado > 0 && reembolsado >= aprobado) estadoPago = 'reembolsado';
      else if (aprobado - reembolsado >= total && total > 0) estadoPago = 'pagado';
      else if (aprobado > 0) estadoPago = 'parcial';

      await queryRunner.query(
        `UPDATE reserva SET aprobado_usd = ?, reembolsado_usd = ?, estado_pago = ? WHERE id = ?`,
        [aprobado.toFixed(2), reembolsado.toFixed(2), estadoPago, r.id],
      );
    }
  }

  public async down(): Promise<void> {
    // Irreversible: los pagos aprobados no vuelven a la cola.
  }
}
