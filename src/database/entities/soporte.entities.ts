import { IsoDateTransformer } from '../columns';
import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BaseEntity, ConTimestamps } from './base.entity';

export type ActorTipo = 'cliente' | 'usuario' | 'sistema';

@Entity('reserva_estado_historial')
@Index(['reserva_id', 'id'])
export class ReservaEstadoHistorial {
  @PrimaryGeneratedColumn('increment') id!: number;

  @Index()
  @Column('uuid') reserva_id!: string;

  @Column({ type: 'varchar', length: 30, nullable: true }) desde?: string | null;
  @Column('varchar', { length: 30 }) hasta!: string;
  @Column('varchar', { length: 60 }) evento!: string;

  @Column('varchar', { length: 15 }) actor_tipo!: ActorTipo;
  @Column({ type: 'uuid', nullable: true }) actor_id?: string | null;

  @Column({ type: 'text', nullable: true }) motivo?: string | null;
  @Column({ type: 'varchar', nullable: true }) request_id?: string | null;
  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) creado_en!: Date;
}

@Entity('audit_log')
@Index(['entidad', 'entidad_id', 'id'])
@Index(['usuario_id', 'ocurrido_en'])
export class AuditLog {
  @PrimaryGeneratedColumn('increment') id!: number;

  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) ocurrido_en!: Date;
  @Column('varchar', { length: 15 }) actor_tipo!: string;
  @Column({ type: 'uuid', nullable: true }) usuario_id?: string | null;
  @Column({ type: 'varchar', length: 45, nullable: true }) ip?: string | null;
  @Column({ type: 'varchar', nullable: true }) request_id?: string | null;
  @Column('varchar', { length: 80 }) entidad!: string;
  @Column({ type: 'uuid', nullable: true }) entidad_id?: string | null;
  @Column('varchar', { length: 60 }) accion!: string;
  @Column({ type: 'simple-json', nullable: true }) valor_anterior?: unknown;
  @Column({ type: 'simple-json', nullable: true }) valor_nuevo?: unknown;
  /** Cadena de hashes para detectar manipulación (spec 5.8). */
  @Column('varchar', { length: 64, nullable: true }) prev_hash?: string | null;
  @Column('varchar', { length: 64, nullable: true }) hash?: string | null;
}

@Entity('outbox_evento')
@Index(['proximo_intento'])
export class OutboxEvento {  @PrimaryGeneratedColumn('increment') id!: number;

  @Column('varchar', { length: 80 }) tipo!: string;
  @Column({ type: 'simple-json' }) payload!: Record<string, unknown>;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 128, nullable: true }) dedupe_key?: string | null;

  @Column('varchar', { length: 15, default: 'pendiente' })
  estado!: 'pendiente' | 'encolado' | 'procesado' | 'fallido';

  @Column({ type: 'int', default: 0 }) intentos!: number;
  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) proximo_intento!: Date;
  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) creado_en!: Date;
}

/**
 * Registro de idempotencia para escrituras del cliente (spec §8.2).
 *
 * Guarda la respuesta serializada de una acción exitosa identificada por
 * `clave` (Idempotency-Key) y ámbito (reserva). Un reintento con la misma
 * clave devuelve la respuesta guardada sin repetir la escritura.
 */
@Entity('idempotencia')
@Index(['reserva_id', 'creado_en'])
export class Idempotencia extends BaseEntity {
  @Index({ unique: true })
  @Column('varchar', { length: 128 }) clave_ambito!: string;

  @Index()
  @Column({ type: 'uuid' }) reserva_id!: string;

  @Column('varchar', { length: 60 }) endpoint!: string;

  @Column({ type: 'simple-json' }) respuesta!: Record<string, unknown>;

  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) creado_en!: Date;
}

@Entity('email_log')
export class EmailLog extends BaseEntity {
  @Index()
  @Column({ type: 'uuid', nullable: true }) reserva_id?: string | null;
  @Column('varchar', { length: 80 }) plantilla_clave!: string;
  @Column('varchar', { length: 254 }) destinatario!: string;
  @Column({ type: 'varchar', nullable: true }) asunto?: string | null;
  @Column('varchar', { length: 15, default: 'en_cola' })
  estado!: 'en_cola' | 'enviado' | 'rebotado' | 'fallido';
  @Column({ type: 'varchar', nullable: true }) proveedor_msg_id?: string | null;
  @Column({ type: 'text', nullable: true }) error?: string | null;
}

@Entity('notificacion_panel')
export class NotificacionPanel extends ConTimestamps {
  @Column('varchar', { length: 15 }) rol!: string;
  @Column('varchar', { length: 80 }) tipo!: string;
  @Column({ type: 'text' }) titulo!: string;
  @Column({ type: 'text', nullable: true }) cuerpo?: string | null;
  @Column({ type: 'simple-json', nullable: true }) datos?: Record<string, unknown> | null;
  @Column({ type: 'boolean', default: false }) leida!: boolean;
  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) leida_en?: Date | null;
}
