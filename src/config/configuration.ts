export interface AppConfig {
  port: number;
  corsOrigins: string[];
  dbDriver: 'sqlite' | 'postgres';
  dbSqlitePath: string;
  databaseUrl?: string;
  jwtSecret: string;
  jwtAccessTtl: string;
  jwtRefreshTtlDays: number;
  dataEncryptionKey?: string;
  dataIndexHmacKey?: string;
  nodeEnv: string;
  storageDriver: 'local' | 's3';
  storageLocalDir: string;
  s3Endpoint?: string;
  s3Region?: string;
  s3Bucket?: string;
  s3AccessKeyId?: string;
  s3SecretAccessKey?: string;
  s3ForcePathStyle?: string;
  signedUrlTtlSeconds: number;
  publicAppUrl: string;
  fileSigningSecret: string;
}

export function loadConfig(): AppConfig {
  const dbDriver = (process.env.DB_DRIVER ?? 'sqlite') as AppConfig['dbDriver'];
  if (dbDriver !== 'sqlite' && dbDriver !== 'postgres') {
    throw new Error(`DB_DRIVER inválido: ${dbDriver} (usa sqlite|postgres)`);
  }
  if (dbDriver === 'postgres' && !process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL es obligatorio cuando DB_DRIVER=postgres');
  }
  const storageDriver = (process.env.STORAGE_DRIVER ?? 'local') as AppConfig['storageDriver'];
  if (storageDriver !== 'local' && storageDriver !== 's3') {
    throw new Error(`STORAGE_DRIVER inválido: ${storageDriver} (usa local|s3)`);
  }
  if (storageDriver === 's3' && !process.env.S3_BUCKET) {
    throw new Error('S3_BUCKET es obligatorio cuando STORAGE_DRIVER=s3');
  }
  return {
    port: Number(process.env.PORT ?? 3001),
    corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:8080')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    dbDriver,
    dbSqlitePath: process.env.DB_SQLITE_PATH ?? './data/dev.sqlite',
    databaseUrl: process.env.DATABASE_URL,
    jwtSecret: process.env.JWT_SECRET ?? 'dev-secret-cambiar',
    jwtAccessTtl: process.env.JWT_ACCESS_TTL ?? '15m',
    jwtRefreshTtlDays: Number(process.env.JWT_REFRESH_TTL_DAYS ?? 30),
    dataEncryptionKey: process.env.DATA_ENCRYPTION_KEY,
    dataIndexHmacKey: process.env.DATA_INDEX_HMAC_KEY,
    nodeEnv: process.env.NODE_ENV ?? 'development',
    storageDriver,
    storageLocalDir: process.env.STORAGE_LOCAL_DIR ?? './data/storage',
    s3Endpoint: process.env.S3_ENDPOINT,
    s3Region: process.env.S3_REGION ?? 'us-east-1',
    s3Bucket: process.env.S3_BUCKET,
    s3AccessKeyId: process.env.S3_ACCESS_KEY_ID,
    s3SecretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    s3ForcePathStyle: process.env.S3_FORCE_PATH_STYLE,
    signedUrlTtlSeconds: Number(process.env.SIGNED_URL_TTL_SECONDS ?? 300),
    publicAppUrl: process.env.PUBLIC_APP_URL ?? 'http://localhost:8080',
    fileSigningSecret: process.env.FILE_SIGNING_SECRET ?? 'dev-file-secret-cambiar',
  };
}
