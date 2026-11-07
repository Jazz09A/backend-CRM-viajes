import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  correo!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class PasswordCambiarDto {
  @IsString()
  @IsNotEmpty()
  actual!: string;

  @IsString()
  @MinLength(10)
  nueva!: string;
}

export class PasswordRestablecerDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsString()
  @MinLength(10)
  nueva!: string;
}

export class PasswordOlvideDto {
  @IsEmail()
  correo!: string;
}
