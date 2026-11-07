import { promises as fs } from 'fs';
import { createHmac, timingSafeEqual } from 'crypto';
import { dirname, join } from 'path';
import { ArchivoStorage } from './storage.types';

/**
 * Adaptador local para desarrollo y tests.
 *
 * Escribe archivos en `storageLocalDir` (por defecto ./data/storage).
 * Las URLs firmadas son HMAC(`${key}:${exp}`) servidas por
 * `GET /api/v1/archivos/local/*`, que verifica firma y expiración.
 */
export class LocalStorageAdapter implements ArchivoStorage {
  constructor(
    private readonly baseDir: string,
    private readonly signingSecret: string,
    /** Origen público del API; si se omite la URL queda relativa (mismo origen). */
    private readonly publicApiUrl = '',
  ) {}

  async put(key: string, buffer: Buffer, _mimeType: string): Promise<void> {
    const filePath = join(this.baseDir, key);
    await fs.mkdir(dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, buffer);
  }

  async getBuffer(key: string): Promise<Buffer> {
    const filePath = join(this.baseDir, key);
    return fs.readFile(filePath);
  }

  firma(key: string, exp: number): string {
    return createHmac('sha256', this.signingSecret).update(`${key}:${exp}`).digest('hex');
  }

  verificarFirma(key: string, exp: number, sig: string): boolean {
    if (!sig || exp * 1000 < Date.now()) return false;
    const esperada = this.firma(key, exp);
    const a = Buffer.from(sig);
    const b = Buffer.from(esperada);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  async signedDownloadUrl(key: string, ttlSeconds = 300): Promise<string> {
    const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
    const sig = this.firma(key, exp);
    // Absoluta cuando el frontend vive en otro origen (Vercel ↔ API).
    return `${this.publicApiUrl}/api/v1/archivos/local/${key}?exp=${exp}&sig=${sig}`;
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const filePath = join(this.baseDir, key);
      const stats = await fs.stat(filePath);
      return { size: stats.size };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    const filePath = join(this.baseDir, key);
    await fs.unlink(filePath).catch(() => {
      // No error si no existe
    });
  }
}
