import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
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
