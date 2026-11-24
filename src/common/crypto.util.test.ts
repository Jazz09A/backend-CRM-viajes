import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  hashPassword,
  hashToken,
  indiceCiego,
  nuevoTokenEnlace,
  normalizarDocumento,
  sha256Hex,
  verificarPassword,
} from './crypto.util';

describe('crypto.util — hashes', () => {
  it('sha256Hex produce el vector conocido de "abc"', () => {
    assert.equal(
      sha256Hex('abc'),
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('hashToken es sha256 del token (sólo se guarda el hash, D-08)', () => {
    assert.equal(hashToken('tok-123'), sha256Hex('tok-123'));
  });

  it('nuevoTokenEnlace genera token base64url cuyo hash coincide', () => {
    const { token, hash } = nuevoTokenEnlace();
    assert.match(token, /^[A-Za-z0-9_-]{43}$/);
    assert.equal(hash, sha256Hex(token));
    // 32 bytes aleatorios: dos llamadas nunca repiten.
    assert.notEqual(nuevoTokenEnlace().token, token);
  });

  it('indiceCiego es determinista y depende de clave y valor', () => {
    const a = indiceCiego('clave', 'V:12345678');
    assert.equal(a, indiceCiego('clave', 'V:12345678'));
    assert.notEqual(a, indiceCiego('otra-clave', 'V:12345678'));
    assert.notEqual(a, indiceCiego('clave', 'V:87654321'));
    assert.match(a, /^[0-9a-f]{64}$/);
  });
});

describe('crypto.util — contraseñas scrypt', () => {
  it('hashPassword + verificarPassword hacen roundtrip', () => {
    const hash = hashPassword('una-clave-larga-123');
    assert.match(hash, /^scrypt\$16384\$/);
    assert.equal(verificarPassword('una-clave-larga-123', hash), true);
    assert.equal(verificarPassword('otra-clave', hash), false);
  });

  it('la normalización NFKC hace equivalentes formas unicode', () => {
    // "café" en NFC vs NFD normalizan igual → mismo hash derivado.
    const nfc = 'café';
    const nfd = 'café';
    assert.notEqual(nfc, nfd); // strings distintos en crudo
    const hash = hashPassword(nfc);
    assert.equal(verificarPassword(nfd, hash), true);
  });

  it('hashes almacenados corruptos devuelven false, no lanzan', () => {
    const hash = hashPassword('secreto');
    assert.equal(verificarPassword('secreto', 'basura'), false);
    assert.equal(verificarPassword('secreto', 'scrypt$$$'), false);
    assert.equal(verificarPassword('secreto', 'argon2$16384$c2FsdA$aGFzaA=='), false);
    assert.equal(verificarPassword('secreto', ''), false);
    // Hash manipulado: mismo largo, contenido distinto → false.
    const partes = hash.split('$');
    partes[3] = Buffer.from('otro-hash-de-64-bytes-padding-padding!!').toString('base64');
    assert.equal(verificarPassword('secreto', partes.join('$')), false);
  });

  it('un N inválido en el hash almacenado propaga el error de scrypt (documentado)', () => {
    // Documentado: no hay try/catch — un hash con N no-potencia-de-2 rompe
    // con RangeError en vez de devolver false.
    assert.throws(() =>
      verificarPassword('x', 'scrypt$3$c2FsdHNhbHRzYWx0$aGFzaGFzaGFzaGFzaA=='),
      RangeError,
    );
    // N=0 sí es válido para scrypt y devuelve false (password incorrecta).
    assert.equal(
      verificarPassword('x', 'scrypt$0$c2FsdHNhbHRzYWx0$aGFzaGFzaGFzaGFzaA=='),
      false,
    );
  });
});

describe('crypto.util — normalizarDocumento', () => {
  it('mayúsculas y quita puntos, guiones y espacios', () => {
    assert.equal(normalizarDocumento('v', '12.345-678'), 'V:12345678');
    assert.equal(normalizarDocumento('P', 'ab cd-123'), 'P:ABCD123');
    assert.equal(normalizarDocumento('otro', 'doc 1'), 'OTRO:DOC1');
  });

  it('dos documentos que sólo difieren en formato producen la misma clave', () => {
    assert.equal(
      normalizarDocumento('V', '12-345.678'),
      normalizarDocumento('v', '12345678'),
    );
  });
});
