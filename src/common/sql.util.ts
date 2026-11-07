/**
 * Utilidades para SQL crudo portable entre SQLite y Postgres.
 * TypeORM no traduce placeholders: SQLite usa `?`, Postgres `$n`.
 */
export type DriverDb = 'sqlite' | 'postgres' | string;

/** Placeholder para el parámetro i-ésimo (0-based) según el driver. */
export function ph(driver: DriverDb, i: number): string {
  return driver === 'postgres' ? `$${i + 1}` : '?';
}

/** Construye placeholders para una lista de parámetros. */
export function params(driver: DriverDb, n: number): string {
  return Array.from({ length: n }, (_, i) => ph(driver, i)).join(', ');
}

/**
 * Mínimo/máximo binario de dos expresiones SQL.
 *
 * SQLite acepta `MAX(a, b)` con dos argumentos; Postgres sólo tiene `max`
 * agregado (una columna), así que ahí se emite `GREATEST(a, b)`.
 */
export function max2(driver: DriverDb, a: string, b: string): string {
  return driver === 'postgres' ? `GREATEST(${a}, ${b})` : `MAX(${a}, ${b})`;
}

/** Normaliza el resultado de `query()` a filas (ambos drivers difieren). */
export function filas<T = Record<string, unknown>>(driver: DriverDb, res: unknown): T[] {
  if (driver === 'postgres') {
    // pg: [rows, rowCount]
    return Array.isArray(res) && Array.isArray(res[0]) ? (res[0] as T[]) : [];
  }
  // better-sqlite3 vía TypeORM: devuelve el resultado directo o [result]
  if (Array.isArray(res)) {
    if (Array.isArray(res[0])) return res[0] as T[];
    if (res.length && typeof res[0] === 'object' && !Array.isArray(res[0])) return res as T[];
    return [];
  }
  return [];
}

/** Número de filas afectadas por un UPDATE/DELETE. */
export function afectados(driver: DriverDb, res: unknown): number {
  if (driver === 'postgres') {
    return Array.isArray(res) && typeof res[1] === 'number' ? res[1] : 0;
  }
  // better-sqlite3: { changes } o [ { changes } ]
  const r = Array.isArray(res) ? res[0] : res;
  if (r && typeof r === 'object' && 'changes' in (r as object)) {
    return Number((r as { changes: number }).changes);
  }
  if (Array.isArray(res) && typeof res[0] === 'number') return res[0];
  return 0;
}
