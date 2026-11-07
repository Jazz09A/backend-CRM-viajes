import { ArchivoStorage } from './storage.types';

/**
 * Adaptador S3-compatible para producción.
 *
 * Requiere:
 * - @aws-sdk/client-s3
 * - @aws-sdk/s3-request-presigner
 *
 * TODO: instalar dependencias cuando se use S3:
 * npm install @aws-sdk/client-s3 @aws-sdk/s3-request-presigner
 */
export class S3StorageAdapter implements ArchivoStorage {
  constructor(
    private readonly config: {
      endpoint?: string;
      region?: string;
      bucket?: string;
      accessKeyId?: string;
      secretAccessKey?: string;
      forcePathStyle?: boolean;
    },
  ) {}

  async put(key: string, buffer: Buffer, mimeType: string): Promise<void> {
    // TODO: implementar con S3Client.putObject
    throw new Error('S3StorageAdapter.put: instalar @aws-sdk/client-s3');
  }

  async getBuffer(key: string): Promise<Buffer> {
    // TODO: implementar con S3Client.getObject
    throw new Error('S3StorageAdapter.getBuffer: instalar @aws-sdk/client-s3');
  }

  async signedDownloadUrl(key: string, ttlSeconds = 300): Promise<string> {
    // TODO: implementar con getSignedUrl del presigner
    throw new Error('S3StorageAdapter.signedDownloadUrl: instalar @aws-sdk/s3-request-presigner');
  }

  async head(key: string): Promise<{ size: number } | null> {
    // TODO: implementar con S3Client.headObject
    throw new Error('S3StorageAdapter.head: instalar @aws-sdk/client-s3');
  }

  async delete(key: string): Promise<void> {
    // TODO: implementar con S3Client.deleteObject
    throw new Error('S3StorageAdapter.delete: instalar @aws-sdk/client-s3');
  }
}
