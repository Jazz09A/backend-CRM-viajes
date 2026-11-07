import { Type } from 'class-transformer';
import {
  ArrayMinSize,
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
  ValidateNested,
} from 'class-validator';
import { CategoriaPasajero } from '../../database/entities';

export class TarifaDto {
  @IsIn(['adulto', 'nino', 'tercera_edad', 'infante'])
  categoria!: CategoriaPasajero;

  @IsInt()
  @Min(0)
  edad_min!: number;

  @IsInt()
  @Min(0)
  edad_max!: number;

  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  precio_usd!: number;
}

export class CupoOpcionDto {
  @IsString()
  @IsNotEmpty()
  campo_id!: string;

  @IsString()
  @IsNotEmpty()
  valor!: string;

  @IsInt()
  @Min(0)
  cupo!: number;
}

export class CrearFechaDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fecha_salida!: string;

  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  hora_salida!: string;

  @IsInt()
  @Min(0)
  cupos_total!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sobrecupo_autorizado?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(168)
  corte_venta_horas?: number;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => TarifaDto)
  tarifas!: TarifaDto[];

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CupoOpcionDto)
  cupos_opcion?: CupoOpcionDto[];
}

export class ActualizarFechaDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  fecha_salida?: string;

  @IsOptional()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  hora_salida?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  cupos_total?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  corte_venta_horas?: number;

  @IsOptional()
  @IsBoolean()
  aceptado?: boolean;
}

export class SobrecupoDto {
  @IsInt()
  @Min(1)
  cantidad!: number;

  @IsString()
  @IsNotEmpty()
  motivo!: string;
}
