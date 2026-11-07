import { ConfigService } from '@nestjs/config';
import { AppConfig } from '../../../config/configuration';
import { ArchivoStorage } from './storage.types';
import { LocalStorageAdapter } from './local-storage.adapter';
import { S3StorageAdapter } from './s3-storage.adapter';

/**
 * Factory que retorna el adaptador de storage según configuración.
 *
 * - STORAGE_DRIVER=local → LocalStorageAdapter (dev/tests)
 * - STORAGE_DRIVER=s3 → S3StorageAdapter (producción con bucket S3-compatible)
 */
export function createStorageAdapter(config: ConfigService<AppConfig, true>): ArchivoStorage {
  const driver = config.get('storageDriver', { infer: true });

  if (driver === 'local') {
    const localDir = config.get('storageLocalDir', { infer: true });
    const secret = config.get('fileSigningSecret', { infer: true });
    return new LocalStorageAdapter(localDir, secret);
  }

  if (driver === 's3') {
    const s3Config = {
      endpoint: config.get('s3Endpoint', { infer: true }),
      region: config.get('s3Region', { infer: true }),
      bucket: config.get('s3Bucket', { infer: true }),
      accessKeyId: config.get('s3AccessKeyId', { infer: true }),
      secretAccessKey: config.get('s3SecretAccessKey', { infer: true }),
      forcePathStyle: config.get('s3ForcePathStyle', { infer: true }) === 'true',
    };
    return new S3StorageAdapter(s3Config);
  }

  throw new Error(`STORAGE_DRIVER desconocido: ${driver}`);
}
