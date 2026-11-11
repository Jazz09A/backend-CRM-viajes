import { InitialSchema1794026342820 } from './1794026342820-InitialSchema';
import { PuntoSalida1794026342821 } from './1794026342821-PuntoSalida';

/**
 * Migraciones versionadas (spec: producción usa migraciones, no synchronize).
 * `synchronize` queda sólo para sqlite en desarrollo.
 *
 * Al generar una migración nueva con el CLI, agrégala aquí para que
 * `dist/database/migrate.js` (Dockerfile) la aplique en el arranque.
 */
export const MIGRATIONS = [InitialSchema1794026342820, PuntoSalida1794026342821];
