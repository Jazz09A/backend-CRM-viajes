import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { indiceCiego, normalizarDocumento } from './crypto.util';

/**
 * Datos sensibles del pasajero (spec 5.1): AES-256-GCM para el valor,
 * HMAC para el índice de búsqueda. Las claves vienen de
 * DATA_ENCRYPTION_KEY / DATA_INDEX_HMAC_KEY; en desarrollo hay defaults
 * marcados como NO usar en producción.
 */

const DEV_ENC_KEY = 'dev-only-encryption-key-32bytes!!';
const DEV_IDX_KEY = 'dev-only-index-key';

function encKey(): Buffer {
  const raw = process.env.DATA_ENCRYPTION_KEY ?? DEV_ENC_KEY;
  return createHash('sha256').update(raw).digest();
}

function idxKey(): string {
  return process.env.DATA_INDEX_HMAC_KEY ?? DEV_IDX_KEY;
}

/** Cifra texto → base64 `iv.tag.cipher`. */
export function cifrarTexto(texto: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', encKey(), iv);
  const cifrado = Buffer.concat([cipher.update(texto, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${tag.toString('base64')}.${cifrado.toString('base64')}`;
}

export function descifrarTexto(datos: string): string {
  const [ivB64, tagB64, cifB64] = datos.split('.');
  if (!ivB64 || !tagB64 || !cifB64) return '';
  const decipher = createDecipheriv('aes-256-gcm', encKey(), Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(cifB64, 'base64')), decipher.final()]).toString('utf8');
}

export function cifrarONull(texto: string | null | undefined): string | null {
  if (!texto) return null;
  try {
    return cifrarTexto(texto);
  } catch {
    return null;
  }
}

export function descifrarONull(datos: string | null | undefined): string {
  if (!datos) return '';
  try {
    return descifrarTexto(datos);
  } catch {
    return '';
  }
}

/** Índice ciego del documento para deduplicar/buscar sin guardar claro. */
export function indiceDocumento(tipo: string, documento: string): string {
  return indiceCiego(idxKey(), normalizarDocumento(tipo.toUpperCase(), documento));
}

export function ultimos4(documento: string): string {
  const limpio = documento.replace(/\D/g, '');
  return limpio.slice(-4) || documento.slice(-4);
}
