import { SetMetadata } from '@nestjs/common';

export type Rol = 'superadmin' | 'administrador' | 'operador' | 'validador' | 'guia';
export const ROLES_KEY = 'roles';
export const Roles = (...roles: Rol[]) => SetMetadata(ROLES_KEY, roles);
export const Public = () => SetMetadata('esPublico', true);
