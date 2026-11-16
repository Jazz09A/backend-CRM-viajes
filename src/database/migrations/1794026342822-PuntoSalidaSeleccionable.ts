import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Puntos de salida: `ciudad` + `seleccionable`.
 *
 * - `ciudad` agrupa la lista pública (el bloque informativo de Caracas).
 * - `seleccionable = false` marca los puntos que sólo se muestran como
 *   referencia (los de Caracas se confirman por el grupo de viaje /
 *   WhatsApp): quedan fuera del selector y el backend rechaza guardarlos.
 */
export class PuntoSalidaSeleccionable1794026342822 implements MigrationInterface {
  name = 'PuntoSalidaSeleccionable1794026342822';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "punto_salida" ADD "ciudad" character varying(80)`);
    await queryRunner.query(
      `ALTER TABLE "punto_salida" ADD "seleccionable" boolean NOT NULL DEFAULT true`,
    );
    // Los puntos de Caracas pasan a ser de referencia (decisión operativa).
    await queryRunner.query(
      `UPDATE "punto_salida" SET "seleccionable" = false WHERE "clave" LIKE 'caracas_%'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "punto_salida" DROP COLUMN "seleccionable"`);
    await queryRunner.query(`ALTER TABLE "punto_salida" DROP COLUMN "ciudad"`);
  }
}
