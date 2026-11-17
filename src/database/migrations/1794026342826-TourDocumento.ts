import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El documento de tour: el catálogo como contrato.
 *
 * - `tour`: `clave` (identidad estable del catálogo), `familia`, duración en
 *   días/noches, `hora_salida`, `cupos`, `reserva_usd` y `notas` (avisos
 *   internos del chat que hasta ahora se perdían).
 * - `tour_precio`: matriz de precios **del tour** (plantilla). Cada salida
 *   recibe su copia congelada en `tarifa`; así `precios` del catálogo es un
 *   dato del tour y no 552 filas sueltas.
 * - `tour_punto_abordaje.confirmar_hora`: Caracas es «punto por confirmar»,
 *   su hora se confirma después por el grupo de viaje.
 * - `politica_cancelacion.clave` y `plantilla_terminos.clave`: el documento
 *   referencia políticas y términos por clave (como ya hacía el catálogo con
 *   `"politica": "full_day"`).
 */
export class TourDocumento1794026342826 implements MigrationInterface {
  name = 'TourDocumento1794026342826';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── tour ────────────────────────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "tour" ADD "clave" character varying(80)`);
    await queryRunner.query(`ALTER TABLE "tour" ADD "familia" character varying(80)`);
    await queryRunner.query(`ALTER TABLE "tour" ADD "duracion_dias" integer`);
    await queryRunner.query(`ALTER TABLE "tour" ADD "duracion_noches" integer`);
    await queryRunner.query(`ALTER TABLE "tour" ADD "hora_salida" character varying(5)`);
    await queryRunner.query(`ALTER TABLE "tour" ADD "cupos" integer`);
    await queryRunner.query(`ALTER TABLE "tour" ADD "reserva_usd" numeric(12,2)`);
    await queryRunner.query(`ALTER TABLE "tour" ADD "notas" text NOT NULL DEFAULT '[]'`);

    // ── puntos de abordaje ──────────────────────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "tour_punto_abordaje" ADD "confirmar_hora" boolean NOT NULL DEFAULT false`,
    );

    // ── políticas y términos ────────────────────────────────────────────
    await queryRunner.query(`ALTER TABLE "politica_cancelacion" ADD "clave" character varying(40)`);
    await queryRunner.query(`ALTER TABLE "plantilla_terminos" ADD "clave" character varying(80)`);

    // ── matriz de precios del tour ─────────────────────────────────────
    await queryRunner.query(
      `CREATE TABLE IF NOT EXISTS "tour_precio" ("id" uuid NOT NULL, "creado_en" character varying(30) NOT NULL, "actualizado_en" character varying(30) NOT NULL, "tour_id" uuid NOT NULL, "categoria" character varying(20) NOT NULL, "edad_min" integer NOT NULL, "edad_max" integer NOT NULL, "precio_usd" numeric(12,2) NOT NULL, CONSTRAINT "PK_tour_precio" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_tour_precio_tour" ON "tour_precio" ("tour_id")`,
    );

    // La plantilla de cada tour se toma de la primera tarifa que tiene.
    await queryRunner.query(
      `INSERT INTO "tour_precio" ("id", "creado_en", "actualizado_en", "tour_id", "categoria", "edad_min", "edad_max", "precio_usd")
       SELECT t2."id", t2."creado_en", t2."actualizado_en", f2."tour_id", t2."categoria", t2."edad_min", t2."edad_max", t2."precio_usd"
         FROM "tarifa" t2
         JOIN "fecha_tour" f2 ON f2."id" = t2."fecha_tour_id"
        WHERE t2."id" IN (
          SELECT MIN(t3."id")
            FROM "tarifa" t3
            JOIN "fecha_tour" f3 ON f3."id" = t3."fecha_tour_id"
           GROUP BY f3."tour_id", t3."categoria"
        )`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_tour_precio_tour"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "tour_precio"`);
    await queryRunner.query(`ALTER TABLE "plantilla_terminos" DROP COLUMN "clave"`);
    await queryRunner.query(`ALTER TABLE "politica_cancelacion" DROP COLUMN "clave"`);
    await queryRunner.query(`ALTER TABLE "tour_punto_abordaje" DROP COLUMN "confirmar_hora"`);
    await queryRunner.query(`ALTER TABLE "tour" DROP COLUMN "notas"`);
    await queryRunner.query(`ALTER TABLE "tour" DROP COLUMN "reserva_usd"`);
    await queryRunner.query(`ALTER TABLE "tour" DROP COLUMN "cupos"`);
    await queryRunner.query(`ALTER TABLE "tour" DROP COLUMN "hora_salida"`);
    await queryRunner.query(`ALTER TABLE "tour" DROP COLUMN "duracion_noches"`);
    await queryRunner.query(`ALTER TABLE "tour" DROP COLUMN "duracion_dias"`);
    await queryRunner.query(`ALTER TABLE "tour" DROP COLUMN "familia"`);
    await queryRunner.query(`ALTER TABLE "tour" DROP COLUMN "clave"`);
  }
}
