import { createHmac } from 'crypto';

/**
 * TOTP (RFC 6238, HMAC-SHA1, paso 30 s, 6 dígitos) — implementación mínima
 * sin dependencias externas para verificación de segundo factor.
 */

const ALFABETO_B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Decode(input: string): Buffer {
  const limpio = input.toUpperCase().replace(/=+$/, '').replace(/\s/g, '');
  let bits = 0;
  let valor = 0;
  const out: number[] = [];
  for (const ch of limpio) {
    const idx = ALFABETO_B32.indexOf(ch);
    if (idx === -1) continue;
    valor = (valor << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((valor >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

function hotp(secreto: Buffer, contador: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(contador));
  const hmac = createHmac('sha1', secreto).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const codigo =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);
  return String(codigo % 1_000_000).padStart(6, '0');
}

/** `true` si `codigo` coincide con el TOTP actual (ventana ±1 paso). */
export function verificarTotp(secretoBase32: string, codigo: string, pasoSegundos = 30, ventana = 1): boolean {
  const limpio = codigo.replace(/\s/g, '');
  if (!/^\d{6}$/.test(limpio)) return false;
  const secreto = base32Decode(secretoBase32);
  if (!secreto.length) return false;
  const paso = Math.floor(Date.now() / 1000 / pasoSegundos);
  for (let i = -ventana; i <= ventana; i++) {
    if (hotp(secreto, paso + i) === limpio) return true;
  }
  return false;
}
