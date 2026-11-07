import { IsoDateTransformer } from '../columns';
import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { ConTimestamps } from './base.entity';

export type TipoTour = 'full_day' | 'fin_de_semana' | 'multi_dia';
export type CategoriaPasajero = 'adulto' | 'nino' | 'tercera_edad' | 'infante';
export type EstadoTour = 'borrador' | 'activo' | 'archivado';
export type EstadoFecha = 'borrador' | 'publicada' | 'cerrada' | 'cancelada';
export type EstadoFormVersion = 'borrador' | 'publicada' | 'archivada';

@Entity('tour')
export class Tour extends ConTimestamps {
  @Column('varchar', { length: 160 }) nombre!: string;

  @Column('varchar', { length: 20 }) tipo!: TipoTour;

  @Column({ type: 'text', nullable: true }) descripcion?: string | null;

  @Column({ type: 'simple-json', default: () => "'[]'" }) itinerario!: unknown[];

  @Column({ type: 'simple-json', default: () => "'[]'" }) incluye!: string[];

  @Column({ type: 'simple-json', default: () => "'[]'" }) no_incluye!: string[];

  @Column({ type: 'simple-json', default: () => "'[]'" }) imagenes!: string[];

  @Column({ type: 'uuid', nullable: true }) politica_cancelacion_id?: string | null;

  @Column({ type: 'uuid', nullable: true }) plantilla_terminos_id?: string | null;

  @Column({ type: 'boolean', default: false }) requiere_autorizacion_menores!: boolean;

  @Column('varchar', { length: 20, default: 'opcional' })
  documento_menores!: 'no' | 'opcional' | 'requerido';

  @Column({ type: 'int', nullable: true }) max_pasajeros_reserva?: number | null;

  @Column('varchar', { length: 20, default: 'borrador' }) estado!: EstadoTour;

  @Column({ type: 'int', default: 1 }) version!: number;

  @Column({ type: 'uuid', nullable: true }) creado_por?: string | null;
}

@Entity('tour_punto_abordaje')
export class TourPuntoAbordaje extends ConTimestamps {
  @Index()
  @Column('uuid') tour_id!: string;

  @Column('varchar', { length: 40 }) clave!: string;

  @Column('varchar', { length: 160 }) nombre!: string;

  @Column('varchar', { length: 5 }) hora!: string; // HH:MM

  @Column({ type: 'varchar', nullable: true }) referencia?: string | null;

  @Column({ type: 'int', default: 0 }) orden!: number;

  @Column({ type: 'boolean', default: true }) activo!: boolean;
}

@Entity('campo_biblioteca')
export class CampoBiblioteca extends ConTimestamps {
  @Index({ unique: true })
  @Column('varchar', { length: 80 }) clave!: string;

  @Column('varchar', { length: 120 }) nombre!: string;

  @Column({ type: 'simple-json' }) definicion!: Record<string, unknown>;

  @Column({ type: 'boolean', default: true }) activo!: boolean;
}

/** Snapshot inmutable una vez publicada (RF-3.7). */
@Entity('tour_form_version')
export class TourFormVersion extends ConTimestamps {
  @Index()
  @Column('uuid') tour_id!: string;

  @Column({ type: 'int' }) version!: number;

  @Column('varchar', { length: 20 }) estado!: EstadoFormVersion;

  @Column({ type: 'simple-json' }) definicion!: Record<string, unknown>;

  @Column('varchar', { length: 64 }) hash!: string;

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) publicada_en?: Date | null;

  @Column({ type: 'uuid', nullable: true }) publicada_por?: string | null;
}

@Entity('fecha_tour')
export class FechaTour extends ConTimestamps {
  @Index()
  @Column('uuid') tour_id!: string;

  @Column('varchar', { length: 10 }) fecha_salida!: string; // YYYY-MM-DD local agencia

  @Column('varchar', { length: 5 }) hora_salida!: string; // HH:MM local agencia

  @Column({ type: 'int' }) cupos_total!: number;

  @Column({ type: 'int', default: 0 }) sobrecupo_autorizado!: number;

  @Column({ type: 'int', default: 0 }) cupos_retenidos!: number;

  @Column({ type: 'int', default: 0 }) cupos_vendidos!: number;

  @Column('varchar', { length: 20, default: 'borrador' }) estado!: EstadoFecha;

  @Column({ type: 'varchar', length: 20, nullable: true }) cierre_motivo?: 'sin_cupo' | 'manual' | null;

  @Column({ type: 'int', default: 12 }) corte_venta_horas!: number;

  @Column({ type: 'varchar', nullable: true }) cancelada_motivo?: string | null;

  @Column({ type: 'int', default: 1 }) version!: number;
}

@Entity('fecha_sobrecupo')
export class FechaSobrecupo extends ConTimestamps {
  @Index()
  @Column('uuid') fecha_tour_id!: string;

  @Column({ type: 'int' }) cantidad!: number;

  @Column({ type: 'text' }) motivo!: string;

  @Column('uuid') autorizado_por!: string;
}

@Entity('tarifa')
export class Tarifa extends ConTimestamps {
  @Index()
  @Column('uuid') fecha_tour_id!: string;

  @Column('varchar', { length: 20 }) categoria!: CategoriaPasajero;

  @Column({ type: 'int' }) edad_min!: number;

  @Column({ type: 'int' }) edad_max!: number;

  @Column({ type: 'decimal', precision: 12, scale: 2 }) precio_usd!: string;
}

/** Cupo propio por opción de campo (RF-3.5), creado al publicar la fecha. */
@Entity('cupo_opcion')
export class CupoOpcion {
  @BeforeInsert()
  initFecha() {
    if (!this.creado_en) this.creado_en = new Date();
  }

  @PrimaryColumn('uuid') fecha_tour_id!: string;

  @PrimaryColumn('varchar', { length: 80 }) campo_id!: string;

  @PrimaryColumn('varchar', { length: 120 }) valor!: string;

  @Column({ type: 'int' }) cupo!: number;

  @Column({ type: 'int', default: 0 }) retenidos!: number;

  @Column({ type: 'int', default: 0 }) vendidos!: number;

  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer })
  creado_en!: Date;
}
