import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Usuario } from '../../database/entities';
import { ApiError } from '../../common/errors';
import { ActualizarUsuarioDto, CrearUsuarioDto } from './usuarios.dto';
import { Rol } from '../../common/decorators/roles.decorator';

const ROLES_VALIDOS: Rol[] = ['superadmin', 'operador', 'validador', 'guia'];

@Injectable()
export class UsuariosService {
  constructor(@InjectRepository(Usuario) private readonly repo: Repository<Usuario>) {}

  listar() {
    return this.repo.find({ order: { creado_en: 'ASC' } });
  }

  async crear(dto: CrearUsuarioDto) {
    this.validarRoles(dto.roles);
    const correo = dto.correo.toLowerCase();
    if (await this.repo.findOne({ where: { correo } })) {
      throw ApiError.validacion('Ya existe un usuario con ese correo', [
        { campo: 'correo', codigo: 'DUPLICADO', mensaje: 'Correo ya registrado' },
      ]);
    }
    // TODO: enviar invitación para fijar contraseña (spec 6.2).
    const usuario = this.repo.create({
      nombre: dto.nombre,
      correo,
      roles: dto.roles,
      password_hash: 'PENDIENTE', // se reemplaza al aceptar la invitación
      activo: true,
    });
    return this.repo.save(usuario);
  }

  async actualizar(id: string, dto: ActualizarUsuarioDto, actorId: string) {
    const usuario = await this.repo.findOne({ where: { id } });
    if (!usuario) throw ApiError.noEncontrado('Usuario');
    if (dto.roles) this.validarRoles(dto.roles);

    const eraUltimoSa =
      usuario.roles.includes('superadmin') &&
      !(dto.roles ?? usuario.roles).includes('superadmin');
    if (eraUltimoSa && (await this.contarSuperadmins()) <= 1) {
      throw ApiError.validacion('No se puede quitar el último superadministrador');
    }
    if (dto.activo === false && id === actorId) {
      throw ApiError.validacion('No puedes desactivarte a ti mismo');
    }

    Object.assign(usuario, dto);
    return this.repo.save(usuario);
  }

  private validarRoles(roles: Rol[]) {
    if (!roles?.length || roles.some((r) => !ROLES_VALIDOS.includes(r))) {
      throw ApiError.validacion('Roles inválidos', [
        { campo: 'roles', codigo: 'INVALIDO', mensaje: `Roles válidos: ${ROLES_VALIDOS.join(', ')}` },
      ]);
    }
  }

  private async contarSuperadmins(): Promise<number> {
    const todos = await this.repo.find();
    return todos.filter((u) => u.activo && u.roles.includes('superadmin')).length;
  }
}
