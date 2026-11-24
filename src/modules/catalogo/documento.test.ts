import assert from 'node:assert/strict';
import { describe, it, before, after, beforeEach } from 'node:test';
import { DataSource } from 'typeorm';
import {
  FechaTour,
  PlantillaTerminos,
  PlantillaTerminosVersion,
  PuntoSalida,
  PoliticaCancelacion,
  Tarifa,
  Tour,
  TourFormVersion,
  TourPrecio,
  TourPuntoAbordaje,
  TODAS_ENTIDADES,
} from '../../database/entities';
import { aplicarDocumentoTour, documentoDesdeTour, type DocumentoTour } from './documento';

/**
 * **El documento de tour** (el catálogo como contrato).
 *
 * El panel y el importador por CLI aplican el mismo documento: aquí se
 * comprueba que un tour queda con todo lo que el catálogo define (puntos con
 * su hora, precios, notas, salidas con sus tarifas y formulario publicado)
 * y que aplicarlo dos veces no duplica nada.
 */
describe('Documento de tour (el catálogo como contrato)', () => {
  let ds: DataSource;

  const documento = (): DocumentoTour => ({
    clave: 'chuspa-playa-caribe',
    nombre: 'Playa Caribe · Chuspa',
    tipo: 'full_day',
    duracion: { dias: 1, noches: 0 },
    familia: 'Chuspa',
    politica: 'full_day',
    terminos: 'escapate-v1',
    hora_salida: '06:00',
    reserva_usd: 20,
    cupos: 40,
    descripcion: 'Full day a Playa Caribe en Chuspa.',
    puntos: [
      { clave: 'guatire_castillejo', hora: '06:00' },
      { clave: 'caracas_altamira', hora: '06:00' },
    ],
    precios: { adulto: 48, nino: 48, tercera_edad: 48, infante: 0 },
    fechas: ['2026-12-20'],
    incluye: ['Desayuno + bebida', 'Almuerzo playero + bebida'],
    no_incluye: ['Toldos y sillas'],
    itinerario: [{ hora: '', titulo: 'Salida', detalle: 'Guatire 6:00 a. m.' }],
    notas: ['El chat no indica hora de salida: se usa 6:00 a. m. como referencia.'],
  });

  before(async () => {
    ds = new DataSource({
      type: 'better-sqlite3',
      database: ':memory:',
      entities: TODAS_ENTIDADES,
      synchronize: true,
    });
    await ds.initialize();
  });

  after(async () => {
    await ds.destroy();
  });

  beforeEach(async () => {
    await ds.query('DELETE FROM "tarifa"');
    await ds.query('DELETE FROM "cupo_opcion"');
    await ds.query('DELETE FROM "fecha_tour"');
    await ds.query('DELETE FROM "tour_form_version"');
    await ds.query('DELETE FROM "tour_punto_abordaje"');
    await ds.query('DELETE FROM "tour_precio"');
    await ds.query('DELETE FROM "tour"');
    await ds.query('DELETE FROM "politica_cancelacion"');
    await ds.query('DELETE FROM "plantilla_terminos_version"');
    await ds.query('DELETE FROM "plantilla_terminos"');
    await ds.query('DELETE FROM "punto_salida"');
  });

  /** Prepara los catálogos de referencia (políticas, términos y puntos). */
  const prepararCatalogo = async () => {
    const repoPoliticas = ds.getRepository(PoliticaCancelacion);
    const politica = await repoPoliticas.save(
      repoPoliticas.create({
      clave: 'full_day',
      nombre: 'Política de cancelación — Full Days',
      tramos: [{ dias_min: 7, dias_max: null, reembolso_pct: 100 }],
      }),
    );
    const repoPlantillas = ds.getRepository(PlantillaTerminos);
    const plantilla = await repoPlantillas.save(
      repoPlantillas.create({
        clave: 'escapate-v1',
        nombre: 'Términos y condiciones — Escapate Tours',
      }),
    );
    const repoVersiones = ds.getRepository(PlantillaTerminosVersion);
    await repoVersiones.save(
      repoVersiones.create({
        plantilla_id: plantilla.id,
        version: 1,
        contenido: 'Condiciones generales.',
        hash_sha256: 'hash',
        estado: 'publicada',
        publicada_en: new Date(),
      }),
    );
    const repoPuntos = ds.getRepository(PuntoSalida);
    await repoPuntos.save([
      repoPuntos.create({

        clave: 'guatire_castillejo',
        nombre: 'Emporium Nuevo Castillejo',
        hora: '21:00',
        ciudad: 'Guatire',
        seleccionable: true,
        orden: 0,
        activo: true,
      }),
      repoPuntos.create({

        clave: 'caracas_altamira',
        nombre: 'Altamira Centro Plaza',
        hora: '12:30',
        ciudad: 'Caracas',
        seleccionable: false,
        orden: 1,
        activo: true,
      }),
    ]);
    return {
      politicas: new Map([['full_day', politica.id]]),
      terminos: new Map([['escapate-v1', plantilla.id]]),
      puntos: new Map(
        (await ds.getRepository(PuntoSalida).find()).map((p) => [p.clave, p]),
      ),
    };
  };

  it('crea el tour con todo lo que define el catálogo', async () => {
    const ctx = await prepararCatalogo();
    const resultado = await ds.transaction((em) => aplicarDocumentoTour(em, documento(), ctx));

    assert.equal(resultado.creado, true);
    assert.equal(resultado.fechasCreadas, 1);
    assert.equal(resultado.tarifasCreadas, 4);
    assert.equal(resultado.formularioPublicado, true);

    const tour = await ds.getRepository(Tour).findOne({ where: { id: resultado.tourId } });
    assert.ok(tour);
    assert.equal(tour.clave, 'chuspa-playa-caribe');
    assert.equal(tour.familia, 'Chuspa');
    assert.equal(tour.duracion_dias, 1);
    assert.equal(tour.duracion_noches, 0);
    assert.equal(tour.hora_salida, '06:00');
    assert.equal(tour.cupos, 40);
    assert.equal(Number(tour.reserva_usd), 20);
    assert.equal(tour.notas.length, 1);
    assert.equal(tour.incluye.length, 2);
    // La hora del itinerario es opcional: se guarda vacía, no se pierde.
    const itinerario = (tour.itinerario ?? []) as { hora?: string; titulo: string }[];
    assert.equal(itinerario[0].hora, '');

    // Puntos con la hora **del tour** (no la del catálogo global).
    const puntos = await ds.getRepository(TourPuntoAbordaje).find({
      where: { tour_id: tour.id },
      order: { orden: 'ASC' },
    });
    assert.equal(puntos.length, 2);
    assert.equal(puntos[0].hora, '06:00');
    assert.equal(puntos[0].nombre, 'Emporium Nuevo Castillejo');
    // Caracas se confirma después: `confirmar_hora` sale del catálogo.
    assert.equal(puntos[1].confirmar_hora, true);

    // Matriz de precios del tour (plantilla de las salidas).
    const precios = await ds.getRepository(TourPrecio).find({ where: { tour_id: tour.id } });
    assert.equal(precios.length, 4);
    assert.equal(Number(precios.find((p) => p.categoria === 'adulto')?.precio_usd), 48);
    assert.equal(Number(precios.find((p) => p.categoria === 'infante')?.precio_usd), 0);

    // Salida con sus cuatro tarifas.
    const fechas = await ds.getRepository(FechaTour).find({ where: { tour_id: tour.id } });
    assert.equal(fechas.length, 1);
    assert.equal(fechas[0].cupos_total, 40);
    const tarifas = await ds.getRepository(Tarifa).find({
      where: { fecha_tour_id: fechas[0].id },
    });
    assert.equal(tarifas.length, 4);

    // Formulario publicado con el punto de salida (sólo los seleccionables).
    const forms = await ds.getRepository(TourFormVersion).find({ where: { tour_id: tour.id } });
    assert.equal(forms.length, 1);
    assert.equal(forms[0].estado, 'publicada');
    const campos = (forms[0].definicion as { campos: Record<string, unknown>[] }).campos;
    const punto = campos.find((c) => c.id === 'punto_abordaje');
    assert.deepEqual(punto?.opciones, [{ valor: 'guatire_castillejo', label: 'Emporium Nuevo Castillejo' }]);
    // El tour incluye comidas → aparece la selección de almuerzo.
    assert.ok(campos.some((c) => c.id === 'almuerzo'));
    // Y desayuno con empanadas → selección obligatoria del relleno.
    const desayuno = campos.find((c) => c.id === 'sabor_desayuno');
    assert.ok(desayuno);
    assert.equal(desayuno.tipo, 'multiselect');
    assert.equal(desayuno.alcance, 'por_pasajero');
    assert.equal(desayuno.obligatorio, true);
    assert.deepEqual(
      (desayuno.opciones as { valor: string }[]).map((o) => o.valor),
      ['cazon', 'molida', 'pollo', 'queso'],
    );
  });

  it('sin desayuno en el incluye no agrega el campo de empanadas', async () => {
    const ctx = await prepararCatalogo();
    const doc = documento();
    doc.incluye = ['Almuerzo playero + bebida'];
    const resultado = await ds.transaction((em) => aplicarDocumentoTour(em, doc, ctx));

    const forms = await ds
      .getRepository(TourFormVersion)
      .find({ where: { tour_id: resultado.tourId, estado: 'publicada' } });
    const campos = (forms[0].definicion as { campos: Record<string, unknown>[] }).campos;
    assert.ok(campos.some((c) => c.id === 'almuerzo'));
    assert.ok(!campos.some((c) => /sabor|desayuno|empanada/i.test(String(c.id ?? ''))));
  });

  it('al reimportar fusiona el campo de desayuno sin borrar campos personalizados', async () => {
    const ctx = await prepararCatalogo();
    const doc = documento();
    // Formulario "viejo": sin sabor_desayuno y con un campo del admin.
    doc.incluye = ['Almuerzo playero + bebida'];
    const { tourId } = await ds.transaction((em) => aplicarDocumentoTour(em, doc, ctx));
    const repoForms = ds.getRepository(TourFormVersion);
    const viejo = await repoForms.findOneOrFail({ where: { tour_id: tourId, estado: 'publicada' } });
    const camposViejos = (viejo.definicion as { campos: Record<string, unknown>[] }).campos;
    viejo.definicion = {
      ...(viejo.definicion as Record<string, unknown>),
      campos: [
        ...camposViejos,
        { id: 'talla_camiseta', label: 'Talla de camiseta', tipo: 'select', opciones: [] },
      ],
    };
    await repoForms.save(viejo);

    // El catálogo ahora sí incluye desayuno → debe aparecer sin perder el campo custom.
    doc.incluye = ['Desayuno + bebida', 'Almuerzo playero + bebida'];
    const segunda = await ds.transaction((em) => aplicarDocumentoTour(em, doc, ctx));
    assert.equal(segunda.formularioPublicado, true);

    const publicado = await repoForms.findOneOrFail({
      where: { tour_id: tourId, estado: 'publicada' },
    });
    const campos = (publicado.definicion as { campos: Record<string, unknown>[] }).campos;
    assert.ok(campos.some((c) => c.id === 'sabor_desayuno'));
    assert.ok(campos.some((c) => c.id === 'talla_camiseta'));
    // Una sola versión publicada (la vieja quedó archivada).
    const publicadas = await repoForms.find({ where: { tour_id: tourId, estado: 'publicada' } });
    assert.equal(publicadas.length, 1);
  });

  it('sin puntos propios hereda los del catálogo global, y con un solo precio deriva las categorías', async () => {
    const ctx = await prepararCatalogo();
    const doc = documento();
    doc.puntos = [];
    doc.precios = { adulto: 30 };
    const resultado = await ds.transaction((em) => aplicarDocumentoTour(em, doc, ctx));

    // Puntos: los activos del catálogo global, con su hora de referencia y
    // Caracas «por confirmar».
    const puntos = await ds.getRepository(TourPuntoAbordaje).find({
      where: { tour_id: resultado.tourId },
      order: { orden: 'ASC' },
    });
    assert.equal(puntos.length, 2);
    assert.equal(puntos[0].clave, 'guatire_castillejo');
    assert.equal(puntos[0].hora, '21:00');
    assert.equal(puntos[0].confirmar_hora, false);
    assert.equal(puntos[1].clave, 'caracas_altamira');
    assert.equal(puntos[1].hora, '12:30');
    assert.equal(puntos[1].confirmar_hora, true);

    // El formulario sólo ofrece el punto seleccionable (Caracas no).
    const forms = await ds
      .getRepository(TourFormVersion)
      .find({ where: { tour_id: resultado.tourId, estado: 'publicada' } });
    const campos = (forms[0].definicion as { campos: Record<string, unknown>[] }).campos;
    const punto = campos.find((c) => c.id === 'punto_abordaje');
    assert.deepEqual(punto?.opciones, [
      { valor: 'guatire_castillejo', label: 'Emporium Nuevo Castillejo' },
    ]);

    // Precio único: niño y tercera edad quedan al precio adulto, infante en 0.
    const precios = await ds.getRepository(TourPrecio).find({ where: { tour_id: resultado.tourId } });
    assert.equal(precios.length, 4);
    assert.equal(Number(precios.find((p) => p.categoria === 'adulto')?.precio_usd), 30);
    assert.equal(Number(precios.find((p) => p.categoria === 'nino')?.precio_usd), 30);
    assert.equal(Number(precios.find((p) => p.categoria === 'tercera_edad')?.precio_usd), 30);
    assert.equal(Number(precios.find((p) => p.categoria === 'infante')?.precio_usd), 0);
    // Y las tarifas de la salida nacen derivadas igual.
    const fechas = await ds.getRepository(FechaTour).find({ where: { tour_id: resultado.tourId } });
    const tarifas = await ds
      .getRepository(Tarifa)
      .find({ where: { fecha_tour_id: fechas[0]?.id } });
    assert.equal(Number(tarifas.find((t) => t.categoria === 'nino')?.precio_usd), 30);
    assert.equal(Number(tarifas.find((t) => t.categoria === 'infante')?.precio_usd), 0);
  });

  it('es idempotente: aplicarlo dos veces no duplica nada', async () => {
    const ctx = await prepararCatalogo();
    await ds.transaction((em) => aplicarDocumentoTour(em, documento(), ctx));
    const segunda = await ds.transaction((em) => aplicarDocumentoTour(em, documento(), ctx));

    assert.equal(segunda.creado, false);
    assert.equal(segunda.fechasCreadas, 0);
    assert.equal(segunda.tarifasCreadas, 0);

    assert.equal(await ds.getRepository(Tour).count(), 1);
    assert.equal(await ds.getRepository(TourPuntoAbordaje).count(), 2);
    assert.equal(await ds.getRepository(TourPrecio).count(), 4);
    assert.equal(await ds.getRepository(FechaTour).count(), 1);
    assert.equal(await ds.getRepository(Tarifa).count(), 4);
  });

  it('el documento se reconstruye desde la base con la misma forma', async () => {
    const ctx = await prepararCatalogo();
    const { tourId } = await ds.transaction((em) => aplicarDocumentoTour(em, documento(), ctx));

    const leido = await ds.transaction((em) => documentoDesdeTour(em, tourId));
    assert.ok(leido);
    assert.equal(leido.clave, 'chuspa-playa-caribe');
    assert.equal(leido.familia, 'Chuspa');
    assert.equal(leido.politica, 'full_day');
    assert.equal(leido.terminos, 'escapate-v1');
    assert.equal(leido.hora_salida, '06:00');
    assert.equal(leido.cupos, 40);
    assert.equal(leido.reserva_usd, 20);
    assert.equal(leido.precios.adulto, 48);
    assert.equal(leido.precios.infante, 0);
    assert.deepEqual(leido.fechas, ['2026-12-20']);
    assert.equal(leido.puntos.length, 2);
    assert.equal(leido.puntos[0].hora, '06:00');
    assert.equal(leido.puntos[1].confirmar_hora, true);
    assert.equal(leido.notas.length, 1);
  });
});
