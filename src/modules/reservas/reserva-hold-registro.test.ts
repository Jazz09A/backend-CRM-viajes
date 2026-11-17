import assert from 'node:assert/strict';
import { describe, it, before, after, beforeEach } from 'node:test';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import {
  CupoMovimiento,
  CupoOpcion,
  EnlaceReserva,
  FechaTour,
  OutboxEvento,
  Reserva,
  ReservaEstadoHistorial,
  Tarifa,
  Tour,
  Voucher,
  TODAS_ENTIDADES,
} from '../../database/entities';
import { ReservaStateMachine, type Actor } from '../reservas/reserva-state-machine';
import { CuposService } from '../cupos/cupos.service';
import type { ConfiguracionService } from '../configuracion/configuracion.service';

/**
 * El cupo queda reservado desde que el cliente **inicia el registro**.
 *
 * Hoy (comportamiento a corregir): `iniciar_registro` no retiene cupo — el
 * hold ocurre sólo al confirmar el resumen (`hold_horas` = 24 h). Mientras el
 * cliente llena el formulario, sus cupos quedan libres y otro grupo puede
 * llevárselos. La corrección: retener en `iniciar_registro` con la ventana de
 * inactividad (`minutos_inactividad` = 30 min, refrescada con actividad) y al
 * confirmar la reserva dar el tiempo largo (24 h) sin duplicar el hold.
 */
describe('ReservaStateMachine · cupo reservado tras iniciar el registro', () => {
  let ds: DataSource;
  let sm: ReservaStateMachine;
  const usuarioId = uuidv7();
  const actor: Actor = { tipo: 'cliente', id: null };
  let fechaId = '';
  let tourId = '';

  const repo = <T extends object>(e: new () => T) => ds.getRepository(e);
  let secuencia = 0;

  /** Config mínima con las dos claves que gobiernan los tiempos. */
  const config = {
    obtener: async (clave: string) =>
      ({ minutos_inactividad: 30, hold_horas: 24 })[clave] ?? null,
  } as unknown as ConfiguracionService;

  const MIN = 60_000;

  /** Semilla mínima: tour con una fecha publicada de 10 cupos. */
  const sembrar = async () => {
    const tour = await repo(Tour).save(
      repo(Tour).create({
        clave: 'full-day-prueba',
        nombre: 'Full Day Prueba',
        tipo: 'full_day',
        estado: 'activo',
        incluye: [],
        notas: [],
        itinerario: [],
        cupos: 10,
      }),
    );
    tourId = tour.id;
    const fecha = await repo(FechaTour).save(
      repo(FechaTour).create({
        tour_id: tour.id,
        fecha_salida: '2026-12-20',
        hora_salida: '06:00',
        cupos_total: 10,
        sobrecupo_autorizado: 0,
        cupos_retenidos: 0,
        cupos_vendidos: 0,
        estado: 'publicada',
        corte_venta_horas: 12,
        version: 1,
      }),
    );
    fechaId = fecha.id;
    await repo(Tarifa).save(
      repo(Tarifa).create({
        fecha_tour_id: fecha.id,
        categoria: 'adulto',
        edad_min: 18,
        edad_max: 60,
        precio_usd: '48.00',
      }),
    );
    // Cupo por opción (p. ej. la selección de almuerzo) para el hold.
    await repo(CupoOpcion).save(
      repo(CupoOpcion).create({
        fecha_tour_id: fecha.id,
        campo_id: 'almuerzo',
        valor: 'pollo',
        cupo: 10,
        retenidos: 0,
      }),
    );
    return fecha.id;
  };

  const nuevaReserva = async () => {
    const r = await repo(Reserva).save(
      repo(Reserva).create({
        ref_corta: `R-${++secuencia}`.padStart(10, '0'),
        fecha_tour_id: fechaId,
        estado: 'enlace_creado',
        estado_pago: 'sin_pago',
        cupo_estado: 'ninguno',
        creada_por: usuarioId,
        ultima_actividad_en: new Date(),
      }),
    );
    await repo(EnlaceReserva).save(
      repo(EnlaceReserva).create({
        reserva_id: r.id,
        token_hash: `hash-${r.id}`,
        estado: 'vigente',
        expira_en: new Date(Date.now() + 72 * 3600_000),
        creado_por: usuarioId,
      }),
    );
    return r;
  };

  before(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: TODAS_ENTIDADES,
      synchronize: true,
    });
    await ds.initialize();
    const cupos = new CuposService(ds, repo(FechaTour), repo(CupoOpcion), repo(CupoMovimiento));
    sm = new ReservaStateMachine(
      ds,
      repo(Reserva),
      repo(EnlaceReserva),
      repo(ReservaEstadoHistorial),
      cupos,
      config,
    );
  });

  after(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    for (const t of [Voucher, OutboxEvento, CupoMovimiento, ReservaEstadoHistorial, CupoOpcion, EnlaceReserva, Reserva, Tarifa, FechaTour, Tour]) {
      await ds.getRepository(t).clear();
    }
    await sembrar();
  });

  it('al iniciar el registro el cupo del titular queda retenido en la DB (30 min)', async () => {
    const r = await nuevaReserva();
    const t0 = Date.now();
    await sm.transicionar(r.id, 'iniciar_registro', actor);

    const despues = await repo(Reserva).findOneByOrFail({ id: r.id });
    assert.equal(despues.estado, 'en_registro');
    assert.equal(despues.cupo_estado, 'retenido');
    assert.equal(despues.cupo_pasajeros, 1);
    const minutos = (new Date(despues.expira_en as unknown as string).getTime() - t0) / MIN;
    assert.ok(minutos >= 29 && minutos <= 31, `expira_en a ${minutos} min (esperado ~30)`);

    const fecha = await repo(FechaTour).findOneByOrFail({ id: fechaId });
    assert.equal(fecha.cupos_retenidos, 1);
    const movs = await repo(CupoMovimiento).find({ where: { reserva_id: r.id } });
    assert.equal(movs.length, 1);
    assert.equal(movs[0].cantidad, 1);
  });

  it('al confirmar la reserva se da más tiempo (24 h) sin duplicar el hold', async () => {
    const r = await nuevaReserva();
    await sm.transicionar(r.id, 'iniciar_registro', actor);
    const t0 = Date.now();
    await sm.transicionar(r.id, 'confirmar_resumen', actor, {
      datos: {
        cupo_pasajeros: 4,
        cupo_opciones: [{ campo_id: 'almuerzo', valor: 'pollo', n: 4 }],
      },
    });

    const despues = await repo(Reserva).findOneByOrFail({ id: r.id });
    assert.equal(despues.estado, 'pendiente_firma');
    assert.equal(despues.cupo_pasajeros, 4);
    const horas = (new Date(despues.expira_en as unknown as string).getTime() - t0) / 3_600_000;
    assert.ok(horas >= 23.9 && horas <= 24.1, `expira_en a ${horas} h (esperado ~24)`);

    const fecha = await repo(FechaTour).findOneByOrFail({ id: fechaId });
    assert.equal(fecha.cupos_retenidos, 4, 'el general no se duplica: 1 → 4');
    const opcion = await repo(CupoOpcion).findOneByOrFail({ fecha_tour_id: fechaId });
    assert.equal(opcion.retenidos, 4);
  });

  it('al pagar el cupo pasa a vendido y la expiración desaparece', async () => {
    const r = await nuevaReserva();
    await sm.transicionar(r.id, 'iniciar_registro', actor);
    await sm.transicionar(r.id, 'confirmar_resumen', actor, { datos: { cupo_pasajeros: 2, cupo_opciones: [] } });
    await sm.transicionar(r.id, 'firmar', actor);
    await sm.transicionar(r.id, 'confirmar_pago', actor);

    const fecha = await repo(FechaTour).findOneByOrFail({ id: fechaId });
    assert.equal(fecha.cupos_vendidos, 2);
    assert.equal(fecha.cupos_retenidos, 0);
    const despues = await repo(Reserva).findOneByOrFail({ id: r.id });
    assert.equal(despues.cupo_estado, 'vendido');
    assert.equal(despues.expira_en, null);
  });

  it('si el grupo cambia durante el registro el hold se ajusta (crece y decrece)', async () => {
    const r = await nuevaReserva();
    await sm.transicionar(r.id, 'iniciar_registro', actor);
    await sm.transicionar(r.id, 'confirmar_resumen', actor, { datos: { cupo_pasajeros: 3, cupo_opciones: [] } });
    await sm.transicionar(r.id, 'reabrir_edicion', actor);
    await sm.transicionar(r.id, 'confirmar_resumen', actor, { datos: { cupo_pasajeros: 2, cupo_opciones: [] } });

    const fecha = await repo(FechaTour).findOneByOrFail({ id: fechaId });
    assert.equal(fecha.cupos_retenidos, 2, 'el hold vuelve al tamaño del grupo');
    const despues = await repo(Reserva).findOneByOrFail({ id: r.id });
    assert.equal(despues.cupo_pasajeros, 2);
    // Y reabrir edición vuelve a la ventana corta de inactividad.
    assert.ok(despues.expira_en);
  });

  it('si el registro queda inactivo y vence, el cupo se libera', async () => {
    const r = await nuevaReserva();
    await sm.transicionar(r.id, 'iniciar_registro', actor);
    // Simula el paso del tiempo (el jobs tick expira lo vencido).
    await repo(Reserva).update({ id: r.id }, { expira_en: new Date(Date.now() - MIN) });
    await sm.transicionar(r.id, 'expirar', { tipo: 'sistema' });

    const fecha = await repo(FechaTour).findOneByOrFail({ id: fechaId });
    assert.equal(fecha.cupos_retenidos, 0, 'el cupo vuelve al pool');
    const despues = await repo(Reserva).findOneByOrFail({ id: r.id });
    assert.equal(despues.estado, 'expirada');
    assert.equal(despues.cupo_estado, 'liberado');
  });

  it('cancelar un hold no roba los cupos ya vendidos de la fecha', async () => {
    // Otros grupos ya vendieron 5 asientos en esta fecha.
    await repo(FechaTour).update({ id: fechaId }, { cupos_vendidos: 5 });
    const r = await nuevaReserva();
    await sm.transicionar(r.id, 'iniciar_registro', actor);
    await sm.transicionar(r.id, 'confirmar_resumen', actor, { datos: { cupo_pasajeros: 3, cupo_opciones: [] } });
    await sm.transicionar(r.id, 'cancelar', { tipo: 'sistema' }, { motivo: 'prueba' });

    const fecha = await repo(FechaTour).findOneByOrFail({ id: fechaId });
    assert.equal(fecha.cupos_vendidos, 5, 'las ventas ajenas quedan intactas');
    assert.equal(fecha.cupos_retenidos, 0, 'el hold se libera del contador correcto');
  });

  it('sin cupo disponible el registro sigue (el hold se validará al confirmar)', async () => {
    // Otra reserva acapara los 10 cupos.
    const otra = await nuevaReserva();
    await sm.transicionar(otra.id, 'iniciar_registro', actor);
    await sm.transicionar(otra.id, 'confirmar_resumen', actor, {
      datos: { cupo_pasajeros: 10, cupo_opciones: [] },
    });

    const r = await nuevaReserva();
    await sm.transicionar(r.id, 'iniciar_registro', actor);
    const despues = await repo(Reserva).findOneByOrFail({ id: r.id });
    assert.equal(despues.cupo_estado, 'ninguno', 'no hay cupo: se sigue sin hold');
    // Y confirmar el resumen falla con SIN_CUPO.
    await assert.rejects(
      () => sm.transicionar(r.id, 'confirmar_resumen', actor, { datos: { cupo_pasajeros: 1, cupo_opciones: [] } }),
      (error: { codigo?: string }) => error?.codigo === 'VALIDACION',
    );
  });
});
