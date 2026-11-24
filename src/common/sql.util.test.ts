import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { afectados, filas, max2, params, ph } from './sql.util';

describe('sql.util — placeholders', () => {
  it('sqlite usa ? y postgres usa $n', () => {
    assert.equal(ph('sqlite', 0), '?');
    assert.equal(ph('sqlite', 5), '?');
    assert.equal(ph('postgres', 0), '$1');
    assert.equal(ph('postgres', 4), '$5');
    // Driver desconocido cae a sqlite (documentado).
    assert.equal(ph('mysql', 0), '?');
  });

  it('params construye la lista para n parámetros', () => {
    assert.equal(params('sqlite', 3), '?, ?, ?');
    assert.equal(params('postgres', 3), '$1, $2, $3');
    assert.equal(params('sqlite', 0), '');
    assert.equal(params('postgres', 1), '$1');
  });
});

describe('sql.util — max2', () => {
  it('postgres usa GREATEST, sqlite usa MAX', () => {
    assert.equal(max2('postgres', 'a.cupo', 'b.cupo'), 'GREATEST(a.cupo, b.cupo)');
    assert.equal(max2('sqlite', 'a.cupo', 'b.cupo'), 'MAX(a.cupo, b.cupo)');
  });
});

describe('sql.util — filas', () => {
  it('postgres: filas directas, tupla [rows, count] y vacío', () => {
    assert.deepEqual(filas('postgres', [{ a: 1 }, { a: 2 }]), [{ a: 1 }, { a: 2 }]);
    assert.deepEqual(filas('postgres', [[{ a: 1 }], 1]), [{ a: 1 }]);
    assert.deepEqual(filas('postgres', []), []);
    assert.deepEqual(filas('postgres', 'basura'), []);
  });

  it('sqlite: envuelto en array o [result]', () => {
    assert.deepEqual(filas('sqlite', [[{ a: 1 }]]), [{ a: 1 }]);
    assert.deepEqual(filas('sqlite', [{ a: 1 }]), [{ a: 1 }]);
    assert.deepEqual(filas('sqlite', [1, 2, 3]), []); // primitivos no son filas
    assert.deepEqual(filas('sqlite', { changes: 1 }), []);
    // Quirk documentado: [{changes:1}] se toma como una fila-objeto.
    assert.deepEqual(filas('sqlite', [{ changes: 1 }]), [{ changes: 1 }]);
  });
});

describe('sql.util — afectados', () => {
  it('postgres lee el rowCount de la tupla', () => {
    assert.equal(afectados('postgres', [[{ id: 1 }], 3]), 3);
    assert.equal(afectados('postgres', [[{ id: 1 }]]), 0);
    assert.equal(afectados('postgres', 'basura'), 0);
  });

  it('sqlite lee {changes} directo o envuelto', () => {
    assert.equal(afectados('sqlite', { changes: 3 }), 3);
    assert.equal(afectados('sqlite', [{ changes: 2 }]), 2);
    assert.equal(afectados('sqlite', [{ changes: '4' }]), 4); // Number() coercion
    assert.equal(afectados('sqlite', 7), 0);
    // Caso borde: [5] numérico suelto se acepta como count (documentado).
    assert.equal(afectados('sqlite', [5]), 5);
    assert.equal(afectados('sqlite', []), 0);
  });
});
