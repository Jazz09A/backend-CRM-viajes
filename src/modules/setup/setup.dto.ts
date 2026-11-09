import { Type } from 'class-transformer';
import {
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

/** Datos de la agencia que se personalize en el primer arranque. */
export class AgenciaSetupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre!: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  whatsapp?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  direccion?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  zona_horaria?: string;
}

/** Alta del primer administrador (onboarding de primer arranque). */
export class IniciarSetupDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  nombre!: string;

  @IsEmail()
  correo!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(128)
  password!: string;

  @ValidateNested()
  @Type(() => AgenciaSetupDto)
  agencia!: AgenciaSetupDto;
}
