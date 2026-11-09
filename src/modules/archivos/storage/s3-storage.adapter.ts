import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ArchivoStorage } from './storage.types';

/** Configuración mínima del adaptador S3-compatible. */
export interface ConfigS3 {
  endpoint?: string | undefined;
  region?: string | undefined;
  bucket?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  forcePathStyle?: boolean | undefined;
}

/**
 * Adaptador S3-compatible para producción (AWS S3, Cloudflare R2,
 * Backblaze B2, MinIO…).
 *
 * - `S3_ENDPOINT` + `S3_FORCE_PATH_STYLE=true` para proveedores que no usan
 *   virtual-host style (R2, MinIO, B2).
 * - Las descargas van por URL presignada: el navegador habla directo con el
 *   bucket y el archivo no pasa por el API.
 * - El cliente se inyecta en los tests (`cliente?: S3Client`).
 */
export class S3StorageAdapter implements ArchivoStorage {
  private readonly cliente: S3Client;
  private readonly bucket: string;

  constructor(config: ConfigS3, cliente?: S3Client) {
    if (!config.bucket) throw new Error('S3StorageAdapter: falta S3_BUCKET');
    this.bucket = config.bucket;
    this.cliente =
      cliente ??
      new S3Client({
        region: config.region || 'us-east-1',
        ...(config.endpoint ? { endpoint: config.endpoint } : {}),
        forcePathStyle: config.forcePathStyle ?? false,
        ...(config.accessKeyId && config.secretAccessKey
          ? {
              credentials: {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              },
            }
          : {}),
      });
  }

  async put(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    await this.cliente.send(
      new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buffer, ContentType: mimeType }),
    );
  }

  async getBuffer(key: string): Promise<Buffer> {
    const res = await this.cliente.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
    if (!res.Body) throw new Error(`S3: respuesta sin cuerpo para ${key}`);
    return Buffer.from(await res.Body.transformToByteArray());
  }

  async signedDownloadUrl(key: string, ttlSeconds = 300): Promise<string> {
    return getSignedUrl(this.cliente, new GetObjectCommand({ Bucket: this.bucket, Key: key }), {
      expiresIn: ttlSeconds,
    });
  }

  async head(key: string): Promise<{ size: number } | null> {
    try {
      const res = await this.cliente.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: res.ContentLength ?? 0 };
    } catch {
      return null;
    }
  }

  async delete(key: string): Promise<void> {
    await this.cliente.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
