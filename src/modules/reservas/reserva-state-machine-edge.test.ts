import assert from 'node:assert/strict';
import { describe, it, before, after, beforeEach } from 'node:test';
import { DataSource } from 'typeorm';
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
import { ReservaStateMachine, type Actor } from './reserva-state-machine';
import { CuposService } from '../cupos/cupos.service';
import { hashToken } from '../../common/crypto.util';
import type { ConfiguracionService } from '../configuracion/configuracion.service';

/**
 * Edge cases de la máquina de estados: transiciones prohibidas, eventos
 * desconocidos, resolución de enlaces (revocado/vencido/inexistente) y
 * ajustes de hold. El ciclo feliz del hold ya lo cubre
 * reserva-hold-registro.test.ts.
 */
describe('ReservaStateMachine · edge cases', () => {
  let ds: DataSource;
  let sm: ReservaStateMachine;
  let fechaId = '';
  let secuencia = 0;
  const actor: Actor = { tipo: 'cliente', id: null };

  const repo = <T extends object>(e: new () => T) => ds.getRepository(e);

  const config = {
    obtener: async (clave: string) =>
      ({
        minutos_inactividad: 30,
        hold_horas: 24,
        enlace_vigencia_h: 72,
        whatsapp_agencia: '+584121234567',
      })[clave] ?? null,
  } as unknown as ConfiguracionService;

  const sembrar = async () => {
    const tour = await repo(Tour).save(
      repo(Tour).create({
        clave: 'edge-tour',
        nombre: 'Edge',
        tipo: 'full_day',
        estado: 'activo',
        incluye: [],
        notas: [],
        itinerario: [],
        cupos: 2, // sólo 2 cupos: fácil de llenar
      }),
    );
    const fecha = await repo(FechaTour).save(
      repo(FechaTour).create({
        tour_id: tour.id,
        fecha_salida: '2026-12-20',
        hora_salida: '06:00',
        cupos_total: 2,
        cupos_retenidos: 0,
        cupos_vendidos: 0,
        estado: 'publicada',
        corte_venta_horas: 12,
        version: 1,
      }),
    );
    fechaId = fecha.id;
  };

  const nuevaReserva = async (estado: Reserva['estado'] = 'enlace_creado') => {
    return repo(Reserva).save(
      repo(Reserva).create({
        ref_corta: `E-${String(++secuencia).padStart(8, '0')}`,
        fecha_tour_id: fechaId,
        estado,
        estado_pago: 'sin_pago',
        cupo_estado: 'ninguno',
        creada_por: '00000000-0000-7000-8000-000000000001',
        ultima_actividad_en: new Date(),
      }),
    );
  };

  const enlace = async (reservaId: string, token: string, parcial: Partial<EnlaceReserva> = {}) => {
    return repo(EnlaceReserva).save(
      repo(EnlaceReserva).create({
        reserva_id: reservaId,
        token_hash: hashToken(token),
        estado: 'vigente',
        expira_en: new Date(Date.now() + 72 * 3600_000),
        creado_por: '00000000-0000-7000-8000-000000000001',
        ...parcial,
      } as EnlaceReserva),
    );
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
    sm = new ReservaStateMachine(ds, repo(Reserva), repo(EnlaceReserva), repo(ReservaEstadoHistorial), cupos, config);
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

  describe('transicionar — rechazos', () => {
    it('evento desconocido → TRANSICION_INVALIDA sin tocar la reserva', async () => {
      const r = await nuevaReserva();
      await assert.rejects(
        sm.transicionar(r.id, 'inventado' as never, actor),
        (e: unknown) => (e as { codigo?: string }).codigo === 'TRANSICION_INVALIDA',
      );
      assert.equal((await repo(Reserva).findOneByOrFail({ id: r.id })).estado, 'enlace_creado');
    });

    it('reserva inexistente → NO_ENCONTRADO', async () => {
      await assert.rejects(
        sm.transicionar('no-existe', 'iniciar_registro', actor),
        (e: unknown) => (e as { codigo?: string }).codigo === 'NO_ENCONTRADO',
      );
    });

    it('transición prohibida por estado → TRANSICION_INVALIDA con el estado en el mensaje', async () => {
      const r = await nuevaReserva('enlace_creado');
      await assert.rejects(
        sm.transicionar(r.id, 'firmar', actor),
        (e: unknown) => {
          const err = e as { codigo?: string; getResponse?: () => Record<string, unknown> };
          const cuerpo = err.getResponse?.() ?? {};
          return err.codigo === 'TRANSICION_INVALIDA' && String(cuerpo['mensaje']).includes('enlace_creado');
        },
      );
    });

    it('completar desde pendiente_firma → inválido (sólo desde confirmada)', async () => {
      const r = await nuevaReserva('pendiente_firma');
      await assert.rejects(sm.transicionar(r.id, 'completar', actor), (e: unknown) => {
        return (e as { codigo?: string }).codigo === 'TRANSICION_INVALIDA';
      });
    });

    it('confirmar_resumen sin cupo disponible → VALIDACION SIN_CUPO', async () => {
      // Llenar los 2 cupos con otra reserva.
      const otra = await nuevaReserva();
      await sm.transicionar(otra.id, 'iniciar_registro', actor); // retiene 1
      await repo(FechaTour).update(fechaId, { cupos_retenidos: 2 }); // simular lleno

      const r = await nuevaReserva('en_registro');
      await assert.rejects(sm.transicionar(r.id, 'confirmar_resumen', actor, { datos: { cupo_pasajeros: 1 } }), (e: unknown) => {
        const err = e as { codigo?: string; detalles?: { codigo: string }[] };
        return err.codigo === 'VALIDACION' && err.detalles?.[0]?.codigo === 'SIN_CUPO';
      });
    });
  });

  describe('transicionar — efectos e historial', () => {
    it('version incrementa y el historial guarda desde/hasta/evento/actor/motivo', async () => {
      const r = await nuevaReserva();
      const v0 = r.version;
      await sm.transicionar(r.id, 'iniciar_registro', { tipo: 'usuario', id: 'u-1' }, { motivo: 'alta', requestId: 'req-1' });
      const despues = await repo(Reserva).findOneByOrFail({ id: r.id });
      assert.equal(despues.version, v0 + 1);
      assert.equal(despues.estado, 'en_registro');
      assert.equal(despues.paso_registro, 'titular');

      const hist = await repo(ReservaEstadoHistorial).findOneByOrFail({ reserva_id: r.id });
      assert.equal(hist.desde, 'enlace_creado');
      assert.equal(hist.hasta, 'en_registro');
      assert.equal(hist.evento, 'iniciar_registro');
      assert.equal(hist.actor_tipo, 'usuario');
      assert.equal(hist.actor_id, 'u-1');
      assert.equal(hist.motivo, 'alta');
      assert.equal(hist.request_id, 'req-1');
    });

    it('guardar_paso refresca ultima_actividad y expira_en', async () => {
      const r = await nuevaReserva();
      await sm.transicionar(r.id, 'iniciar_registro', actor);
      const antes = await repo(Reserva).findOneByOrFail({ id: r.id });
      // Envejecer la actividad.
      await repo(Reserva).update(r.id, { ultima_actividad_en: new Date(Date.now() - 3600_000) });

      await sm.transicionar(r.id, 'guardar_paso', actor);
      const despues = await repo(Reserva).findOneByOrFail({ id: r.id });
      assert.ok(despues.ultima_actividad_en.getTime() > antes.ultima_actividad_en.getTime() - 60_000);
      // expira_en ≈ ahora + 30 min (minutos_inactividad).
      const restante = despues.expira_en!.getTime() - Date.now();
      assert.ok(restante > 25 * 60_000 && restante <= 30 * 60_000, `restante=${restante}`);
      // guardar_paso no cambia el estado ni version de negocio (es misma estado, pero version sube).
      assert.equal(despues.estado, 'en_registro');
    });

    it('cancelar revoca enlaces vigentes/usados y libera el cupo retenido', async () => {
      const r = await nuevaReserva();
      await sm.transicionar(r.id, 'iniciar_registro', actor);
      await enlace(r.id, 'tok-1');
      await enlace(r.id, 'tok-2', { estado: 'usado' as never });
      await enlace(r.id, 'tok-3', { estado: 'revocado' as never }); // ya revocado: no se toca

      await sm.transicionar(r.id, 'cancelar', actor, { motivo: 'cliente pidió', datos: { origen: 'cliente' } });

      const estados = await repo(EnlaceReserva).find({ where: { reserva_id: r.id } });
      const porToken = Object.fromEntries(
        estados.map((e) => [e.estado, e.estado === 'revocado' ? 'revocado' : e.estado]),
      );
      assert.equal((await repo(EnlaceReserva).find({ where: { reserva_id: r.id, estado: 'vigente' } })).length, 0);
      assert.equal((await repo(EnlaceReserva).find({ where: { reserva_id: r.id, estado: 'usado' } })).length, 0);
      assert.equal(porToken['revocado'], 'revocado');
      void estados;

      const reserva = await repo(Reserva).findOneByOrFail({ id: r.id });
      assert.equal(reserva.estado, 'cancelada');
      assert.equal(reserva.cancelacion_origen, 'cliente');
      assert.equal(reserva.cupo_estado, 'liberado');
      assert.equal((await repo(FechaTour).findOneByOrFail({ id: fechaId })).cupos_retenidos, 0);
    });

    it('expirar desde pendiente_firma libera hold y revoca enlaces', async () => {
      const r = await nuevaReserva('pendiente_firma');
      await repo(Reserva).update(r.id, { cupo_estado: 'retenido', cupo_pasajeros: 1 });
      await repo(FechaTour).update(fechaId, { cupos_retenidos: 1 });
      await enlace(r.id, 'tok-x');

      await sm.transicionar(r.id, 'expirar', actor);
      assert.equal((await repo(Reserva).findOneByOrFail({ id: r.id })).estado, 'expirada');
      assert.equal((await repo(EnlaceReserva).findOneByOrFail({ reserva_id: r.id })).estado, 'revocado');
      assert.equal((await repo(FechaTour).findOneByOrFail({ id: fechaId })).cupos_retenidos, 0);
    });

    it('reactivar desde expirada vuelve a enlace_creado y limpia cupo_estado', async () => {
      const r = await nuevaReserva('expirada');
      await repo(Reserva).update(r.id, { cupo_estado: 'retenido', expira_en: new Date() });
      await sm.transicionar(r.id, 'reactivar', actor);
      const despues = await repo(Reserva).findOneByOrFail({ id: r.id });
      assert.equal(despues.estado, 'enlace_creado');
      assert.equal(despues.cupo_estado, 'ninguno');
      assert.equal(despues.expira_en, null);
    });

    it('reactivar desde otro estado → inválido', async () => {
      const r = await nuevaReserva('confirmada');
      await assert.rejects(sm.transicionar(r.id, 'reactivar', actor), (e: unknown) => {
        return (e as { codigo?: string }).codigo === 'TRANSICION_INVALIDA';
      });
    });

    it('confirmar_resumen con grupo menor que el hold libera la diferencia', async () => {
      const r = await nuevaReserva();
      await sm.transicionar(r.id, 'iniciar_registro', actor); // hold 1
      // Simular que el hold creció a 2 manualmente.
      await repo(Reserva).update(r.id, { cupo_pasajeros: 2, cupo_estado: 'retenido' });
      await repo(FechaTour).update(fechaId, { cupos_retenidos: 2 });

      await sm.transicionar(r.id, 'confirmar_resumen', actor, { datos: { cupo_pasajeros: 1, cupo_opciones: [] } });
      const despues = await repo(Reserva).findOneByOrFail({ id: r.id });
      assert.equal(despues.estado, 'pendiente_firma');
      assert.equal(despues.cupo_pasajeros, 1);
      assert.equal((await repo(FechaTour).findOneByOrFail({ id: fechaId })).cupos_retenidos, 1);
      // expira_en pasa a hold_horas (24 h).
      const restante = despues.expira_en!.getTime() - Date.now();
      assert.ok(restante > 23 * 3600_000 && restante <= 24 * 3600_000);
    });

    it('confirmar_resumen emite outbox reserva.resumen_confirmado', async () => {
      const r = await nuevaReserva();
      await sm.transicionar(r.id, 'iniciar_registro', actor);
      await sm.transicionar(r.id, 'confirmar_resumen', actor, { datos: { cupo_pasajeros: 1, cupo_opciones: [] } });
      const eventos = await repo(OutboxEvento).find();
      assert.ok(eventos.some((e) => e.tipo === 'reserva.resumen_confirmado'));
    });
  });

  describe('resolverPorToken', () => {
    it('token inexistente → ENLACE_INVALIDO', async () => {
      await assert.rejects(sm.resolverPorToken('no-existe'), (e: unknown) => {
        return (e as { codigo?: string }).codigo === 'ENLACE_INVALIDO';
      });
    });

    it('enlace revocado → ENLACE_INVALIDO aunque no haya vencido', async () => {
      const r = await nuevaReserva();
      await enlace(r.id, 'tok-rev', { estado: 'revocado' as never });
      await assert.rejects(sm.resolverPorToken('tok-rev'), (e: unknown) => {
        return (e as { codigo?: string }).codigo === 'ENLACE_INVALIDO';
      });
    });

    it('enlace vencido marca estado vencido y lanza ENLACE_VENCIDO con whatsapp', async () => {
      const r = await nuevaReserva();
      await enlace(r.id, 'tok-venc', { expira_en: new Date(Date.now() - 1000) });
      await assert.rejects(sm.resolverPorToken('tok-venc'), (e: unknown) => {
        const err = e as { codigo?: string; getResponse?: () => Record<string, unknown> };
        const cuerpo = err.getResponse?.() ?? {};
        return err.codigo === 'ENLACE_VENCIDO' && String(cuerpo['mensaje']).includes('+584121234567');
      });
      const e = await repo(EnlaceReserva).findOneByOrFail({ reserva_id: r.id });
      assert.equal(e.estado, 'vencido'); // quedó marcado
    });

    it('enlace vigente devuelve reserva; reserva borrada → ENLACE_INVALIDO', async () => {
      const r = await nuevaReserva();
      await enlace(r.id, 'tok-ok');
      const { reserva } = await sm.resolverPorToken('tok-ok');
      assert.equal(reserva.id, r.id);

      // Borrar la reserva deja el enlace huérfano → inválido.
      await repo(Reserva).delete(r.id);
      await assert.rejects(sm.resolverPorToken('tok-ok'), (e: unknown) => {
        return (e as { codigo?: string }).codigo === 'ENLACE_INVALIDO';
      });
    });
  });

  describe('crearEnlace y ajustarHold', () => {
    it('crearEnlace guarda sólo el hash y devuelve el token en claro una vez', async () => {
      const r = await nuevaReserva();
      const { enlace: e, token } = await sm.crearEnlace(r.id, 'admin-1', 48);
      assert.ok(token.length > 20);
      assert.equal(e.token_hash, hashToken(token));
      assert.notEqual(e.token_hash, token);
      const restante = e.expira_en.getTime() - Date.now();
      assert.ok(restante > 47 * 3600_000 && restante <= 48 * 3600_000);
      // Reserva inexistente → NO_ENCONTRADO.
      await assert.rejects(sm.crearEnlace('no-existe', 'admin-1'), (err: unknown) => {
        return (err as { codigo?: string }).codigo === 'NO_ENCONTRADO';
      });
    });

    it('ajustarHold es no-op sin hold retenido', async () => {
      const r = await nuevaReserva('en_registro');
      await repo(Reserva).update(r.id, { cupo_estado: 'ninguno', cupo_pasajeros: 0 });
      await sm.ajustarHold(r, 5); // no debe lanzar ni tocar cupos
      assert.equal((await repo(FechaTour).findOneByOrFail({ id: fechaId })).cupos_retenidos, 0);
    });

    it('ajustarHold crece dentro del cupo y lanza SIN_CUPO si no alcanza', async () => {
      const r = await nuevaReserva('en_registro');
      // ajustarHold lee la entidad en memoria: hay que mutarla, no sólo la DB.
      r.cupo_estado = 'retenido';
      r.cupo_pasajeros = 1;
      await repo(FechaTour).update(fechaId, { cupos_retenidos: 1 });

      await sm.ajustarHold(r, 2); // cabe: total 2
      assert.equal((await repo(FechaTour).findOneByOrFail({ id: fechaId })).cupos_retenidos, 2);

      await assert.rejects(sm.ajustarHold(r, 5), (e: unknown) => {
        const err = e as { codigo?: string; detalles?: { codigo: string }[] };
        return err.codigo === 'VALIDACION' && err.detalles?.[0]?.codigo === 'SIN_CUPO';
      });
      // La fecha no cambió tras el rechazo.
      assert.equal((await repo(FechaTour).findOneByOrFail({ id: fechaId })).cupos_retenidos, 2);
    });
  });
});
