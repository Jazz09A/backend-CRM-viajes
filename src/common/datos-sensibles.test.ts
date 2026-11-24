import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  cifrarONull,
  cifrarTexto,
  descifrarONull,
  descifrarTexto,
  indiceDocumento,
  ultimos4,
} from './datos-sensibles';

/**
 * Datos sensibles: AES-256-GCM con IV aleatorio + HMAC para búsqueda.
 * Los tests usan las claves de desarrollo por defecto.
 */

describe('datos-sensibles — cifrado simétrico', () => {
  it('roundtrip de texto plano, unicode y vacío', () => {
    for (const texto of ['12345678', 'María José Ñúñez', '', 'x'.repeat(5000)]) {
      assert.equal(descifrarTexto(cifrarTexto(texto)), texto);
    }
  });

  it('dos cifrados del mismo texto son distintos (IV aleatorio)', () => {
    assert.notEqual(cifrarTexto('mismo'), cifrarTexto('mismo'));
  });

  it('el formato es iv.tag.cipher en base64', () => {
    const partes = cifrarTexto('hola').split('.');
    assert.equal(partes.length, 3);
    // IV de 12 bytes → 16 chars base64.
    assert.equal(Buffer.from(partes[0], 'base64').length, 12);
    // Tag GCM de 16 bytes.
    assert.equal(Buffer.from(partes[1], 'base64').length, 16);
  });

  it('un ciphertext manipulado NO descifra (GCM autentica)', () => {
    const cifrado = cifrarTexto('secreto');
    const [iv, tag, data] = cifrado.split('.');
    const manipulado = `${iv}.${tag}.${Buffer.from('otro').toString('base64')}`;
    assert.throws(() => descifrarTexto(manipulado));
    // Y la variante tolerante devuelve ''.
    assert.equal(descifrarONull(manipulado), '');
    void data;
  });

  it('formatos incompletos devuelven cadena vacía sin lanzar', () => {
    assert.equal(descifrarTexto(''), '');
    assert.equal(descifrarTexto('solo-una-parte'), '');
    assert.equal(descifrarTexto('a.b'), '');
    // Partes extra se ignoran pero el descifrado falla → ''.
    assert.equal(descifrarONull('a.b.c.d.e'), '');
    assert.equal(descifrarONull(null), '');
    assert.equal(descifrarONull(undefined), '');
    assert.equal(descifrarONull(''), '');
  });

  it('cifrarONull devuelve null para entradas vacías', () => {
    assert.equal(cifrarONull(null), null);
    assert.equal(cifrarONull(undefined), null);
    assert.equal(cifrarONull(''), null);
  });
});

describe('datos-sensibles — índice ciego y últimos 4', () => {
  it('indiceDocumento es estable, case-insensitive y por tipo', () => {
    const a = indiceDocumento('v', '12.345-678');
    assert.equal(a, indiceDocumento('V', '12345678'));
    assert.notEqual(a, indiceDocumento('P', '12345678'));
    assert.match(a, /^[0-9a-f]{64}$/);
  });

  it('ultimos4 prefiere dígitos y cae al texto si no hay', () => {
    assert.equal(ultimos4('V-12345678'), '5678');
    assert.equal(ultimos4('AB-1234'), '1234');
    assert.equal(ultimos4('123'), '123');
    assert.equal(ultimos4('ABCD'), 'ABCD'); // sin dígitos → últimos 4 del texto
    assert.equal(ultimos4('----'), '----');
    assert.equal(ultimos4(''), '');
  });
});
