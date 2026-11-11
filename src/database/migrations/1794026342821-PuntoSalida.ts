import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Catálogo global de puntos de salida (Guatire, Guarenas, Caracas…).
 *
 * Reemplaza las opciones por tour congeladas en los formularios: los
 * formularios públicos resuelven las opciones de `punto_abordaje` desde
 * esta tabla en cada render, de modo que crear o quitar un punto se
 * refleja sin republicar formularios.
 */
export class PuntoSalida1794026342821 implements MigrationInterface {
  name = 'PuntoSalida1794026342821';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE "punto_salida" ("id" uuid NOT NULL, "creado_en" character varying(30) NOT NULL, "actualizado_en" character varying(30) NOT NULL, "clave" character varying(40) NOT NULL, "nombre" character varying(160) NOT NULL, "hora" character varying(5) NOT NULL, "referencia" character varying, "orden" integer NOT NULL DEFAULT '0', "activo" boolean NOT NULL DEFAULT true, CONSTRAINT "PK_punto_salida" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "IDX_punto_salida_clave" ON "punto_salida" ("clave") `,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "IDX_punto_salida_clave"`);
    await queryRunner.query(`DROP TABLE "punto_salida"`);
  }
}
