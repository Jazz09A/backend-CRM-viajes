import { IsArray, IsBoolean, IsEmail, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';
import { Rol } from '../../common/decorators/roles.decorator';

export class CrearUsuarioDto {
  @IsString()
  @IsNotEmpty()
  nombre!: string;

  @IsEmail()
  correo!: string;

  @IsArray()
  roles!: Rol[];
}

export class ActualizarUsuarioDto {
  @IsOptional()
  @IsString()
  nombre?: string;

  @IsOptional()
  @IsArray()
  roles?: Rol[];

  @IsOptional()
  @IsBoolean()
  activo?: boolean;
}
