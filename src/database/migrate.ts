import 'reflect-metadata';
import { loadConfig } from '../config/configuration';
import { crearDataSource } from './data-source';
import { MIGRATIONS } from './migrations';

/**
 * Aplica las migraciones pendientes y termina.
 *
 * Se ejecuta en el arranque del contenedor (ver Dockerfile) antes del API:
 *   node dist/database/migrate.js && node dist/main.js
 *
 * En sqlite (desarrollo) no hace nada: `synchronize` ya crea el esquema.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  if (config.dbDriver !== 'postgres') {
    console.log('Migraciones omitidas (driver sqlite: synchronize crea el esquema)');
    return;
  }
  const ds = crearDataSource(config);
  await ds.initialize();
  try {
    await ds.runMigrations({ transaction: 'each' });
    console.log('Migraciones aplicadas');
  } finally {
    await ds.destroy();
  }
}

void main();
