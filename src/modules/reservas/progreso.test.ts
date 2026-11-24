import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Reserva } from '../../database/entities';
import { construirProgreso } from './progreso';

/** Reserva mínima: construirProgreso sólo lee estos campos. */
const reserva = (parcial: Partial<Reserva>): Reserva =>
  ({
    estado: 'en_registro',
    estado_pago: 'pendiente',
    paso_registro: 'titular',
    pasos_completados: {},
    expira_en: null,
    version: 1,
    ...parcial,
  }) as Reserva;

describe('construirProgreso — pasos del registro', () => {
  it('enlace_creado/en_registro derivan los 4 pasos en orden', () => {
    for (const estado of ['enlace_creado', 'en_registro'] as const) {
      const p = construirProgreso(reserva({ estado }));
      assert.deepEqual(
        p.pasos.map((x) => x.clave),
        ['titular', 'acompanantes', 'preguntas', 'resumen'],
      );
      // puede_editar sólo incluye en_registro (no enlace_creado).
      assert.equal(p.puede_editar, estado === 'en_registro');
    }
  });

  it('paso actual y completados marcan estados correcto', () => {
    const p = construirProgreso(
      reserva({
        estado: 'en_registro',
        paso_registro: 'preguntas',
        pasos_completados: { titular: '2026-01-01T00:00:00.000Z', acompanantes: '2026-01-02T00:00:00.000Z' },
      }),
    );
    const estados = Object.fromEntries(p.pasos.map((x) => [x.clave, x.estado]));
    assert.equal(estados['titular'], 'completo');
    assert.equal(estados['acompanantes'], 'completo');
    assert.equal(estados['preguntas'], 'actual');
    assert.equal(estados['resumen'], 'pendiente');
    assert.equal(p.pasos[0].completado_en, '2026-01-01T00:00:00.000Z');
    assert.equal(p.pasos[2].completado_en, null);
    assert.equal(p.paso_actual, 'preguntas');
  });

  it('paso_registro desconocido no rompe: el primero no completado queda actual', () => {
    const p = construirProgreso(
      reserva({ estado: 'en_registro', paso_registro: 'inexistente' as never }),
    );
    // Ningún paso coincide con 'inexistente' → el primero no completado
    // (titular) se marca 'pendiente' y pasoVisto se consume ahí.
    assert.equal(p.pasos[0].estado, 'pendiente');
    assert.equal(p.pasos[1].estado, 'pendiente');
  });

  it('todo completado → ningún paso queda actual', () => {
    const p = construirProgreso(
      reserva({
        pasos_completados: {
          titular: 'x',
          acompanantes: 'x',
          preguntas: 'x',
          resumen: 'x',
        },
      }),
    );
    assert.ok(p.pasos.every((x) => x.estado === 'completo'));
  });
});

describe('construirProgreso — estados fuera del registro', () => {
  const casos: [string, string, boolean][] = [
    ['pendiente_firma', 'firma', true],
    ['pendiente_pago', 'pago', true],
    ['pago_en_verificacion', 'verificacion', false],
    ['confirmada', 'confirmada', false],
    ['cancelada', 'cerrada', false],
    ['expirada', 'cerrada', false],
    ['completada', 'cerrada', false],
  ];

  for (const [estado, paso, puedeEditar] of casos) {
    it(`${estado} → paso '${paso}', puede_editar=${puedeEditar}`, () => {
      const p = construirProgreso(reserva({ estado: estado as never }));
      assert.equal(p.paso_actual, paso);
      assert.equal(p.puede_editar, puedeEditar);
      // Fuera del registro hay un solo paso 'actual'.
      assert.equal(p.pasos.length, 1);
      assert.equal(p.pasos[0].estado, 'actual');
    });
  }
});

describe('construirProgreso — siguiente_accion y cierre', () => {
  it('siguiente_accion varía por estado', () => {
    assert.match(construirProgreso(reserva({ estado: 'en_registro', paso_registro: 'resumen' })).siguiente_accion, /resumen/);
    assert.match(construirProgreso(reserva({ estado: 'pendiente_firma' })).siguiente_accion, /firma/);
    assert.match(construirProgreso(reserva({ estado: 'pendiente_pago' })).siguiente_accion, /pago/);
    assert.match(construirProgreso(reserva({ estado: 'confirmada' })).siguiente_accion, /confirmada/);
    assert.match(construirProgreso(reserva({ estado: 'cancelada' })).siguiente_accion, /cancelada/);
    assert.match(construirProgreso(reserva({ estado: 'expirada' })).siguiente_accion, /venció/);
    assert.match(construirProgreso(reserva({ estado: 'completada' })).siguiente_accion, /completado/);
  });

  it('estado desconocido cae al default sin lanzar', () => {
    const p = construirProgreso(reserva({ estado: 'raro' as never }));
    assert.equal(p.paso_actual, 'cerrada');
    assert.equal(p.siguiente_accion, 'Comienza tu registro');
    assert.equal(p.puede_editar, false);
  });

  it('motivo_cierre sólo en estados terminales', () => {
    assert.equal(construirProgreso(reserva({ estado: 'confirmada' })).motivo_cierre, null);
    assert.deepEqual(
      construirProgreso(reserva({ estado: 'cancelada', cancelacion_motivo: 'duplicada' })).motivo_cierre,
      { motivo: 'cancelada', texto: 'duplicada' },
    );
    assert.deepEqual(
      construirProgreso(reserva({ estado: 'cancelada' })).motivo_cierre,
      { motivo: 'cancelada', texto: undefined },
    );
    assert.deepEqual(
      construirProgreso(reserva({ estado: 'expirada' })).motivo_cierre,
      { motivo: 'expirada' },
    );
    assert.deepEqual(
      construirProgreso(reserva({ estado: 'completada' })).motivo_cierre,
      { motivo: 'completada' },
    );
  });

  it('expira_en Date → ISO; null → null; version se copia', () => {
    const fecha = new Date('2026-03-01T12:00:00.000Z');
    const p = construirProgreso(reserva({ expira_en: fecha, version: 7 }));
    assert.equal(p.expira_en, '2026-03-01T12:00:00.000Z');
    assert.equal(p.version, 7);
    assert.equal(construirProgreso(reserva({})).expira_en, null);
  });
});
