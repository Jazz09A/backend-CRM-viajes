import { IsoDateTransformer } from '../columns';
import { BeforeInsert, Column, Entity, Index, PrimaryColumn } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import { ConTimestamps } from './base.entity';
import { Rol } from '../../common/decorators/roles.decorator';

@Entity('usuario')
export class Usuario extends ConTimestamps {
  @Column({ type: 'varchar', length: 120 })
  nombre!: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 254 })
  correo!: string;

  @Column({ type: 'varchar', length: 255 })
  password_hash!: string;

  /** Un usuario puede tener varios roles (spec 5.3). */
  @Column({ type: 'simple-json' })
  roles!: Rol[];

  @Column({ type: 'boolean', default: true })
  activo!: boolean;

  @Column({ type: 'varchar', nullable: true })
  totp_secret_enc?: string | null;

  @Column({ type: 'boolean', default: false })
  dos_fa_activo!: boolean;

  @Column({ type: 'int', default: 0 })
  intentos_fallidos!: number;

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer })
  bloqueado_hasta?: Date | null;

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer })
  ultimo_login_en?: Date | null;
}

@Entity('usuario_recovery_code')
export class UsuarioRecoveryCode {
  @PrimaryColumn('uuid') usuario_id!: string;

  @PrimaryColumn('varchar') code_hash!: string;

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) usado_en?: Date | null;
}

/** Refresh tokens rotativos; solo se guarda el hash (spec 5.3, 10.4). */
@Entity('sesion')
export class Sesion {
  @PrimaryColumn('uuid') id!: string;

  @BeforeInsert()
  asignarId() {
    if (!this.id) this.id = uuidv7();
  }

  @Index()
  @Column('uuid') usuario_id!: string;

  @Index()
  @Column('uuid') familia_id!: string;

  @Index({ unique: true })
  @Column('varchar', { length: 128 }) refresh_hash!: string;

  @Column({ type: 'varchar', length: 45, nullable: true }) ip?: string | null;

  @Column({ type: 'varchar', length: 500, nullable: true }) user_agent?: string | null;

  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) creada_en!: Date;

  @Column({ type: 'varchar', length: 30, transformer: IsoDateTransformer }) expira_en!: Date;

  @Column({ type: 'varchar', length: 30, nullable: true, transformer: IsoDateTransformer }) revocada_en?: Date | null;

  @Column({ type: 'uuid', nullable: true }) reemplazada_por?: string | null;
}
