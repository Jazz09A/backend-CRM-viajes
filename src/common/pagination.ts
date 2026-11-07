/** Utilidades de paginación por cursor y filtros (spec 3). */
export interface Pagina<T> {
  datos: T[];
  siguiente_cursor: string | null;
}

export interface OpcionesPaginacion {
  limite?: number;
  cursor?: string;
}

export const LIMITE_MAXIMO = 200;
export const LIMITE_DEFECTO = 50;

export function parsearPaginacion(query: { limite?: string; cursor?: string }): {
  limite: number;
  cursor?: string;
} {
  const limite = Math.min(
    Math.max(Number(query.limite ?? LIMITE_DEFECTO) || LIMITE_DEFECTO, 1),
    LIMITE_MAXIMO,
  );
  return { limite, cursor: query.cursor || undefined };
}

/** Codifica/decodifica cursor opaco (base64url de JSON). */
export function codificarCursor(payload: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodificarCursor<T = Record<string, unknown>>(cursor?: string): T | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    return undefined;
  }
}
