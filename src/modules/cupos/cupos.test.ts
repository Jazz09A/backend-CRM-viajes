import assert from 'node:assert/strict';
import { describe, it, before, after } from 'node:test';
import { DataSource } from 'typeorm';
import { CupoMovimiento, CupoOpcion, FechaTour } from '../../database/entities';
import { CuposService } from './cupos.service';

/**
 * Motor de cupos: retención atómica con rollback total si una opción no
 * alcanza, liberación con clamp en 0 y conversión retenidos→vendidos.
 */
describe('CuposService', () => {
  let ds: DataSource;
  let cupos: CuposService;

  const fechaId = 'ft-1';
  const reservaId = 'res-1';

  before(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: [FechaTour, CupoOpcion, CupoMovimiento],
      synchronize: true,
    });
    await ds.initialize();
    cupos = new CuposService(
      ds,
      ds.getRepository(FechaTour),
      ds.getRepository(CupoOpcion),
      ds.getRepository(CupoMovimiento),
    );
  });

  after(async () => {
    await ds.destroy();
  });

  const crearFecha = async (parcial: Partial<FechaTour> = {}) => {
    await ds.getRepository(FechaTour).save({
      id: fechaId,
      tour_id: 't-1',
      fecha_salida: '2026-06-01',
      hora_salida: '06:00',
      cupos_total: 10,
      sobrecupo_autorizado: 0,
      cupos_retenidos: 0,
      cupos_vendidos: 0,
      estado: 'abierta',
      creado_en: new Date(),
      actualizado_en: new Date(),
      ...parcial,
    } as FechaTour);
  };

  const leerFecha = () => ds.getRepository(FechaTour).findOneByOrFail({ id: fechaId });

  it('retener descuenta disponibilidad y registra el movimiento', async () => {
    await crearFecha();
    assert.equal(await cupos.retener(fechaId, reservaId, 4), true);
    const f = await leerFecha();
    assert.equal(f.cupos_retenidos, 4);
    const movs = await ds.getRepository(CupoMovimiento).find();
    assert.equal(movs.length, 1);
    assert.equal(movs[0].tipo, 'hold');
    assert.equal(movs[0].cantidad, 4);
  });

  it('retener sin cupo devuelve false y no toca contadores ni movimientos', async () => {
    await ds.getRepository(CupoMovimiento).clear();
    await crearFecha({ cupos_retenidos: 8, cupos_vendidos: 2 });
    assert.equal(await cupos.retener(fechaId, reservaId, 1), false); // 8+2+1 > 10
    const f = await leerFecha();
    assert.equal(f.cupos_retenidos, 8);
    assert.equal(await ds.getRepository(CupoMovimiento).count(), 0);
  });

  it('el sobrecupo_autorizado amplía la capacidad real', async () => {
    await crearFecha({ cupos_retenidos: 9, cupos_vendidos: 1, sobrecupo_autorizado: 3 });
    // capacidad efectiva = 10 + 3 = 13; ocupados 10 → caben 3.
    assert.equal(await cupos.retener(fechaId, reservaId, 3), true);
    assert.equal(await cupos.retener(fechaId, reservaId, 1), false);
  });

  it('fecha inexistente → retener devuelve false', async () => {
    assert.equal(await cupos.retener('no-existe', reservaId, 1), false);
  });

  it('si una opción no alcanza, TODO revierte (rollback de la transacción)', async () => {
    await ds.getRepository(CupoMovimiento).clear();
    await crearFecha({ cupos_retenidos: 5 });
    await ds.getRepository(CupoOpcion).save({
      fecha_tour_id: fechaId,
      campo_id: 'comida',
      valor: 'veg',
      cupo: 2,
      retenidos: 0,
      vendidos: 0,
      creado_en: new Date(),
    } as CupoOpcion);

    // General sí alcanza (5+4<=10) pero la opción pide 3 > cupo 2 → lanza
    // y el UPDATE general de cupos_retenidos debe revertirse.
    await assert.rejects(
      cupos.retener(fechaId, reservaId, 4, [{ campo_id: 'comida', valor: 'veg', n: 3 }]),
      (e: unknown) => (e as { codigo?: string }).codigo === 'TRANSICION_INVALIDA',
    );
    const f = await leerFecha();
    assert.equal(f.cupos_retenidos, 5); // sin cambio: rollback total
    assert.equal((await ds.getRepository(CupoOpcion).findOneByOrFail({
      fecha_tour_id: fechaId,
      campo_id: 'comida',
      valor: 'veg',
    })).retenidos, 0);
    assert.equal(await ds.getRepository(CupoMovimiento).count(), 0);
  });

  it('opción con cupo suficiente retiene en ambos niveles', async () => {
    await crearFecha();
    await ds.getRepository(CupoOpcion).save({
      fecha_tour_id: fechaId,
      campo_id: 'comida',
      valor: 'veg',
      cupo: 5,
      retenidos: 0,
      vendidos: 0,
      creado_en: new Date(),
    } as CupoOpcion);
    const ok = await cupos.retener(fechaId, reservaId, 2, [
      { campo_id: 'comida', valor: 'veg', n: 2 },
    ]);
    assert.equal(ok, true);
    const op = await ds.getRepository(CupoOpcion).findOneByOrFail({
      fecha_tour_id: fechaId,
      campo_id: 'comida',
      valor: 'veg',
    });
    assert.equal(op.retenidos, 2);
    const f = await leerFecha();
    assert.equal(f.cupos_retenidos, 2);
  });

  it('opción inexistente en cupo_opcion → retener falla (0 filas)', async () => {
    await crearFecha();
    await assert.rejects(
      cupos.retener(fechaId, reservaId, 1, [{ campo_id: 'x', valor: 'y', n: 1 }]),
    );
    assert.equal((await leerFecha()).cupos_retenidos, 0);
  });

  it('liberar decrementa retenidos con clamp en 0 y graba movimiento negativo', async () => {
    await ds.getRepository(CupoMovimiento).clear();
    await crearFecha({ cupos_retenidos: 3 });
    await cupos.liberar(fechaId, reservaId, 2);
    assert.equal((await leerFecha()).cupos_retenidos, 1);
    // Liberar de más → clamp en 0, nunca negativo.
    await cupos.liberar(fechaId, reservaId, 10);
    assert.equal((await leerFecha()).cupos_retenidos, 0);
    const movs = await ds.getRepository(CupoMovimiento).find({ order: { id: 'ASC' } });
    assert.deepEqual(movs.map((m) => m.cantidad), [-2, -10]);
  });

  it('liberar con deVendidos baja cupos_vendidos, no retenidos', async () => {
    await crearFecha({ cupos_retenidos: 4, cupos_vendidos: 6 });
    await cupos.liberar(fechaId, reservaId, 3, [], 'venta_liberada', undefined, true);
    const f = await leerFecha();
    assert.equal(f.cupos_vendidos, 3);
    assert.equal(f.cupos_retenidos, 4); // intacto
  });

  it('liberar opciones toca el contador correcto según deVendidos', async () => {
    await crearFecha();
    await ds.getRepository(CupoOpcion).save({
      fecha_tour_id: fechaId,
      campo_id: 'comida',
      valor: 'veg',
      cupo: 10,
      retenidos: 2,
      vendidos: 4,
      creado_en: new Date(),
    } as CupoOpcion);
    await cupos.liberar(
      fechaId,
      reservaId,
      2,
      [{ campo_id: 'comida', valor: 'veg', n: 2 }],
      'venta_liberada',
      undefined,
      true,
    );
    const op = await ds.getRepository(CupoOpcion).findOneByOrFail({
      fecha_tour_id: fechaId,
      campo_id: 'comida',
      valor: 'veg',
    });
    assert.equal(op.vendidos, 2);
    assert.equal(op.retenidos, 2); // intacto
  });

  it('vender mueve retenidos → vendidos sin pasar por cupo_opcion', async () => {
    await crearFecha({ cupos_retenidos: 5, cupos_vendidos: 2 });
    await cupos.vender(fechaId, 3);
    const f = await leerFecha();
    assert.equal(f.cupos_retenidos, 2);
    assert.equal(f.cupos_vendidos, 5);
    // Quirk documentado: vender NO valida contra lo retenido — sumar 10
    // cuando sólo quedaban 2 retenidos deja vendidos en 15 (inflado).
    await cupos.vender(fechaId, 10);
    const f2 = await leerFecha();
    assert.equal(f2.cupos_retenidos, 0);
    assert.equal(f2.cupos_vendidos, 15);
  });

  it('disponibilidad: restante, clamp en 0 y error si no existe', async () => {
    await crearFecha({ cupos_total: 10, sobrecupo_autorizado: 2, cupos_retenidos: 4, cupos_vendidos: 3 });
    const d = await cupos.disponibilidad(fechaId);
    assert.equal(d.cupos_total, 10);
    assert.equal(d.sobrecupo_autorizado, 2);
    assert.equal(d.disponible, 5); // 12 - 4 - 3

    await ds.getRepository(FechaTour).update(fechaId, { cupos_retenidos: 20 });
    assert.equal((await cupos.disponibilidad(fechaId)).disponible, 0); // nunca negativo

    await assert.rejects(cupos.disponibilidad('no-existe'), (e: unknown) => {
      const err = e as { codigo?: string };
      return err.codigo === 'NO_ENCONTRADO';
    });
  });
});
