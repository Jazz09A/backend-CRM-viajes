import { IsoDateTransformer } from '../columns';
import { Column, Entity, Index } from 'typeorm';
import { ConTimestamps } from './base.entity';
import { Reserva } from './reserva.entities';

export type PropositoArchivo =
  | 'comprobante'
  | 'firma_cliente'
  | 'autorizacion_menor'
  | 'voucher'
  | 'firma_empresa'
  | 'imagen_tour'
  | 'factura'
  | 'exportacion';

@Entity('archivo')
export class Archivo extends ConTimestamps {
  @Column('varchar', { length: 30 }) proposito!: PropositoArchivo;

  @Index()
  @Column({ type: 'uuid', nullable: true }) reserva_id?: string | null;

  @Index({ unique: true })
  @Column('varchar', { length: 500 }) bucket_key!: string;

  @Column('varchar', { length: 120 }) mime_real!: string;

  @Column({ type: 'int' }) tamano_bytes!: number;

  @Column('varchar', { length: 64 }) sha256!: string;

  @Column('varchar', { length: 20, default: 'en_analisis' })
  estado!: 'en_analisis' | 'limpio' | 'rechazado';

  @Column({ type: 'varchar', nullable: true }) motivo_rechazo?: string | null;
  @Column({ type: 'uuid', nullable: true }) subido_por?: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) escaneado_en?: Date | null;
  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) eliminado_en?: Date | null;
}

@Entity('firma')
export class Firma extends ConTimestamps {
  @Index()
  @Column('uuid') reserva_id!: string;

  @Column({ type: 'boolean', default: true }) vigente!: boolean;

  @Column('uuid') archivo_id!: string;
  @Column('varchar', { length: 64 }) hash_imagen!: string;
  @Column('varchar', { length: 64 }) hash_documento!: string;
  @Column('varchar', { length: 64 }) contenido_hash!: string;
  @Column('uuid') terminos_version_id!: string;

  @Column('varchar', { length: 45 }) ip!: string;
  @Column('varchar', { length: 500 }) user_agent!: string;
  @Column({ type: 'boolean' }) scroll_completo!: boolean;
  @Column({ type: 'simple-json' }) trazos!: { n_trazos: number; longitud_px: number; duracion_ms: number };

  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) firmada_en!: Date;
  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) invalidada_en?: Date | null;
  @Column({ type: 'varchar', nullable: true }) invalidada_motivo?: string | null;
}

export type EstadoPago = 'reportado' | 'correccion_solicitada' | 'aprobado' | 'rechazado' | 'anulado';

@Entity('pago')
export class Pago extends ConTimestamps {
  @Column('uuid') reserva_id!: string;

  @Index()
  @Column('uuid') metodo_id!: string;

  @Column('varchar', { length: 15 }) origen!: 'cliente' | 'operador';

  @Column('varchar', { length: 25, default: 'reportado' }) estado!: EstadoPago;

  @Column({ type: 'decimal', precision: 14, scale: 2 }) monto_reportado!: string;
  @Column({ type: 'decimal', precision: 14, scale: 2 }) monto!: string;
  @Column('varchar', { length: 4 }) moneda!: 'USD' | 'VES' | 'USDT';
  @Column({ type: 'decimal', precision: 14, scale: 4, default: 1 }) tasa!: string;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) monto_usd_equivalente!: string;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) esperado_usd!: string;

  @Column('varchar', { length: 10 }) fecha_pago!: string;
  @Column({ type: 'varchar', nullable: true }) referencia?: string | null;
  @Column({ type: 'varchar', nullable: true }) referencia_norm?: string | null;

  @Column({ type: 'uuid', nullable: true }) comprobante_archivo_id?: string | null;
  @Column({ type: 'simple-json', default: () => "'{}'" }) campos_extra!: Record<string, unknown>;

  @Column({ type: 'uuid', nullable: true }) duplicado_de_pago_id?: string | null;
  @Column({ type: 'boolean', default: false }) duplicado_confirmado!: boolean;
  @Column({ type: 'varchar', nullable: true }) duplicado_motivo?: string | null;
  @Column({ type: 'varchar', nullable: true }) ajuste_validador_motivo?: string | null;
  @Column({ type: 'text', nullable: true }) correccion_texto?: string | null;
  @Column({ type: 'varchar', nullable: true }) motivo_rechazo_codigo?: string | null;
  @Column({ type: 'varchar', nullable: true }) motivo_rechazo_texto?: string | null;

  @Column({ type: 'uuid', nullable: true }) validado_por?: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) validado_en?: Date | null;
  @Column({ type: 'uuid', nullable: true }) registrado_por?: string | null;
}

@Entity('reembolso')
export class Reembolso extends ConTimestamps {
  @Index()
  @Column('uuid') pago_id!: string;
  @Index()
  @Column('uuid') reserva_id!: string;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) monto_usd!: string;
  @Column({ type: 'decimal', precision: 14, scale: 2 }) monto_pagado!: string;
  @Column('varchar', { length: 4 }) moneda!: string;
  @Column('varchar', { length: 60 }) metodo!: string;
  @Column({ type: 'varchar', nullable: true }) referencia?: string | null;
  @Column({ type: 'text' }) motivo!: string;
  @Column({ type: 'uuid', nullable: true }) comprobante_archivo_id?: string | null;
  @Column('uuid') registrado_por!: string;
  @Column('varchar', { length: 10 }) fecha!: string;
}

@Entity('voucher')
export class Voucher extends ConTimestamps {
  @Index()
  @Column('uuid') reserva_id!: string;

  @Column({ type: 'int' }) version!: number;
  @Column('varchar', { length: 15, default: 'final' }) tipo!: 'provisional' | 'final';
  @Column('varchar', { length: 20 }) estado!: 'generando' | 'listo' | 'error' | 'reemplazado' | 'invalidado';
  @Column({ type: 'uuid', nullable: true }) archivo_id?: string | null;
  @Column({ type: 'varchar', nullable: true }) motivo_regeneracion?: string | null;
  @Column({ type: 'int', default: 0 }) intentos!: number;
  @Column({ type: 'text', nullable: true }) error?: string | null;
  @Column({ type: 'boolean', default: false }) vigente!: boolean;
  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) generado_en?: Date | null;
}

@Entity('factura')
export class Factura extends ConTimestamps {
  @Index()
  @Column('uuid') reserva_id!: string;
  @Column('varchar', { length: 60 }) numero!: string;
  @Column({ type: 'uuid', nullable: true }) archivo_id?: string | null;
  @Column('uuid') registrada_por!: string;
}

export type TipoExportacion =
  | 'reservas'
  | 'tours'
  | 'pasajeros_tour'
  | 'clientes'
  | 'pagos'
  | 'manifest'
  | 'cocina';

export type EstadoExportacion = 'en_cola' | 'procesando' | 'lista' | 'error' | 'expirada';

@Entity('exportacion')
export class Exportacion extends ConTimestamps {
  @Index()
  @Column('varchar', { length: 30 }) tipo!: TipoExportacion;

  @Column({ type: 'simple-json' }) filtros!: Record<string, unknown>;

  @Index()
  @Column('varchar', { length: 20, default: 'en_cola' }) estado!: EstadoExportacion;

  @Column({ type: 'uuid', nullable: true }) archivo_id?: string | null;

  @Index()
  @Column('uuid') solicitada_por!: string;

  @Column('varchar', { length: 200, nullable: true }) nombre_archivo?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) expira_en?: Date | null;

  @Column({ type: 'text', nullable: true }) error?: string | null;

  @Column({ type: 'int', default: 0 }) intentos!: number;
}
