import { ValueTransformer } from 'typeorm';

/**
 * Fecha/hora portable: se guarda como texto ISO-8601 UTC en una columna
 * `varchar(30)`. Funciona igual en SQLite y Postgres (que no comparten un
 * tipo timestamp nativo en TypeORM). Las cadenas ISO se ordenan
 * lexicográficamente de forma correcta.
 *
 * En producción con Postgres se puede migrar a `timestamptz` con una
 * migración que haga `::timestamptz` sobre las cadenas ISO.
 */
export const IsoDateTransformer: ValueTransformer = {
  to(value: unknown): string | null {
    if (value == null) return null;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') return new Date(value).toISOString();
    return null;
  },
  from(value: unknown): Date | null {
    if (value == null) return null;
    if (value instanceof Date) return value;
    return new Date(String(value));
  },
};
