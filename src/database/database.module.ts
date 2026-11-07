import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppConfig } from '../config/configuration';
import { crearDataSourceOptions } from './data-source';
import { TODAS_ENTIDADES } from './entities';

/**
 * Capa de persistencia. El driver se elige por `DB_DRIVER`:
 *  - sqlite   → desarrollo/pruebas
 *  - postgres → producción (misma API de entidades, sin cambios de código)
 */
@Global()
@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (cs: ConfigService<AppConfig, true>) =>
        crearDataSourceOptions({
          port: cs.get('port', { infer: true }),
          corsOrigins: cs.get('corsOrigins', { infer: true }),
          dbDriver: cs.get('dbDriver', { infer: true }),
          dbSqlitePath: cs.get('dbSqlitePath', { infer: true }),
          databaseUrl: cs.get('databaseUrl', { infer: true }),
          jwtSecret: cs.get('jwtSecret', { infer: true }),
          jwtAccessTtl: cs.get('jwtAccessTtl', { infer: true }),
          jwtRefreshTtlDays: cs.get('jwtRefreshTtlDays', { infer: true }),
          dataEncryptionKey: cs.get('dataEncryptionKey', { infer: true }),
          dataIndexHmacKey: cs.get('dataIndexHmacKey', { infer: true }),
          nodeEnv: cs.get('nodeEnv', { infer: true }),
          storageDriver: cs.get('storageDriver', { infer: true }),
          storageLocalDir: cs.get('storageLocalDir', { infer: true }),
          s3Endpoint: cs.get('s3Endpoint', { infer: true }),
          s3Region: cs.get('s3Region', { infer: true }),
          s3Bucket: cs.get('s3Bucket', { infer: true }),
          s3AccessKeyId: cs.get('s3AccessKeyId', { infer: true }),
          s3SecretAccessKey: cs.get('s3SecretAccessKey', { infer: true }),
          s3ForcePathStyle: cs.get('s3ForcePathStyle', { infer: true }),
          signedUrlTtlSeconds: cs.get('signedUrlTtlSeconds', { infer: true }),
          publicAppUrl: cs.get('publicAppUrl', { infer: true }),
          publicApiUrl: cs.get('publicApiUrl', { infer: true }),
          cookieSameSite: cs.get('cookieSameSite', { infer: true }),
          fileSigningSecret: cs.get('fileSigningSecret', { infer: true }),
        }),
    }),
    TypeOrmModule.forFeature(TODAS_ENTIDADES as never[]),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
