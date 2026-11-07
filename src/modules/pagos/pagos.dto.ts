import { IsIn, IsNotEmpty, IsNumber, IsOptional, IsString, MaxLength } from 'class-validator';

export class AprobarPagoDto {
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  monto_validado?: number;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  ajuste_motivo?: string;

  @IsOptional()
  confirmar_duplicado?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  duplicado_motivo?: string;
}

export class RechazarPagoDto {
  @IsString()
  @IsNotEmpty()
  motivo_codigo!: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  motivo_texto?: string;
}

export class SolicitarCorreccionDto {
  @IsString()
  texto!: string;
}

export class ReembolsoDto {
  @IsNumber({ maxDecimalPlaces: 2 })
  monto_usd!: number;

  @IsString()
  metodo!: string;

  @IsOptional()
  @IsString()
  referencia?: string;

  @IsString()
  motivo!: string;

  @IsString()
  fecha!: string;
}

export class RegistrarPagoAdminDto {
  @IsString()
  fecha_tour_id!: string;

  @IsString()
  metodo_clave!: string;

  @IsNumber({ maxDecimalPlaces: 2 })
  monto!: number;

  @IsIn(['USD', 'VES', 'USDT'])
  moneda!: 'USD' | 'VES' | 'USDT';

  @IsString()
  fecha_pago!: string;

  @IsOptional()
  @IsString()
  referencia?: string;
}
