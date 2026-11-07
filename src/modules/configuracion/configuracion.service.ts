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
} from '../../database/entities';
import { ApiError } from '../../common/errors';
import { sha256Hex } from '../../common/crypto.util';
import { CONFIG_POR_DEFECTO } from '../../database/seed';

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

  // ── códigos promocionales ─────────────────────────────────────────────

  listarPromos() {
    return this.promos.find({ order: { creado_en: 'DESC' } });
  }
}
