import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min } from 'class-validator';

export class CrearReservaDto {
  @IsString()
  @IsNotEmpty()
  fecha_tour_id!: string;

  @IsOptional()
  @IsString()
  referencia_interna?: string;
}

export class CancelarReservaDto {
  @IsIn(['cliente', 'agencia', 'fuerza_mayor'])
  origen!: 'cliente' | 'agencia' | 'fuerza_mayor';

  @IsString()
  @IsNotEmpty()
  motivo!: string;

  @IsOptional()
  forzar?: boolean;
}

export class ExtenderHoldDto {
  @IsInt()
  @Min(1)
  @Max(72)
  horas!: number;

  @IsString()
  @IsNotEmpty()
  motivo!: string;
}
