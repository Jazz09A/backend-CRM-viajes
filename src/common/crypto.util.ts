import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'crypto';

export function sha256Hex(data: string | Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

/** Hash del token de enlace: solo se guarda el SHA-256 (D-08). */
export function hashToken(token: string): string {
  return sha256Hex(token);
}

export function nuevoTokenEnlace(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: hashToken(token) };
}

/** Índice ciego HMAC-SHA256 para documentos (sección 5.1). */
export function indiceCiego(clave: string, valorNormalizado: string): string {
  return createHmac('sha256', clave).update(valorNormalizado).digest('hex');
}

const SCRYPT_N = 16384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const KEYLEN = 64;

/** Password hashing con scrypt (reemplazar por argon2id en producción si se desea). */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize('NFKC'), salt, KEYLEN, {
    N: SCRYPT_N,
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return `scrypt$${SCRYPT_N}$${salt.toString('base64')}$${derived.toString('base64')}`;
}

export function verificarPassword(password: string, almacenado: string): boolean {
  const [alg, nStr, saltB64, hashB64] = almacenado.split('$');
  if (alg !== 'scrypt' || !nStr || !saltB64 || !hashB64) return false;
  const salt = Buffer.from(saltB64, 'base64');
  const esperado = Buffer.from(hashB64, 'base64');
  const derivado = scryptSync(password.normalize('NFKC'), salt, esperado.length, {
    N: Number(nStr),
    r: SCRYPT_R,
    p: SCRYPT_P,
  });
  return timingSafeEqual(derivado, esperado);
}

export function normalizarDocumento(tipo: string, documento: string): string {
  const d = documento.toUpperCase().replace(/[.\-\s]/g, '');
  return `${tipo.toUpperCase()}:${d}`;
}
