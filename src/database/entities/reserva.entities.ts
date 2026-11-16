import { IsoDateTransformer } from '../columns';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ConTimestamps } from './base.entity';
import { CategoriaPasajero } from './catalogo.entities';

export type EstadoReserva =
  | 'enlace_creado'
  | 'en_registro'
  | 'pendiente_firma'
  | 'pendiente_pago'
  | 'pago_en_verificacion'
  | 'confirmada'
  | 'completada'
  | 'cancelada'
  | 'expirada';

export type EstadoPagoReserva =
  | 'sin_pago'
  | 'reportado'
  | 'parcial'
  | 'pagado'
  | 'rechazado'
  | 'reembolsado';

export type PasoRegistro = 'titular' | 'acompanantes' | 'preguntas' | 'resumen';
export type CupoEstado = 'ninguno' | 'retenido' | 'vendido' | 'liberado';

@Entity('cliente')
export class Cliente extends ConTimestamps {
  /** Índice ciego HMAC del documento (nunca texto plano). */
  @Index({ unique: true })
  @Column('varchar', { length: 128 }) doc_idx!: string;

  @Column('varchar', { length: 160 }) nombre_ultimo!: string;

  @Column({ type: 'text', nullable: true }) notas?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) anonimizado_en?: Date | null;
}

@Entity('reserva')
@Index(['fecha_tour_id', 'estado'])
@Index(['cliente_id'])
export class Reserva extends ConTimestamps {
  @Index({ unique: true })
  @Column('varchar', { length: 8 }) ref_corta!: string;

  /** VJ-2026-00123, asignado al confirmar (D-01). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 20, nullable: true }) codigo?: string | null;

  /** Token público del QR (128 bits, no enumerable). */
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64, nullable: true }) verif_token?: string | null;

  @Index()
  @Column('uuid') fecha_tour_id!: string;

  @Column({ type: 'uuid', nullable: true }) form_version_id?: string | null;

  /** Versión de términos aceptada por el cliente (la fija al firmar). */
  @Column({ type: 'uuid', nullable: true }) terminos_version_id?: string | null;

  @Column({ type: 'uuid', nullable: true }) cliente_id?: string | null;

  @Column({ type: 'varchar', nullable: true }) referencia_interna?: string | null;

  @Column('varchar', { length: 30, default: 'enlace_creado' }) estado!: EstadoReserva;

  @Column({ type: 'varchar', length: 20, nullable: true }) paso_registro?: PasoRegistro | null;

  @Column({ type: 'simple-json', default: () => "'{}'" })
  pasos_completados!: Record<string, string | null>;

  @Column('varchar', { length: 20, default: 'sin_pago' }) estado_pago!: EstadoPagoReserva;

  @Column({ type: 'boolean', default: false }) tiene_pago_por_validar!: boolean;

  @Column({ type: 'simple-json', default: () => "'{}'" }) respuestas_globales!: Record<string, unknown>;

  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true }) subtotal_usd?: string | null;
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true }) adicionales_usd?: string | null;
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 }) descuentos_usd!: string;
  @Column({ type: 'decimal', precision: 12, scale: 2, nullable: true }) total_usd?: string | null;

  @Column({ type: 'simple-json', nullable: true }) desglose?: Record<string, unknown> | null;
  @Column('varchar', { length: 64, nullable: true }) contenido_hash?: string | null;
  @Column({ type: 'simple-json', nullable: true }) politica_snapshot?: unknown;
  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) resumen_confirmado_en?: Date | null;

  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 }) aprobado_usd!: string;
  @Column({ type: 'decimal', precision: 12, scale: 2, default: 0 }) reembolsado_usd!: string;

  @Column('varchar', { length: 20, default: 'ninguno' }) cupo_estado!: CupoEstado;
  @Column({ type: 'int', default: 0 }) cupo_pasajeros!: number;
  @Column({ type: 'simple-json', default: () => "'[]'" })
  cupo_opciones!: { campo_id: string; valor: string; n: number }[];

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) expira_en?: Date | null;
  @Column({ type: 'int', nullable: true }) hold_restante_seg?: number | null;
  @Column({ type: 'boolean', default: false }) requiere_accion!: boolean;
  @Column({ type: 'varchar', nullable: true }) requiere_accion_motivo?: string | null;

  @Column({ type: 'varchar', nullable: true }) aviso_privacidad_version?: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) aviso_privacidad_en?: Date | null;
  @Column({ type: 'varchar', nullable: true }) aviso_privacidad_ip?: string | null;

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) cancelada_en?: Date | null;
  @Column({ type: 'varchar', length: 20, nullable: true }) cancelacion_origen?:
    | 'cliente'
    | 'agencia'
    | 'fuerza_mayor'
    | null;
  @Column({ type: 'varchar', nullable: true }) cancelacion_motivo?: string | null;
  @Column({ type: 'uuid', nullable: true }) cancelada_por?: string | null;

  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) ultima_actividad_en!: Date;
  @Column({ type: 'int', default: 1 }) version!: number;
  @Column('uuid') creada_por!: string;
}

@Entity('enlace_reserva')
export class EnlaceReserva extends ConTimestamps {
  @Index()
  @Column('uuid') reserva_id!: string;

  /** SHA-256 del token; el token jamás se guarda (D-08). */
  @Index({ unique: true })
  @Column('varchar', { length: 64 }) token_hash!: string;

  @Column('varchar', { length: 20, default: 'vigente' })
  estado!: 'vigente' | 'usado' | 'revocado' | 'vencido';

  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) expira_en!: Date;

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) usado_en?: Date | null;
  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) revocado_en?: Date | null;
  @Column({ type: 'uuid', nullable: true }) revocado_por?: string | null;
  @Column({ type: 'uuid', nullable: true }) reemplaza_a?: string | null;
  @Column('uuid') creado_por!: string;
}

@Entity('pasajero')
export class Pasajero extends ConTimestamps {
  @Index()
  @Column('uuid') reserva_id!: string;

  @Column({ type: 'int' }) orden!: number;

  @Column({ type: 'boolean', default: false }) es_titular!: boolean;

  /** Identificador estable generado por el cliente (UUID). */
  @Column({ type: 'varchar', length: 64, nullable: true }) ref_cliente?: string | null;

  @Column('varchar', { length: 160 }) nombre!: string;

  @Column({ type: 'varchar', length: 10, nullable: true }) tipo_doc?: 'V' | 'E' | 'P' | 'otro' | null;

  // Datos sensibles: cifrado AES-256-GCM + índice ciego HMAC (spec 5.1).
  // Se guardan en base64 para mantener portabilidad sqlite/postgres.
  @Column({ type: 'text', nullable: true }) documento_enc?: string | null;
  @Column({ type: 'varchar', length: 128, nullable: true }) documento_idx?: string | null;
  @Column('varchar', { length: 4, nullable: true }) documento_ultimos4?: string | null;
  @Column({ type: 'text', nullable: true }) fecha_nacimiento_enc?: string | null;
  @Column({ type: 'int', nullable: true }) edad_al_viaje?: number | null;

  @Column({ type: 'varchar', length: 20, nullable: true }) categoria?: CategoriaPasajero | null;

  @Column({ type: 'varchar', length: 30, nullable: true }) telefono?: string | null;
  @Column({ type: 'varchar', length: 254, nullable: true }) correo?: string | null;

  @Column({ type: 'varchar', length: 160, nullable: true }) emergencia_nombre?: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true }) emergencia_telefono?: string | null;

  @Column({ type: 'boolean', nullable: true }) declara_representante?: boolean | null;

  @Column({ type: 'uuid', nullable: true }) autorizacion_archivo_id?: string | null;

  /**
   * Foto del documento de identidad del pasajero (política de la agencia:
   * verifica que los datos sean reales). Referencia lógica a `archivo.id`
   * con proposito `documento_identidad`; se consulta con URL firmada y
   * queda auditada.
   */
  @Column({ type: 'uuid', nullable: true }) documento_imagen_id?: string | null;

  @Column({ type: 'simple-json', default: () => "'{}'" }) respuestas!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) anonimizado_en?: Date | null;
}

@Entity('reserva_linea')
export class ReservaLinea extends ConTimestamps {
  @Index()
  @Column('uuid') reserva_id!: string;

  @Column('varchar', { length: 10 }) tipo!: 'tarifa' | 'extra';
  @Column('varchar', { length: 160 }) concepto!: string;
  @Column({ type: 'uuid', nullable: true }) pasajero_id?: string | null;
  @Column({ type: 'varchar', length: 80, nullable: true }) campo_id?: string | null;
  @Column({ type: 'int' }) cantidad!: number;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) precio_unit_usd!: string;
  @Column({ type: 'decimal', precision: 12, scale: 2 }) subtotal_usd!: string;
}

@Entity('reserva_ajuste')
export class ReservaAjuste extends ConTimestamps {
  @Index()
  @Column('uuid') reserva_id!: string;

  @Column('varchar', { length: 15 }) tipo!: 'descuento' | 'recargo';
  @Column({ type: 'decimal', precision: 12, scale: 2 }) monto_usd!: string;
  @Column('varchar', { length: 10 }) origen!: 'manual' | 'promo';
  @Column({ type: 'uuid', nullable: true }) codigo_promocional_id?: string | null;
  @Column({ type: 'text' }) motivo!: string;
  @Column({ type: 'uuid', nullable: true }) creado_por?: string | null;
  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) anulado_en?: Date | null;
}

@Entity('cupo_movimiento')
export class CupoMovimiento {
  @PrimaryGeneratedColumn('increment') id!: number;

  @Column('uuid') reserva_id!: string;
  @Column('uuid') fecha_tour_id!: string;
  @Column('varchar', { length: 25 })
  tipo!: 'hold' | 'ajuste_hold' | 'venta' | 'liberacion' | 'venta_liberada' | 'reprogramacion_salida' | 'reprogramacion_entrada';
  @Column({ type: 'int' }) cantidad!: number;
  @Column({ type: 'simple-json', default: () => "'[]'" }) opciones!: unknown[];
  @Column({ type: 'varchar', nullable: true }) request_id?: string | null;
  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) creado_en!: Date;
}

@Entity('contador_codigo')
export class ContadorCodigo {
  @Column({ type: 'int', primary: true }) anio!: number;
  @Column({ type: 'int', default: 0 }) ultimo!: number;
}
