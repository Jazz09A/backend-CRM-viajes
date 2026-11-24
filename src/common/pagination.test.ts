import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  codificarCursor,
  decodificarCursor,
  LIMITE_DEFECTO,
  LIMITE_MAXIMO,
  parsearPaginacion,
} from './pagination';

describe('pagination — parsearPaginacion', () => {
  it('sin parámetros usa el límite por defecto y sin cursor', () => {
    assert.deepEqual(parsearPaginacion({}), { limite: LIMITE_DEFECTO, cursor: undefined });
  });

  it('respeta un límite válido dentro del rango', () => {
    assert.equal(parsearPaginacion({ limite: '25' }).limite, 25);
    assert.equal(parsearPaginacion({ limite: '1' }).limite, 1);
    assert.equal(parsearPaginacion({ limite: '200' }).limite, LIMITE_MAXIMO);
  });

  it('limita valores por encima del máximo', () => {
    assert.equal(parsearPaginacion({ limite: '9999' }).limite, LIMITE_MAXIMO);
    assert.equal(parsearPaginacion({ limite: '201' }).limite, 200);
  });

  it('un límite negativo o cero cae al mínimo/default (documentado)', () => {
    // "0" → Number 0 → falsy → LIMITE_DEFECTO (no 0).
    assert.equal(parsearPaginacion({ limite: '0' }).limite, LIMITE_DEFECTO);
    assert.equal(parsearPaginacion({ limite: '' }).limite, LIMITE_DEFECTO);
    // Negativo → Math.max(...,1) → 1.
    assert.equal(parsearPaginacion({ limite: '-5' }).limite, 1);
    // Basura → NaN || default → 50.
    assert.equal(parsearPaginacion({ limite: 'abc' }).limite, LIMITE_DEFECTO);
  });

  it('un límite fraccionario NO se redondea (documentado)', () => {
    // Math.min/max no enteros: "10.5" pasa tal cual → limite 10.5.
    assert.equal(parsearPaginacion({ limite: '10.5' }).limite, 10.5);
  });

  it('el cursor vacío se descarta; el "0" se conserva', () => {
    assert.equal(parsearPaginacion({ cursor: '' }).cursor, undefined);
    assert.equal(parsearPaginacion({ cursor: '0' }).cursor, '0');
    assert.equal(parsearPaginacion({ cursor: 'abc' }).cursor, 'abc');
  });
});

describe('pagination — cursor opaco', () => {
  it('codificar/decodificar hace roundtrip de objetos', () => {
    const payload = { creado_en: '2026-01-01', id: 'r1', n: 42 };
    const cursor = codificarCursor(payload);
    assert.match(cursor, /^[A-Za-z0-9_-]+$/); // base64url
    assert.deepEqual(decodificarCursor(cursor), payload);
  });

  it('decodificarCursor devuelve undefined para entradas inválidas', () => {
    assert.equal(decodificarCursor(undefined), undefined);
    assert.equal(decodificarCursor(''), undefined);
    assert.equal(decodificarCursor('!!!no-base64!!!'), undefined);
    // Base64 válido pero contenido no-JSON.
    assert.equal(decodificarCursor(Buffer.from('no json').toString('base64url')), undefined);
  });

  it('un cursor que decodifica a no-objeto se devuelve igual (sin validación)', () => {
    // Documentado: no hay chequeo de forma — "123" decodifica a number.
    const cursor = Buffer.from('123').toString('base64url');
    assert.equal(decodificarCursor(cursor), 123);
  });
});
