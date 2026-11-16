import { InitialSchema1794026342820 } from './1794026342820-InitialSchema';
import { PuntoSalida1794026342821 } from './1794026342821-PuntoSalida';
import { PuntoSalidaSeleccionable1794026342822 } from './1794026342822-PuntoSalidaSeleccionable';
import { PasajeroDocumentoImagen1794026342823 } from './1794026342823-PasajeroDocumentoImagen';
import { PagoNaceAprobado1794026342824 } from './1794026342824-PagoNaceAprobado';
import { EdadesInfanteGratis1794026342825 } from './1794026342825-EdadesInfanteGratis';

/**
 * Migraciones versionadas (spec: producción usa migraciones, no synchronize).
 * `synchronize` queda sólo para sqlite en desarrollo.
 *
 * Al generar una migración nueva con el CLI, agrégala aquí para que
 * `dist/database/migrate.js` (Dockerfile) la aplique en el arranque.
 */
export const MIGRATIONS = [
  InitialSchema1794026342820,
  PuntoSalida1794026342821,
  PuntoSalidaSeleccionable1794026342822,
  PasajeroDocumentoImagen1794026342823,
  PagoNaceAprobado1794026342824,
  EdadesInfanteGratis1794026342825,
];
