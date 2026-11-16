import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Foto del documento de identidad por pasajero (política de la agencia).
 *
 * `documento_imagen_id` apunta a `archivo.id` con proposito
 * `documento_identidad`: la imagen vive en el storage privado y se consulta
 * con una URL firmada que queda auditada.
 */
export class PasajeroDocumentoImagen1794026342823 implements MigrationInterface {
  name = 'PasajeroDocumentoImagen1794026342823';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pasajero" ADD "documento_imagen_id" uuid`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pasajero" DROP COLUMN "documento_imagen_id"`);
  }
}
