import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { createHash } from 'crypto';
import { AppConfig } from '../../config/configuration';
import { Archivo } from '../../database/entities';
import { createStorageAdapter } from './storage/storage.factory';
import { ArchivoStorage } from './storage/storage.types';
import { LocalStorageAdapter } from './storage/local-storage.adapter';

@Injectable()
export class ArchivosService {
  private readonly storage: ArchivoStorage;
  private readonly signedUrlTtl: number;

  constructor(
    @InjectRepository(Archivo) private readonly archivos: Repository<Archivo>,
    private readonly config: ConfigService<AppConfig, true>,
  ) {
    this.storage = createStorageAdapter(config);
    this.signedUrlTtl = config.get('signedUrlTtlSeconds', { infer: true });
  }

  /**
   * Sube un archivo, crea el registro Archivo y devuelve el ID.
   */
  async subir(
    buffer: Buffer,
    nombreOriginal: string,
    mimeType: string,
    proposito: Archivo['proposito'],
    subidoPor?: string,
    reservaId?: string,
  ): Promise<string> {
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const bucketKey = `${proposito}/${sha256.slice(0, 8)}-${nombreOriginal}`;

    await this.storage.put(bucketKey, buffer, mimeType);

    const archivo = this.archivos.create({
      bucket_key: bucketKey,
      mime_real: mimeType,
      tamano_bytes: buffer.length,
      sha256,
      proposito,
      estado: 'limpio',
      subido_por: subidoPor,
      reserva_id: reservaId,
    });

    const guardado = await this.archivos.save(archivo);
    return guardado.id;
  }

  /**
   * Genera una URL firmada temporal para descarga.
   */
  async obtenerUrlFirmada(archivoId: string): Promise<string> {
    const archivo = await this.archivos.findOne({ where: { id: archivoId } });
    if (!archivo) throw new Error('Archivo no encontrado');
    return this.storage.signedDownloadUrl(archivo.bucket_key, this.signedUrlTtl);
  }

  /**
   * Sirve un archivo local verificando la firma HMAC de la URL.
   * Devuelve null si el driver no es local o la firma no es válida.
   */
  async descargarLocal(
    key: string,
    exp: number,
    sig: string,
  ): Promise<{ buffer: Buffer; mime: string } | null> {
    if (!(this.storage instanceof LocalStorageAdapter)) return null;
    if (!this.storage.verificarFirma(key, exp, sig)) return null;
    const archivo = await this.archivos.findOne({ where: { bucket_key: key } });
    const buffer = await this.storage.getBuffer(key);
    return { buffer, mime: archivo?.mime_real ?? 'application/octet-stream' };
  }

  /**
   * Lee el contenido binario de un archivo (uso interno del servidor).
   */
  async obtenerBuffer(archivoId: string): Promise<{ buffer: Buffer; mime: string }> {
    const archivo = await this.archivos.findOne({ where: { id: archivoId } });
    if (!archivo) throw new Error('Archivo no encontrado');
    const buffer = await this.storage.getBuffer(archivo.bucket_key);
    return { buffer, mime: archivo.mime_real ?? 'application/octet-stream' };
  }

  /**
   * Elimina el archivo del storage y marca el registro como eliminado (o borra).
   */
  async eliminar(archivoId: string): Promise<void> {
    const archivo = await this.archivos.findOne({ where: { id: archivoId } });
    if (!archivo) return;
    await this.storage.delete(archivo.bucket_key);
    await this.archivos.remove(archivo);
  }
}
