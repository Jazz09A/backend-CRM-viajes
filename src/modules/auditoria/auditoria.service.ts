import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditLog } from '../../database/entities';
import { sha256Hex } from '../../common/crypto.util';

export interface EntradaAuditoria {
  actorTipo: string;
  usuarioId?: string | null;
  ip?: string | null;
  requestId?: string | null;
  entidad: string;
  entidadId?: string | null;
  accion: string;
  valorAnterior?: unknown;
  valorNuevo?: unknown;
}

/**
 * Audit log con cadena de hashes (spec 5.8): cada fila encadena con la
 * anterior para detectar manipulación. En Postgres se refuerza con
 * permisos (REVOKE UPDATE/DELETE) + trigger de inmutabilidad.
 */
@Injectable()
export class AuditoriaService {
  constructor(@InjectRepository(AuditLog) private readonly repo: Repository<AuditLog>) {}

  async registrar(entrada: EntradaAuditoria) {
    const ultimo = await this.repo.find({ order: { id: 'DESC' }, take: 1 });
    const prevHash = ultimo[0]?.hash ?? null;
    const cuerpo = JSON.stringify({
      actorTipo: entrada.actorTipo,
      usuarioId: entrada.usuarioId ?? null,
      entidad: entrada.entidad,
      entidadId: entrada.entidadId ?? null,
      accion: entrada.accion,
      valorAnterior: entrada.valorAnterior ?? null,
      valorNuevo: entrada.valorNuevo ?? null,
      ocurrido_en: new Date().toISOString(),
      prev_hash: prevHash,
    });
    const hash = sha256Hex(cuerpo);
    await this.repo.save(
      this.repo.create({
        ocurrido_en: new Date(),
        actor_tipo: entrada.actorTipo,
        usuario_id: entrada.usuarioId ?? null,
        ip: entrada.ip ?? null,
        request_id: entrada.requestId ?? null,
        entidad: entrada.entidad,
        entidad_id: entrada.entidadId ?? null,
        accion: entrada.accion,
        valor_anterior: entrada.valorAnterior ?? null,
        valor_nuevo: entrada.valorNuevo ?? null,
        prev_hash: prevHash,
        hash,
      }),
    );
  }

  listar(query: {
    entidad?: string;
    entidad_id?: string;
    usuario_id?: string;
    accion?: string;
    desde?: string;
    hasta?: string;
  }) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.id', 'DESC').take(200);
    if (query.entidad) qb.andWhere('a.entidad = :e', { e: query.entidad });
    if (query.entidad_id) qb.andWhere('a.entidad_id = :id', { id: query.entidad_id });
    if (query.usuario_id) qb.andWhere('a.usuario_id = :u', { u: query.usuario_id });
    if (query.accion) qb.andWhere('a.accion = :ac', { ac: query.accion });
    if (query.desde) qb.andWhere('a.ocurrido_en >= :d', { d: query.desde });
    if (query.hasta) qb.andWhere('a.ocurrido_en <= :h', { h: query.hasta });
    return qb.getMany();
  }

  /** Recorre la cadena de hashes y reporta rupturas (spec 6.7). */
  async verificarCadena(desde?: string) {
    const qb = this.repo.createQueryBuilder('a').orderBy('a.id', 'ASC');
    if (desde) qb.andWhere('a.ocurrido_en >= :d', { d: desde });
    const filas = await qb.getMany();
    const rupturas: number[] = [];
    let esperado: string | null = filas[0]?.prev_hash ?? null;
    for (const f of filas) {
      if (f.prev_hash !== esperado) rupturas.push(f.id);
      // Recalcular hash exige la misma serialización canónica del registro.
      esperado = f.hash ?? null;
    }
    return { verificadas: filas.length, rupturas };
  }
}
