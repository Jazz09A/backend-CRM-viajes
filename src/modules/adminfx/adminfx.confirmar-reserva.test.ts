import assert from 'node:assert/strict';
import { describe, it, before, after, beforeEach } from 'node:test';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import {
  AuditLog,
  Cliente,
  CodigoPromocional,
  CupoOpcion,
  EnlaceReserva,
  FechaTour,
  Firma,
  MetodoPago,
  NotificacionPanel,
  Pago,
  Pasajero,
  PlantillaMensaje,
  PlantillaTerminos,
  PlantillaTerminosVersion,
  PoliticaCancelacion,
  PuntoSalida,
  Reembolso,
  Reserva,
  ReservaAjuste,
  ReservaLinea,
  TasaCambio,
  Tarifa,
  TourPuntoAbordaje,
  Tour,
  TourFormVersion,
  Usuario,
  Voucher,
  TODAS_ENTIDADES,
} from '../../database/entities';
import type { ReservaStateMachine } from '../reservas/reserva-state-machine';
import { AdminFxService } from './adminfx.service';

/**
 * **Confirmación manual de la reserva** (`POST /adminfx/reservas/:id/confirmar`).
 *
 * Cuando el titular no reporta el pago —porque la agencia lo cobra por
 * adelantado, por transferencia o en el punto de encuentro— la reserva se
 * queda en `pendiente_pago` y nadie la avanza. Esta acción la confirma.
 *
 * Lo que se verifica son las guardas: no se confirma una reserva sin firma,
 * ni desde un estado que no lo permita. El pago ya no es prerrequisito: se
 * registra después y nace aprobado.
 */
describe('AdminFxService.confirmarReserva', () => {
  let ds: DataSource;
  let service: AdminFxService;
  let reservaId = '';
  let firmaId = '';
  const usuarioId = uuidv7();

  const repo = <T extends object>(e: new () => T) => ds.getRepository(e);

  /** La máquina de estados real no cabe en una prueba unitaria: se simula. */
  const stateMachineStub = {
    transicionar: async (id: string, _evento: string) => {
      const r = await ds.getRepository(Reserva).findOneByOrFail({ id });
      r.estado = 'confirmada';
      r.codigo = 'VJ-2026-00001';
      await ds.getRepository(Reserva).save(r);
      return r;
    },
  } as unknown as ReservaStateMachine;

  before(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: TODAS_ENTIDADES,
      synchronize: true,
    });
    await ds.initialize();

    service = new AdminFxService(
      repo(Reserva),
      repo(Cliente),
      repo(EnlaceReserva),
      repo(Pasajero),
      repo(FechaTour),
      repo(Tarifa),
      repo(CupoOpcion),
      repo(Tour),
      repo(PuntoSalida),
      repo(TourPuntoAbordaje),
      repo(TourFormVersion),
      repo(MetodoPago),
      repo(Pago),
      repo(Reembolso),
      repo(ReservaAjuste),
      repo(ReservaLinea),
      repo(Firma),
      repo(Voucher),
      repo(TasaCambio),
      repo(PlantillaTerminos),
      repo(PlantillaTerminosVersion),
      repo(PoliticaCancelacion),
      repo(PlantillaMensaje),
      repo(CodigoPromocional),
      repo(Usuario),
      repo(AuditLog),
      repo(NotificacionPanel),
      {} as never,
      {} as never,
      stateMachineStub,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
  });

  after(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    for (const e of [Reserva, Firma, Pago, AuditLog, Tarifa, FechaTour, Tour]) {
      await ds.getRepository(e).clear();
    }

    const tour = await ds.getRepository(Tour).save(
      ds.getRepository(Tour).create({ nombre: 'Morrocoy · Cayo Sombrero', tipo: 'full_day', estado: 'activo' }),
    );
    const fecha = await ds.getRepository(FechaTour).save(
      ds.getRepository(FechaTour).create({
        tour_id: tour.id,
        fecha_salida: '2026-11-20',
        hora_salida: '21:00',
        cupos_total: 40,
        estado: 'publicada',
      }),
    );
    await ds.getRepository(Tarifa).save(
      ds.getRepository(Tarifa).create({
        fecha_tour_id: fecha.id,
        categoria: 'adulto',
        edad_min: 18,
        edad_max: 120,
        precio_usd: '60.00',
      }),
    );

    const reserva = await ds.getRepository(Reserva).save(
      ds.getRepository(Reserva).create({
        ref_corta: 'R-00000001',
        fecha_tour_id: fecha.id,
        estado: 'pendiente_pago',
        estado_pago: 'parcial',
        total_usd: '60.00',
        aprobado_usd: '20.00',
        cupo_estado: 'retenido',
        cupo_pasajeros: 1,
        creada_por: usuarioId,
        ultima_actividad_en: new Date(),
      }),
    );
    reservaId = reserva.id;

    const firma = await ds.getRepository(Firma).save(
      ds.getRepository(Firma).create({
        reserva_id: reserva.id,
        vigente: true,
        archivo_id: uuidv7(),
        hash_imagen: 'x',
        hash_documento: 'y',
        contenido_hash: 'z',
        terminos_version_id: uuidv7(),
        ip: '127.0.0.1',
        user_agent: 'test',
        scroll_completo: true,
        trazos: { n_trazos: 1, longitud_px: 10, duracion_ms: 100 },
        firmada_en: new Date(),
      }),
    );
    firmaId = firma.id;
  });

  it('confirma la reserva y devuelve el código y el saldo pendiente', async () => {
    const resp = await service.confirmarReserva(reservaId, { motivo: 'Pago por transferencia' }, usuarioId);

    assert.equal(resp.ok, true);
    assert.equal(resp.estado, 'confirmada');
    assert.equal(resp.codigo, 'VJ-2026-00001');
    // Total 60, aprobado 20 → queda 40 por cobrar.
    assert.equal(Number(resp.saldo_usd), 40);

    const reserva = await ds.getRepository(Reserva).findOneByOrFail({ id: reservaId });
    assert.equal(reserva.estado, 'confirmada');

    const auditoria = await ds.getRepository(AuditLog).find();
    const entrada = auditoria.find((a) => a.accion === 'reserva.confirmada_manualmente');
    assert.ok(entrada, 'debe quedar la confirmación en la auditoría');
    assert.equal(entrada.entidad_id, reservaId);
  });

  it('no confirma una reserva sin firma de términos vigente', async () => {
    await ds.getRepository(Firma).delete({ id: firmaId });

    await assert.rejects(
      () => service.confirmarReserva(reservaId, { motivo: 'prueba' }, usuarioId),
      (error: { status?: number }) => {
        assert.equal(error.status, 422);
        return true;
      },
    );

    const reserva = await ds.getRepository(Reserva).findOneByOrFail({ id: reservaId });
    assert.equal(reserva.estado, 'pendiente_pago');
  });

  it('confirma aunque el titular haya reportado un pago (acuse, ya no hay cola)', async () => {
    await ds.getRepository(Pago).save(
      ds.getRepository(Pago).create({
        reserva_id: reservaId,
        metodo_id: uuidv7(),
        origen: 'cliente',
        estado: 'reportado',
        monto_reportado: '20.00',
        monto: '20.00',
        moneda: 'USD',
        monto_usd_equivalente: '20.00',
        esperado_usd: '60.00',
        fecha_pago: '2026-11-11',
        referencia: 'AB-1',
        campos_extra: {},
        registrado_por: usuarioId,
      }),
    );

    const resp = await service.confirmarReserva(reservaId, { motivo: 'prueba' }, usuarioId);
    assert.equal(resp.ok, true);
    assert.equal(resp.estado, 'confirmada');
  });

  it('no confirma una reserva en un estado que no lo permite', async () => {
    const reserva = await ds.getRepository(Reserva).findOneByOrFail({ id: reservaId });
    reserva.estado = 'cancelada';
    await ds.getRepository(Reserva).save(reserva);

    await assert.rejects(
      () => service.confirmarReserva(reservaId, { motivo: 'prueba' }, usuarioId),
      (error: { status?: number }) => {
        assert.equal(error.status, 409);
        return true;
      },
    );
  });
});
