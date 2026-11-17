import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { TipoTour } from '../../database/entities';

export class CrearTourDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsIn(['full_day', 'fin_de_semana', 'multi_dia'])
  tipo!: TipoTour;

  /** Clave estable del catálogo (slug). Si no se manda, se deriva del nombre. */
  @IsOptional()
  @IsString()
  clave?: string;

  /** Región o destino del tour (Higuerote, Chuspa, Mérida…). */
  @IsOptional()
  @IsString()
  familia?: string;

  /** Duración del viaje en días y noches. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  duracion_dias?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30)
  duracion_noches?: number;

  /** Hora de salida del tour (las salidas la heredan). */
  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  hora_salida?: string;

  /** Cupos que ofrece el tour por salida. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(200)
  cupos?: number;

  /** Monto de la reserva por persona que fija el catálogo. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  reserva_usd?: number;

  /** Avisos internos del catálogo (no se muestran al cliente). */
  @IsOptional()
  @IsArray()
  notas?: string[];

  @IsOptional()
  @IsString()
  descripcion?: string;

  @IsOptional()
  @IsArray()
  itinerario?: unknown[];

  @IsOptional()
  @IsArray()
  incluye?: string[];

  @IsOptional()
  @IsArray()
  no_incluye?: string[];

  @IsOptional()
  @IsString()
  politica_cancelacion_id?: string;

  @IsOptional()
  @IsString()
  plantilla_terminos_id?: string;

  @IsOptional()
  @IsBoolean()
  requiere_autorizacion_menores?: boolean;

  @IsOptional()
  @IsIn(['no', 'opcional', 'requerido'])
  documento_menores?: 'no' | 'opcional' | 'requerido';

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(60)
  max_pasajeros_reserva?: number;
}

export class ActualizarTourDto extends CrearTourDto {
  @IsOptional()
  @IsIn(['borrador', 'activo', 'archivado'])
  estado?: 'borrador' | 'activo' | 'archivado';

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;
}

export class PuntoAbordajeDto {
  @IsString()
  @IsNotEmpty()
  clave!: string;

  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  hora!: string;

  /** `true` = la hora se confirma después (Caracas: «punto por confirmar»). */
  @IsOptional()
  @IsBoolean()
  confirmar_hora?: boolean;

  @IsOptional()
  @IsString()
  referencia?: string;

  @IsOptional()
  @IsInt()
  orden?: number;

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
