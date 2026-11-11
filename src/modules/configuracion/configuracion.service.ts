import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Configuracion,
  TasaCambio,
  MetodoPago,
  PlantillaTerminos,
  PlantillaTerminosVersion,
  PoliticaCancelacion,
  CodigoPromocional,
  PuntoSalida,
  Reserva,
  Pasajero,
} from '../../database/entities';
import { ApiError } from '../../common/errors';
import { sha256Hex } from '../../common/crypto.util';
import { CONFIG_POR_DEFECTO } from '../../database/seed';

export interface PuntoSalidaDto {
  clave?: string;
  nombre?: string;
  hora?: string;
  referencia?: string | null;
  orden?: number;
  activo?: boolean;
}

@Injectable()
export class ConfiguracionService {
  constructor(
    @InjectRepository(Configuracion) private readonly config: Repository<Configuracion>,
    @InjectRepository(TasaCambio) private readonly tasas: Repository<TasaCambio>,
    @InjectRepository(MetodoPago) private readonly metodos: Repository<MetodoPago>,
    @InjectRepository(PlantillaTerminos) private readonly plantillas: Repository<PlantillaTerminos>,
    @InjectRepository(PlantillaTerminosVersion) private readonly versiones: Repository<PlantillaTerminosVersion>,
    @InjectRepository(PoliticaCancelacion) private readonly politicas: Repository<PoliticaCancelacion>,
    @InjectRepository(CodigoPromocional) private readonly promos: Repository<CodigoPromocional>,
    @InjectRepository(PuntoSalida) private readonly puntos: Repository<PuntoSalida>,
    @InjectRepository(Reserva) private readonly reservas: Repository<Reserva>,
    @InjectRepository(Pasajero) private readonly pasajeros: Repository<Pasajero>,
  ) {}

  // ── configuración clave/valor ─────────────────────────────────────────

  async obtener(clave: string) {
    const fila = await this.config.findOne({ where: { clave } });
    if (fila) return fila.valor;
    if (clave in CONFIG_POR_DEFECTO) return CONFIG_POR_DEFECTO[clave];
    throw ApiError.noEncontrado('Clave de configuración');
  }

  async listar() {
    const filas = await this.config.find();
    const mapa = new Map(filas.map((f) => [f.clave, f.valor]));
    for (const [k, v] of Object.entries(CONFIG_POR_DEFECTO)) {
      if (!mapa.has(k)) mapa.set(k, v);
    }
    return Object.fromEntries(mapa);
  }

  async guardar(clave: string, valor: unknown, usuarioId: string) {
    let fila = await this.config.findOne({ where: { clave } });
    if (!fila) fila = this.config.create({ clave, valor, actualizado_en: new Date() });
    fila.valor = valor;
    fila.actualizado_por = usuarioId;
    fila.actualizado_en = new Date();
    return this.config.save(fila);
  }

  // ── tasas de cambio ───────────────────────────────────────────────────

  async tasaVigente() {
    const fila = await this.tasas
      .createQueryBuilder('t')
      .where('t.vigente_desde <= :ahora', { ahora: new Date() })
      .orderBy('t.vigente_desde', 'DESC')
      .getOne();
    return fila ?? null;
  }

  registrarTasa(tasa: number, usuarioId: string, nota?: string) {
    return this.tasas.save(
      this.tasas.create({
        tasa: tasa.toFixed(4),
        vigente_desde: new Date(),
        registrada_por: usuarioId,
        nota: nota ?? null,
      }),
    );
  }

  listarTasas() {
    return this.tasas.find({ order: { vigente_desde: 'DESC' }, take: 100 });
  }

  // ── términos y condiciones ────────────────────────────────────────────

  async publicarTerminos(plantillaId: string, versionId: string, usuarioId: string) {
    const version = await this.versiones.findOne({ where: { id: versionId, plantilla_id: plantillaId } });
    if (!version) throw ApiError.noEncontrado('Versión de términos');
    version.hash_sha256 = sha256Hex(version.contenido);
    version.estado = 'publicada';
    version.publicada_en = new Date();
    version.publicada_por = usuarioId;
    // Archivar la versión publicada anterior del mismo tour/plantilla.
    await this.versiones
      .createQueryBuilder()
      .update()
      .set({ estado: 'archivada' })
      .where('plantilla_id = :pid AND estado = :e AND id != :vid', {
        pid: plantillaId,
        e: 'publicada',
        vid: versionId,
      })
      .execute();
    return this.versiones.save(version);
  }

  // ── métodos de pago ───────────────────────────────────────────────────

  listarMetodos(activosOnly = false) {
    return this.metodos.find({
      where: activosOnly ? { activo: true } : {},
      order: { orden: 'ASC' },
    });
  }

  // ── políticas de cancelación ──────────────────────────────────────────

  listarPoliticas() {
    return this.politicas.find({ order: { creado_en: 'ASC' } });
  }

  // ── puntos de salida (catálogo global) ────────────────────────────────

  listarPuntos(incluirInactivos = true) {
    return this.puntos.find({
      where: incluirInactivos ? {} : { activo: true },
      order: { orden: 'ASC', creado_en: 'ASC' },
    });
  }

  /** Puntos activos, en el orden en que los ve el formulario público. */
  puntosActivos() {
    return this.puntos.find({ where: { activo: true }, order: { orden: 'ASC', creado_en: 'ASC' } });
  }

  async crearPunto(dto: PuntoSalidaDto) {
    const nombre = String(dto.nombre ?? '').trim();
    const hora = String(dto.hora ?? '').trim();
    if (!nombre) throw ApiError.validacion('El punto necesita un nombre');
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
      throw ApiError.validacion('La hora debe tener formato HH:MM, por ejemplo 06:30');
    }

    const clave = this.slugPunto(dto.clave || nombre);
    const duplicada = await this.puntos.findOne({ where: { clave } });
    if (duplicada) throw ApiError.validacion(`Ya existe un punto con la clave «${clave}»`);

    const max = await this.puntos.maximum('orden', {});
    return this.puntos.save(
      this.puntos.create({
        clave,
        nombre,
        hora,
        referencia: dto.referencia?.trim() || null,
        orden: dto.orden ?? (max ?? -1) + 1,
        activo: dto.activo !== false,
      }),
    );
  }

  async actualizarPunto(id: string, dto: PuntoSalidaDto) {
    const punto = await this.puntos.findOne({ where: { id } });
    if (!punto) throw ApiError.noEncontrado('Punto de salida');

    if (dto.nombre !== undefined) {
      const nombre = String(dto.nombre).trim();
      if (!nombre) throw ApiError.validacion('El punto necesita un nombre');
      punto.nombre = nombre;
    }
    if (dto.hora !== undefined) {
      const hora = String(dto.hora).trim();
      if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(hora)) {
        throw ApiError.validacion('La hora debe tener formato HH:MM, por ejemplo 06:30');
      }
      punto.hora = hora;
    }
    if (dto.clave !== undefined) {
      const clave = this.slugPunto(dto.clave);
      if (clave !== punto.clave) {
        if (await this.puntoEnUso(punto.clave)) {
          throw ApiError.validacion('Este punto ya se usó en reservas: su clave no puede cambiar');
        }
        const duplicada = await this.puntos.findOne({ where: { clave } });
        if (duplicada) throw ApiError.validacion(`Ya existe un punto con la clave «${clave}»`);
        punto.clave = clave;
      }
    }
    if (dto.referencia !== undefined) punto.referencia = String(dto.referencia).trim() || null;
    if (dto.orden !== undefined) punto.orden = Number(dto.orden) || 0;
    if (dto.activo !== undefined) punto.activo = Boolean(dto.activo);

    if (punto.activo === false && (await this.puntoEnUso(punto.clave))) {
      throw ApiError.validacion(
        'Este punto ya se usó en reservas: no se puede quitar. Puedes cambiarle el nombre u ocultarlo más tarde.',
      );
    }

    return this.puntos.save(punto);
  }

  /**
   * Eliminar: si el punto nunca se usó se borra; si ya aparece en reservas
   * se desactiva para no romper el historial. Un punto ya inactivo se borra.
   */
  async eliminarPunto(id: string) {
    const punto = await this.puntos.findOne({ where: { id } });
    if (!punto) throw ApiError.noEncontrado('Punto de salida');

    if (punto.activo && (await this.puntoEnUso(punto.clave))) {
      punto.activo = false;
      await this.puntos.save(punto);
      return { ...punto, eliminado: false };
    }
    await this.puntos.delete({ id });
    return { ...punto, activo: false, eliminado: true };
  }

  private slugPunto(texto: string): string {
    const slug = String(texto)
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 40);
    if (!slug) throw ApiError.validacion('El punto necesita un nombre válido');
    return slug;
  }

  /** ¿El valor `clave` aparece en respuestas guardadas de reservas o pasajeros? */
  private async puntoEnUso(clave: string): Promise<boolean> {
    const patron = `%"${clave}"%`;
    const enReservas = await this.reservas
      .createQueryBuilder('r')
      .where('r.respuestas_globales LIKE :v', { v: patron })
      .getCount();
    if (enReservas > 0) return true;
    const enPasajeros = await this.pasajeros
      .createQueryBuilder('p')
      .where('p.respuestas LIKE :v', { v: patron })
      .getCount();
    return enPasajeros > 0;
  }

  // ── códigos promocionales ─────────────────────────────────────────────

  listarPromos() {
    return this.promos.find({ order: { creado_en: 'DESC' } });
  }
}
