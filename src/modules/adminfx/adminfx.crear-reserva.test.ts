import assert from 'node:assert/strict';
import { describe, it, before, after, beforeEach } from 'node:test';
import { DataSource } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';
import {
  AuditLog,
  Cliente,
  CodigoPromocional,
  Configuracion,
  CupoOpcion,
  EnlaceReserva,
  FechaTour,
  Firma,
  MetodoPago,
  NotificacionPanel,
  Pasajero,
  Pago,
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
  Tour,
  TourFormVersion,
  Usuario,
  Voucher,
  TODAS_ENTIDADES,
} from '../../database/entities';
import type { ReservasService } from '../reservas/reservas.service';
import { AdminFxService } from './adminfx.service';

/**
 * Alta de reserva con precio administrado (`POST /adminfx/reservas`).
 *
 * La regla de negocio: el operador puede fijar cargos extra y ajustes al crear
 * el enlace (toldo, recargo por habitación privada, descuento por convenio) y
 * eso debe quedar persistido y reflejado en el total — sin duplicar la lógica
 * de `guardarPrecio`.
 */
describe('AdminFxService.crearReserva (cargos iniciales)', () => {
  let ds: DataSource;
  let service: AdminFxService;
  let creadas: { fecha_tour_id: string; referencia_interna?: string }[];

  const usuarioId = uuidv7();
  let tourId = '';
  let fechaId = '';

  // `crearReserva` delega el alta en ReservasService; aquí sólo interesa el
  // resultado del alta + el precio, así que el servicio real se sustituye.
  const reservasStub = {
    crear: async (dto: { fecha_tour_id: string; referencia_interna?: string }) => {
      creadas.push(dto);
      const reserva = await ds.getRepository(Reserva).save(
        ds.getRepository(Reserva).create({
          ref_corta: `R-${creadas.length}`.padStart(8, '0'),
          fecha_tour_id: dto.fecha_tour_id,
          ...(dto.referencia_interna ? { referencia_interna: dto.referencia_interna } : {}),
          estado: 'enlace_creado',
          creada_por: usuarioId,
          ultima_actividad_en: new Date(),
        }),
      );
      return {
        reserva,
        enlace: { url: '/r/token-falso', expira_en: new Date(Date.now() + 3600_000).toISOString() },
        advertencias: [],
      };
    },
  } as unknown as ReservasService;

  const repo = <T extends object>(e: new () => T) => ds.getRepository(e);

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
      reservasStub,
      {} as never,
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
    creadas = [];
    for (const e of [
      Reserva,
      ReservaLinea,
      ReservaAjuste,
      AuditLog,
      Tarifa,
      FechaTour,
      Tour,
      Cliente,
      Configuracion,
    ]) {
      await ds.getRepository(e).clear();
    }

    const tour = await ds.getRepository(Tour).save(
      ds.getRepository(Tour).create({
        nombre: 'Full Day Morrocoy – Cayo Sombrero',
        tipo: 'full_day',
        estado: 'activo',
      }),
    );
    tourId = tour.id;
    const fecha = await ds.getRepository(FechaTour).save(
      ds.getRepository(FechaTour).create({
        tour_id: tourId,
        fecha_salida: '2026-11-21',
        hora_salida: '21:00',
        cupos_total: 40,
        estado: 'publicada',
      }),
    );
    fechaId = fecha.id;
    await ds.getRepository(Tarifa).save(
      ds.getRepository(Tarifa).create({
        fecha_tour_id: fechaId,
        categoria: 'adulto',
        edad_min: 18,
        edad_max: 120,
        precio_usd: '60.00',
      }),
    );
  });

  it('crea la reserva sin cargo alguno cuando no se envían líneas ni ajustes', async () => {
    const resp = await service.crearReserva({ fecha_tour_id: fechaId }, usuarioId);

    assert.equal(await ds.getRepository(ReservaLinea).count(), 0);
    assert.equal(await ds.getRepository(ReservaAjuste).count(), 0);
    assert.equal(Number((resp.reserva as { total_usd: string }).total_usd), 0);
    assert.equal(resp.precio, undefined);
  });

  it('persiste los cargos y ajustes iniciales y recalcula el total', async () => {
    const resp = await service.crearReserva(
      {
        fecha_tour_id: fechaId,
        referencia_interna: 'María Pérez',
        lineas: [{ concepto: 'Alquiler de toldo', cantidad: 2, precio_unit_usd: '10.00' }],
        ajustes: [{ tipo: 'descuento', monto_usd: '5.00', motivo: 'Convenio con el cliente' }],
      },
      usuarioId,
    );

    const lineas = await ds.getRepository(ReservaLinea).find();
    assert.equal(lineas.length, 1);
    assert.equal(lineas[0]!.concepto, 'Alquiler de toldo');
    assert.equal(Number(lineas[0]!.subtotal_usd), 20);

    const ajustes = await ds.getRepository(ReservaAjuste).find();
    assert.equal(ajustes.length, 1);
    assert.equal(ajustes[0]!.motivo, 'Convenio con el cliente');
    assert.equal(ajustes[0]!.origen, 'manual');

    // 0 pasajeros registrados aún: la base de tarifas es 0 → total = cargos.
    const reserva = await ds.getRepository(Reserva).findOneBy({ id: (resp.reserva as { id: string }).id });
    assert.equal(Number(reserva?.total_usd), 15); // 20.00 − 5.00
    assert.equal(Number(reserva?.adicionales_usd), 20);
    assert.equal(Number(reserva?.descuentos_usd), 5);

    const auditoria = await ds.getRepository(AuditLog).find();
    assert.ok(auditoria.some((a) => a.accion === 'reserva.precio_editado'));
  });

  it('rechaza el alta inválida sin llegar a crear la reserva', async () => {
    await assert.rejects(
      () =>
        service.crearReserva(
          {
            fecha_tour_id: fechaId,
            lineas: [{ concepto: '   ', cantidad: 1, precio_unit_usd: '10.00' }],
          },
          usuarioId,
        ),
      (error: { codigo?: string; status?: number }) => {
        assert.equal(error.status, 422);
        return true;
      },
    );

    assert.equal(await ds.getRepository(Reserva).count(), 0);
    assert.equal(await ds.getRepository(ReservaLinea).count(), 0);
  });
});
