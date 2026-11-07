import { IsoDateTransformer } from '../columns';
import { Column, Entity, Index } from 'typeorm';
import { BaseEntity, ConTimestamps } from './base.entity';

/** Claves de configuración con valor por defecto (spec 5.4). */
@Entity('configuracion')
export class Configuracion extends BaseEntity {
  @Index({ unique: true })
  @Column('varchar', { length: 100 }) clave!: string;

  @Column({ type: 'simple-json', nullable: true }) valor?: unknown;

  @Column({ type: 'uuid', nullable: true }) actualizado_por?: string | null;

  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) actualizado_en!: Date;
}

/** Tasa de cambio append-only; la vigente es la última con vigente_desde <= now(). */
@Entity('tasa_cambio')
export class TasaCambio extends ConTimestamps {
  @Column({ type: 'decimal', precision: 14, scale: 4 })
  tasa!: string;

  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) vigente_desde!: Date;

  @Column('uuid') registrada_por!: string;

  @Column({ type: 'varchar', nullable: true }) nota?: string | null;
}

@Entity('metodo_pago')
export class MetodoPago extends ConTimestamps {
  @Index({ unique: true })
  @Column('varchar', { length: 50 }) clave!: string;

  @Column('varchar', { length: 120 }) nombre!: string;

  @Column('varchar', { length: 4 }) moneda!: 'USD' | 'VES' | 'USDT';

  @Column({ type: 'simple-json', default: () => "'{}'" }) datos_cuenta!: Record<string, unknown>;

  @Column({ type: 'simple-json', default: () => "'[]'" })
  campos_requeridos!: { clave: string; etiqueta: string; requerido?: boolean }[];

  @Column({ type: 'boolean', default: true }) requiere_comprobante!: boolean;

  @Column({ type: 'boolean', default: false }) solo_operador!: boolean;

  @Column({ type: 'boolean', default: true }) activo!: boolean;

  @Column({ type: 'int', default: 0 }) orden!: number;
}

@Entity('plantilla_terminos')
export class PlantillaTerminos extends ConTimestamps {
  @Column('varchar', { length: 120 }) nombre!: string;
}

@Entity('plantilla_terminos_version')
export class PlantillaTerminosVersion extends ConTimestamps {
  @Index()
  @Column('uuid') plantilla_id!: string;

  @Column({ type: 'int' }) version!: number;

  @Column({ type: 'text' }) contenido!: string;

  @Column('varchar', { length: 64 }) hash_sha256!: string;

  @Column('varchar', { length: 20 }) estado!: 'borrador' | 'publicada' | 'archivada';

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) publicada_en?: Date | null;

  @Column({ type: 'uuid', nullable: true }) publicada_por?: string | null;
}

@Entity('plantilla_mensaje')
export class PlantillaMensaje extends ConTimestamps {
  @Column('varchar', { length: 80 }) clave!: string;

  @Column('varchar', { length: 20 }) canal!: 'correo' | 'whatsapp';

  @Column({ type: 'varchar', nullable: true }) asunto?: string | null;

  @Column({ type: 'text' }) cuerpo!: string;

  @Column({ type: 'simple-json', default: () => "'[]'" }) variables!: string[];

  @Column({ type: 'int', default: 1 }) version!: number;

  @Column({ type: 'boolean', default: true }) activa!: boolean;
}

@Entity('politica_cancelacion')
export class PoliticaCancelacion extends ConTimestamps {
  @Column('varchar', { length: 120 }) nombre!: string;

  /** [{dias_min, dias_max|null, reembolso_pct}] sin huecos ni solapes. */
  @Column({ type: 'simple-json' }) tramos!: {
    dias_min: number;
    dias_max: number | null;
    reembolso_pct: number;
  }[];
}

@Entity('codigo_promocional')
export class CodigoPromocional extends ConTimestamps {
  @Index({ unique: true })
  @Column('varchar', { length: 60 }) codigo!: string;

  @Column('varchar', { length: 20 }) tipo!: 'porcentaje' | 'monto';

  @Column({ type: 'decimal', precision: 12, scale: 2 }) valor!: string;

  @Column({ type: 'uuid', nullable: true }) tour_id?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) desde?: Date | null;

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) hasta?: Date | null;

  @Column({ type: 'int', nullable: true }) usos_max?: number | null;

  @Column({ type: 'int', default: 0 }) usos!: number;

  @Column({ type: 'boolean', default: true }) activo!: boolean;
}
