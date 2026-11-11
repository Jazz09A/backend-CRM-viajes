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
  Tour,
  TourFormVersion,
  Usuario,
  Voucher,
  TODAS_ENTIDADES,
} from '../../database/entities';
import { AdminFxService } from './adminfx.service';

/**
 * **Precio de la reserva con pagos registrados** (`PUT /adminfx/reservas/:id/precio`).
 *
 * Cuando ya hay un pago registrado, cambiar el total dejaría al titular con
 * un voucher distinto de lo que pagó. Por eso el cambio sólo se permite con
 * una justificación explícita, que queda en la auditoría.
 */
describe('AdminFxService.guardarPrecio (pagos registrados)', () => {
  let ds: DataSource;
  let service: AdminFxService;
  let reservaId = '';
  const usuarioId = uuidv7();

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
      {} as never,
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
    for (const e of [Reserva, Pasajero, Pago, AuditLog, ReservaLinea, Tarifa, FechaTour, Tour]) {
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
        ref_corta: 'R-00000002',
        fecha_tour_id: fecha.id,
        estado: 'pendiente_pago',
        estado_pago: 'sin_pago',
        total_usd: '60.00',
        aprobado_usd: '0.00',
        creada_por: usuarioId,
        ultima_actividad_en: new Date(),
      }),
    );
    reservaId = reserva.id;

    await ds.getRepository(Pasajero).save(
      ds.getRepository(Pasajero).create({
        reserva_id: reserva.id,
        orden: 1,
        es_titular: true,
        nombre: 'Titular de prueba',
        categoria: 'adulto',
        respuestas: {},
      }),
    );
  });

  async function registrarPago(monto: string, estado: 'aprobado' | 'reportado' = 'aprobado') {
    await ds.getRepository(Pago).save(
      ds.getRepository(Pago).create({
        reserva_id: reservaId,
        metodo_id: uuidv7(),
        origen: 'operador',
        estado,
        monto_reportado: monto,
        monto,
        moneda: 'USD',
        monto_usd_equivalente: monto,
        esperado_usd: '60.00',
        fecha_pago: '2026-11-11',
        referencia: `REF-${Date.now()}`,
        campos_extra: {},
        registrado_por: usuarioId,
        validado_por: usuarioId,
        validado_en: new Date(),
      }),
    );
  }

  const toldo = [{ concepto: 'Alquiler de toldo', cantidad: 2, precio_unit_usd: '10.00' }];

  it('deja cambiar el precio cuando la reserva no tiene pagos', async () => {
    const resp = await service.guardarPrecio(
      reservaId,
      { motivo: 'Se agrega toldo para 4 personas', lineas: toldo },
      usuarioId,
    );

    assert.equal(resp.ok, true);
    // 60 del titular + 20 del toldo.
    assert.equal(Number(resp.total_usd), 80);
  });

  it('exige justificación para cambiar el total con un pago aprobado', async () => {
    await registrarPago('60.00');

    await assert.rejects(
      () => service.guardarPrecio(reservaId, { motivo: 'Cambio de precio', lineas: toldo }, usuarioId),
      (error: { status?: number; codigo?: string; detalles?: { codigo?: string }[] }) => {
        assert.equal(error.status, 422);
        assert.equal(error.codigo, 'VALIDACION');
        assert.ok(
          error.detalles?.some((d) => d.codigo === 'PAGOS_REGISTRADOS'),
          'el detalle debe señalar que hay pagos registrados',
        );
        return true;
      },
    );

    // El precio no se tocó.
    const reserva = await ds.getRepository(Reserva).findOneByOrFail({ id: reservaId });
    assert.equal(Number(reserva.total_usd), 60);
  });

  it('acepta el cambio con justificación y la deja en la auditoría', async () => {
    await registrarPago('60.00');

    const resp = await service.guardarPrecio(
      reservaId,
      {
        motivo: 'Se agrega toldo para 4 personas',
        justificacion: 'El toldo se cobró aparte y el titular lo pidió después de pagar',
        lineas: toldo,
      },
      usuarioId,
    );

    assert.equal(Number(resp.total_usd), 80);

    const auditoria = await ds.getRepository(AuditLog).find();
    const entrada = auditoria.find((a) => a.accion === 'reserva.precio_editado');
    assert.ok(entrada);
    const valor = entrada.valor_nuevo as { justificacion?: string };
    assert.equal(valor.justificacion, 'El toldo se cobró aparte y el titular lo pidió después de pagar');
  });

  it('permite guardar los mismos cargos sin justificación si el total no cambia', async () => {
    await service.guardarPrecio(reservaId, { motivo: 'Se agrega toldo', lineas: toldo }, usuarioId);
    await registrarPago('80.00');

    const resp = await service.guardarPrecio(
      reservaId,
      { motivo: 'Se revisan los cargos', lineas: toldo },
      usuarioId,
    );

    assert.equal(Number(resp.total_usd), 80);
  });
});
