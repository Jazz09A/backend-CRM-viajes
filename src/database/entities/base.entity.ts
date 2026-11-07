import { BeforeInsert, BeforeUpdate, Column, PrimaryColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { IsoDateTransformer } from '../columns';

/**
 * Entidad base: UUID v7 generado en la app (spec 5.1 — ordenable por tiempo,
 * portable entre SQLite y Postgres).
 */
export abstract class BaseEntity {
  @PrimaryColumn('uuid')
  id!: string;

  @BeforeInsert()
  asignarId() {
    if (!this.id) this.id = uuidv7();
  }
}

export abstract class ConTimestamps extends BaseEntity {
  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer })
  creado_en!: Date;

  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer })
  actualizado_en!: Date;

  @BeforeInsert()
  inicializarTimestamps() {
    const ahora = new Date();
    if (!this.creado_en) this.creado_en = ahora;
    if (!this.actualizado_en) this.actualizado_en = ahora;
  }

  @BeforeUpdate()
  tocarActualizado() {
    this.actualizado_en = new Date();
  }
}
