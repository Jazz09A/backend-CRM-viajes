import { DataSource, DataSourceOptions } from 'typeorm';
import { AppConfig } from '../config/configuration';
import { TODAS_ENTIDADES } from './entities';
import { MIGRATIONS } from './migrations';

/**
 * Opciones de TypeORM según el driver configurado.
 *
 * - `sqlite`   → desarrollo y pruebas (better-sqlite3, `synchronize` activo).
 * - `postgres` → producción. Misma definición de entidades; al migrar a
 *                Postgres solo cambia `DB_DRIVER` + `DATABASE_URL`.
 *
 * Notas de portabilidad:
 * - JSONB de Postgres se mapea con `simple-json` (texto JSON) para que el
 *   mismo esquema funcione en ambos motores. En Postgres se puede migrar a
 *   `jsonb` con una migración sin tocar el código de aplicación.
 * - `uuid` PKs se generan en la app (UUID v7), nunca por la BD.
 */
export function crearDataSourceOptions(config: AppConfig): DataSourceOptions {
  const comun: Partial<DataSourceOptions> = {
    entities: TODAS_ENTIDADES,
    migrations: MIGRATIONS,
    synchronize: config.dbDriver === 'sqlite', // en prod: migraciones versionadas
    logging: config.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
  };

  if (config.dbDriver === 'sqlite') {
    return {
      ...comun,
      type: 'better-sqlite3',
      database: config.dbSqlitePath,
    } as DataSourceOptions;
  }

  return {
    ...comun,
    type: 'postgres',
    url: config.databaseUrl,
    // Pool para producción (Neon/RDS gestionan sus propias conexiones).
    extra: { max: 10 },
  } as DataSourceOptions;
}

export function crearDataSource(config: AppConfig): DataSource {
  return new DataSource(crearDataSourceOptions(config));
}
