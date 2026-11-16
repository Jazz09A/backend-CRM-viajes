import { IsNotEmpty, IsNumber, IsOptional, IsString } from 'class-validator';

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

  @IsString()
  fecha_pago!: string;

  @IsOptional()
  @IsString()
  referencia?: string;
}
