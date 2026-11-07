import 'reflect-metadata';
import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { DataSource } from 'typeorm';
import { loadConfig } from '../config/configuration';
import { crearDataSourceOptions } from './data-source';

/**
 * DataSource para el CLI de TypeORM (`migration:generate`, `migration:show`).
 *
 * Carga `.env` manualmente si existe: el CLI no pasa por ConfigModule.
 * Las variables del entorno (Koyeb/CI) tienen prioridad sobre el archivo.
 */
const envPath = resolve(process.cwd(), '.env');
if (existsSync(envPath)) {
  for (const linea of readFileSync(envPath, 'utf8').split('\n')) {
    const m = /^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/.exec(linea);
    if (m && m[1] && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

export default new DataSource(crearDataSourceOptions(loadConfig()));
