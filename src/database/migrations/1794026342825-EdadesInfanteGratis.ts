import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Regla de edad de la agencia: los menores de 5 años viajan gratis (en
 * piernas de su representante) y "niño" empieza a los 5.
 *
 * Actualiza las filas existentes de `tarifa`:
 *  - `infante`: 0–4 y precio 0 (antes 0–2 con precio del catálogo).
 *  - `nino`: 5–11 (antes 3–11).
 * El motor interno sigue usando categorías para calcular precios.
 */
export class EdadesInfanteGratis1794026342825 implements MigrationInterface {
  name = 'EdadesInfanteGratis1794026342825';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE tarifa SET edad_min = 0, edad_max = 4, precio_usd = '0.00' WHERE categoria = 'infante'`,
    );
    await queryRunner.query(
      `UPDATE tarifa SET edad_min = 5, edad_max = 11 WHERE categoria = 'nino'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE tarifa SET edad_min = 0, edad_max = 2 WHERE categoria = 'infante'`,
    );
    await queryRunner.query(
      `UPDATE tarifa SET edad_min = 3, edad_max = 11 WHERE categoria = 'nino'`,
    );
  }
}
