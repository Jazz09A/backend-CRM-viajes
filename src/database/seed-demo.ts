import { DataSource } from 'typeorm';
import { createHash } from 'crypto';
import {
  CodigoPromocional,
  CupoOpcion,
  FechaTour,
  MetodoPago,
  Pasajero,
  PlantillaMensaje,
  PlantillaTerminos,
  PlantillaTerminosVersion,
  PoliticaCancelacion,
  Tarifa,
  TasaCambio,
  Tour,
  TourFormVersion,
  TourPuntoAbordaje,
} from './entities';
import { Usuario } from './entities/auth.entities';
import { Configuracion } from './entities/config.entities';
import { hashPassword } from '../common/crypto.util';
import { cifrarTexto } from '../common/datos-sensibles';

/**
 * Datos demo equivalentes al seed del frontend (`src/lib/mock/seed.ts`).
 * Solo para desarrollo/pruebas con SQLite; en producción se cargan datos reales.
 * Idempotente: no duplica si ya existe por clave única.
 */

const DIAS = 86400000;
const isoFecha = (dias: number) => new Date(Date.now() + dias * DIAS).toISOString().slice(0, 10);
const isoHace = (dias: number, horas = 0) => new Date(Date.now() - dias * DIAS - horas * 3600000).toISOString();

const PRECIOS: Record<string, { Adulto: string; Niño: string; 'Tercera Edad': string }> = {
  tour_roques: { Adulto: '55.00', Niño: '35.00', 'Tercera Edad': '50.00' },
  tour_merida: { Adulto: '90.00', Niño: '60.00', 'Tercera Edad': '80.00' },
  tour_colonia: { Adulto: '50.00', Niño: '32.00', 'Tercera Edad': '45.00' },
  tour_lacosta: { Adulto: '75.00', Niño: '50.00', 'Tercera Edad': '65.00' },
};

const RANGOS: Record<string, { min: number; max: number }> = {
  adulto: { min: 18, max: 120 },
  nino: { min: 5, max: 11 },
  tercera_edad: { min: 61, max: 120 },
  // Política de la agencia: hasta 4 años viaja gratis en piernas de su
  // representante (sin cupo y sin costo).
  infante: { min: 0, max: 4 },
};
const CATEGORIAS_BE = ['adulto', 'nino', 'tercera_edad', 'infante'] as const;
const CATEGORIA_A_PRECIO: Record<string, keyof (typeof PRECIOS)[string] | null> = {
  adulto: 'Adulto',
  nino: 'Niño',
  tercera_edad: 'Tercera Edad',
  infante: null,
};

const ALMUERZO_OPCIONES = [
  { valor: 'pescado', cupo: 20 },
  { valor: 'pollo', cupo: 30 },
  { valor: 'vegetariano', cupo: 10 },
];

function puntosRoques() {
  return [
    { clave: 'altamira', nombre: 'Altamira', hora: '05:00', referencia: 'Plaza Los Caracas, frente al Multicine.' },
    { clave: 'petare', nombre: 'Petare', hora: '05:30', referencia: 'Estación de servicio junto al Mercado Municipal.' },
    { clave: 'plaza_caracas', nombre: 'Plaza Caracas', hora: '05:15', referencia: 'Estacionamiento del Teatro Municipal.' },
  ];
}

function definicionFormulario(tourClave: string) {
  const puntos =
    tourClave === 'tour_merida'
      ? [
          { valor: 'altamira', label: 'Altamira, 5:00 a. m.' },
          { valor: 'plaza_caracas', label: 'Plaza Caracas, 5:15 a. m.' },
          { valor: 'el_paraiso', label: 'El Paraíso, 5:00 a. m.' },
        ]
      : tourClave === 'tour_colonia'
        ? [
            { valor: 'altamira', label: 'Altamira, 5:30 a. m.' },
            { valor: 'plaza_caracas', label: 'Plaza Caracas, 5:45 a. m.' },
          ]
        : tourClave === 'tour_lacosta'
          ? [
              { valor: 'altamira', label: 'Altamira, 5:00 a. m.' },
              { valor: 'petare', label: 'Petare, 5:30 a. m.' },
            ]
          : [
              { valor: 'altamira', label: 'Altamira, 5:00 a. m.' },
              { valor: 'petare', label: 'Petare, 5:30 a. m.' },
              { valor: 'plaza_caracas', label: 'Plaza Caracas, 5:15 a. m.' },
            ];
  const campos: Record<string, unknown>[] = [
    {
      id: 'almuerzo',
      label: 'Selección de almuerzo',
      ayuda: 'El menú se sirve al mediodía, en el destino.',
      tipo: 'select',
      alcance: 'por_pasajero',
      obligatorio: true,
      grupo: 'comida',
      aplica_a: ['Adulto', 'Tercera Edad', 'Niño'],
      opciones: [
        { valor: 'pescado', label: 'Pescado frito', cupo: 20 },
        { valor: 'pollo', label: 'Pollo a la canasta', cupo: 30 },
        { valor: 'vegetariano', label: 'Vegetariano', cupo: 10 },
      ],
    },
    {
      id: 'sabor_desayuno',
      label: 'Sabor del desayuno',
      ayuda: 'Selecciona el sabor de empanada para cada pasajero.',
      tipo: 'multiselect',
      alcance: 'por_pasajero',
      obligatorio: false,
      grupo: 'comida',
      opciones: [
        { valor: 'cazon', label: 'Cazón' },
        { valor: 'molida', label: 'Molida' },
        { valor: 'pollo', label: 'Pollo' },
        { valor: 'queso', label: 'Queso' },
      ],
    },
    {
      id: 'tiene_alergias',
      label: '¿Tiene alergias o condiciones médicas?',
      ayuda: 'Marca la casilla si hay alguna alergia, intolerancia o condición a considerar.',
      tipo: 'checkbox',
      alcance: 'por_pasajero',
      obligatorio: false,
    },
    {
      id: 'detalle_alergias',
      label: 'Describa cuáles',
      ayuda: 'Indique el alérgeno y la forma en que se presenta.',
      tipo: 'text',
      alcance: 'por_pasajero',
      obligatorio: true,
      visible_si: { campo: 'tiene_alergias', igual_a: true },
    },
    {
      id: 'punto_abordaje',
      label: 'Punto de abordaje',
      ayuda: 'Selecciona dónde te vamos a buscar.',
      tipo: 'select',
      alcance: 'por_reserva',
      obligatorio: true,
      permite_por_pasajero: true,
      fuente: 'puntos_salida',
      opciones: puntos,
    },
    {
      id: 'comentarios',
      label: 'Comentarios',
      ayuda: 'Cualquier dato que debamos saber (movilidad, acompañante, equipaje especial).',
      tipo: 'textarea',
      alcance: 'por_reserva',
      obligatorio: false,
      max_length: 1000,
    },
  ];
  if (tourClave === 'tour_roques') {
    campos.push({
      id: 'toldo',
      label: 'Alquiler de toldo',
      ayuda: 'Toldo de 3 x 3 metros para el grupo en la playa.',
      tipo: 'extra',
      alcance: 'por_reserva',
      obligatorio: false,
      precio_usd: '10.00',
      cantidad_max: 3,
      unidad: 'unidad',
    });
    campos.push({
      id: 'menu_infantil',
      label: 'Menú infantil',
      ayuda: 'Selecciona el menú del niño.',
      tipo: 'select',
      alcance: 'por_pasajero',
      obligatorio: true,
      grupo: 'comida',
      aplica_a: ['Niño'],
      opciones: [
        { valor: 'jugo_emparedado', label: 'Jugo y emparedado' },
        { valor: 'sandwich_pollo', label: 'Sándwich de pollo' },
        { valor: 'pasta', label: 'Pasta' },
      ],
    });
  }
  return { campos };
}

const CUERPO_TERMINOS_V2 = `## 1. Objeto del viaje

Escapate Tours comercializa tours turísticos Full Days y fines de semana desde Caracas hacia destinos nacionales. La reserva formaliza el derecho del titular a ocupar el cupo asignado en la salida seleccionada y los servicios descritos en el itinerario del tour.

## 2. Responsabilidades del titular

El titular declara ser mayor de 18 años, firma en nombre propio y de sus acompañantes, y entrega datos veraces de todos los pasajeros. Cada pasajero debe cumplir los requisitos migratorios y de salud aplicables al destino. El titular se hace responsable de la custodia de sus menores durante todo el viaje.

## 3. Cancelaciones y reembolsos

Si cancelas la reserva, no se devuelve ningún monto por temas de logística y políticas de la empresa. La política de cancelación del tour establece 0 % de reembolso en todos los tramos, ya que los servicios se contratan con anticipación y no admiten devoluciones.

## 4. Uso de datos personales

Los datos del titular y de sus acompañantes se usan exclusivamente para gestionar la reserva, emitir el voucher y coordinar la salida. No se comparten con terceros salvo con los proveedores del tour y cuando la ley lo exija.

## 5. Firma digital

La firma manuscrita capturada en pantalla, junto con la versión de términos aceptada, la fecha y hora en UTC, la dirección IP y el agente de usuario, constituyen evidencia de aceptación. Los cambios materiales posteriores a la firma invalidan la evidencia y requieren una nueva firma.

## 6. Documentación y vouchers

El voucher emitido es un comprobante de reserva y no sustituye la factura fiscal. El titular debe presentar su documento de identidad y la autorización de viaje de los menores cuando el tour la requiera.`;

const CUERPO_TERMINOS_V1 = `## 1. Objeto del viaje

Escapate Tours comercializa tours turísticos Full Days y fines de semana desde Caracas. La reserva asigna un cupo en la salida seleccionada.

## 2. Responsabilidades del titular

El titular declara ser mayor de 18 años y entrega datos veraces de todos los pasajeros.

## 3. Cancelaciones y reembolsos

Si cancelas la reserva, no se devuelve ningún monto por temas de logística y políticas de la empresa. La política establece 0 % de reembolso en todos los tramos.

## 4. Uso de datos personales

Los datos se usan para gestionar la reserva y emitir el voucher.

## 5. Firma digital

La firma capturada en pantalla con fecha, IP y versión de términos es evidencia de aceptación.

## 6. Documentación

El voucher es un comprobante de reserva y no sustituye la factura fiscal.`;

export async function ejecutarSeedDemo(ds: DataSource): Promise<void> {
  const usuarios = ds.getRepository(Usuario);
  const politicas = ds.getRepository(PoliticaCancelacion);
  const plantTerm = ds.getRepository(PlantillaTerminos);
  const plantTermVer = ds.getRepository(PlantillaTerminosVersion);
  const tours = ds.getRepository(Tour);
  const puntos = ds.getRepository(TourPuntoAbordaje);
  const forms = ds.getRepository(TourFormVersion);
  const fechas = ds.getRepository(FechaTour);
  const tarifas = ds.getRepository(Tarifa);
  const cupos = ds.getRepository(CupoOpcion);
  const metodos = ds.getRepository(MetodoPago);
  const tasas = ds.getRepository(TasaCambio);
  const promos = ds.getRepository(CodigoPromocional);
  const plantillas = ds.getRepository(PlantillaMensaje);
  const config = ds.getRepository(Configuracion);

  // ── usuarios demo ──────────────────────────────────────────────────
  const credenciales: { nombre: string; correo: string; roles: string[] }[] = [
    { nombre: 'Manuel Rodríguez', correo: 'admin@escapetour.app', roles: ['superadmin'] },
    { nombre: 'Carmen Díaz', correo: 'operador@escapetour.app', roles: ['operador'] },
    { nombre: 'Luis Bracho', correo: 'validador@escapetour.app', roles: ['validador'] },
    { nombre: 'Ana Rojas', correo: 'guia@escapetour.app', roles: ['guia'] },
    { nombre: 'Patricia Bello', correo: 'admin.anterior@escapetour.app', roles: ['superadmin'] },
  ];
  for (const c of credenciales) {
    const correo = c.correo.toLowerCase();
    const existe = await usuarios.findOne({ where: { correo } });
    if (existe) {
      existe.activo = c.correo !== 'admin.anterior@escapetour.app';
      existe.dos_fa_activo = false;
      existe.totp_secret_enc = null;
      await usuarios.save(existe);
      continue;
    }
    await usuarios.save(
      usuarios.create({
        nombre: c.nombre,
        correo,
        password_hash: hashPassword('demo1234'),
        roles: c.roles as Usuario['roles'],
        activo: c.correo !== 'admin.anterior@escapetour.app',
        dos_fa_activo: false,
        totp_secret_enc: null,
      }),
    );
  }

  // ── políticas de cancelación ───────────────────────────────────────
  const polFull = await politicas.findOne({ where: { nombre: 'Política de cancelación — Full Days' } });
  if (polFull && !polFull.clave) {
    polFull.clave = 'full_day';
    await politicas.save(polFull);
  }
  const polFullId =
    polFull?.id ??
    (
      await politicas.save(
        politicas.create({
          clave: 'full_day',
          nombre: 'Política de cancelación — Full Days',
          tramos: [
            { dias_min: 7, dias_max: null, reembolso_pct: 0 },
            { dias_min: 3, dias_max: 6, reembolso_pct: 0 },
            { dias_min: 0, dias_max: 2, reembolso_pct: 0 },
          ],
        }),
      )
    ).id;
  const polFinde = await politicas.findOne({ where: { nombre: 'Política de cancelación — Fines de semana' } });
  if (polFinde && !polFinde.clave) {
    polFinde.clave = 'fin_de_semana';
    await politicas.save(polFinde);
  }
  const polFindeId =
    polFinde?.id ??
    (
      await politicas.save(
        politicas.create({
          clave: 'fin_de_semana',
          nombre: 'Política de cancelación — Fines de semana',
          tramos: [
            { dias_min: 15, dias_max: null, reembolso_pct: 0 },
            { dias_min: 7, dias_max: 14, reembolso_pct: 0 },
            { dias_min: 3, dias_max: 6, reembolso_pct: 0 },
            { dias_min: 0, dias_max: 2, reembolso_pct: 0 },
          ],
        }),
      )
    ).id;

  // ── términos y condiciones ─────────────────────────────────────────
  let plantillaTerm = await plantTerm.findOne({ where: { nombre: 'Términos y condiciones — Escapate Tours' } });
  if (plantillaTerm && !plantillaTerm.clave) {
    plantillaTerm.clave = 'ruta-clara-v1';
    plantillaTerm = await plantTerm.save(plantillaTerm);
  }
  if (!plantillaTerm) {
    plantillaTerm = await plantTerm.save(
      plantTerm.create({ clave: 'ruta-clara-v1', nombre: 'Términos y condiciones — Escapate Tours' }),
    );
  }
  const versionesTerm = await plantTermVer.find({ where: { plantilla_id: plantillaTerm.id } });
  const hayV2 = versionesTerm.some((v) => v.version === 2);
  if (!hayV2) {
    await plantTermVer.save(
      plantTermVer.create({
        plantilla_id: plantillaTerm.id,
        version: 1,
        contenido: CUERPO_TERMINOS_V1,
        hash_sha256: createHash('sha256').update(CUERPO_TERMINOS_V1).digest('hex'),
        estado: 'archivada',
        publicada_en: new Date(Date.now() - 180 * DIAS),
      }),
    );
    const v2 = await plantTermVer.save(
      plantTermVer.create({
        plantilla_id: plantillaTerm.id,
        version: 2,
        contenido: CUERPO_TERMINOS_V2,
        hash_sha256: createHash('sha256').update(CUERPO_TERMINOS_V2).digest('hex'),
        estado: 'publicada',
        publicada_en: new Date(Date.now() - 25 * DIAS),
      }),
    );
    void v2;
  }

  // ── tours ──────────────────────────────────────────────────────────
  interface TourSeed {
    clave: string;
    nombre: string;
    tipo: 'full_day' | 'fin_de_semana' | 'multi_dia';
    descripcion: string;
    politica: string;
    puntos: { clave: string; nombre: string; hora: string; referencia: string }[];
  }
  const seedsTours: TourSeed[] = [
    {
      clave: 'tour_roques',
      nombre: 'Full Day Los Roques',
      tipo: 'full_day',
      descripcion:
        'Salida a las 5:00 a. m. hacia Los Roques con ida y vuelta el mismo día, almuerzo en la playa y tiempo libre para natación.',
      politica: polFullId,
      puntos: puntosRoques(),
    },
    {
      clave: 'tour_merida',
      nombre: 'Fin de Semana Mérida',
      tipo: 'fin_de_semana',
      descripcion: 'Dos días en los Andes merideños con visitas a la Sierra Nevada y Chivato.',
      politica: polFindeId,
      puntos: [
        { clave: 'altamira', nombre: 'Altamira', hora: '05:00', referencia: 'Plaza Los Caracas.' },
        { clave: 'plaza_caracas', nombre: 'Plaza Caracas', hora: '05:15', referencia: 'Teatro Municipal.' },
        { clave: 'el_paraiso', nombre: 'El Paraíso', hora: '05:00', referencia: 'Estación El Paraíso.' },
      ],
    },
    {
      clave: 'tour_colonia',
      nombre: 'Colonia Tovar',
      tipo: 'full_day',
      descripcion: 'Día en la Colonia Tovar con almuerzo campestre y paseo por el pueblo.',
      politica: polFullId,
      puntos: [
        { clave: 'altamira', nombre: 'Altamira', hora: '05:30', referencia: 'Plaza Los Caracas.' },
        { clave: 'plaza_caracas', nombre: 'Plaza Caracas', hora: '05:45', referencia: 'Teatro Municipal.' },
      ],
    },
    {
      clave: 'tour_lacosta',
      nombre: 'La Costa',
      tipo: 'fin_de_semana',
      descripcion: 'Fin de semana en la costa con hospedaje incluido.',
      politica: polFindeId,
      puntos: [
        { clave: 'altamira', nombre: 'Altamira', hora: '05:00', referencia: 'Plaza Los Caracas.' },
        { clave: 'petare', nombre: 'Petare', hora: '05:30', referencia: 'Mercado Municipal.' },
      ],
    },
  ];

  const mapaTours = new Map<string, Tour>();
  for (const seed of seedsTours) {
    // Buscar por nombre (el id es uuid generado).
    let tour = await tours.findOne({ where: { nombre: seed.nombre } });
    if (!tour) {
      tour = await tours.save(
        tours.create({
          clave: seed.clave,
          nombre: seed.nombre,
          tipo: seed.tipo,
          descripcion: seed.descripcion,
          itinerario: [],
          incluye: [],
          no_incluye: [],
          imagenes: [],
          politica_cancelacion_id: seed.politica,
          plantilla_terminos_id: plantillaTerm.id,
          requiere_autorizacion_menores: true,
          documento_menores: 'opcional',
          estado: 'activo',
        }),
      );
    }
    mapaTours.set(seed.clave, tour);
    // Puntos de abordaje (idempotente por clave).
    for (const [i, pt] of seed.puntos.entries()) {
      const existe = await puntos.findOne({ where: { tour_id: tour.id, clave: pt.clave } });
      if (!existe) {
        await puntos.save(
          puntos.create({ tour_id: tour.id, clave: pt.clave, nombre: pt.nombre, hora: pt.hora, referencia: pt.referencia, orden: i, activo: true }),
        );
      }
    }
    // Formulario publicado.
    const def = definicionFormulario(seed.clave);
    const hayForm = await forms.findOne({ where: { tour_id: tour.id, estado: 'publicada' } });
    if (!hayForm) {
      await forms.save(
        forms.create({
          tour_id: tour.id,
          version: 1,
          estado: 'publicada',
          definicion: def,
          hash: createHash('sha256').update(JSON.stringify(def)).digest('hex'),
          publicada_en: new Date(Date.now() - 12 * DIAS),
        }),
      );
    }
  }

  // ── fechas + tarifas + cupos por opción ────────────────────────────
  interface FechaSeed {
    tour: string;
    fecha: string;
    hora: string;
    cupos: number;
    vendidos: number;
    estado: 'publicada' | 'borrador' | 'cerrada' | 'cancelada';
    motivo?: string;
  }
  const fechasSeed: FechaSeed[] = [
    // Los Roques — la primera publicada con cupo libre va primero en la UI.
    { tour: 'tour_roques', fecha: isoFecha(10), hora: '05:30', cupos: 40, vendidos: 0, estado: 'publicada' },
    { tour: 'tour_roques', fecha: isoFecha(24), hora: '05:30', cupos: 40, vendidos: 10, estado: 'publicada' },
    { tour: 'tour_roques', fecha: isoFecha(38), hora: '05:30', cupos: 40, vendidos: 20, estado: 'publicada' },
    { tour: 'tour_roques', fecha: isoFecha(52), hora: '05:30', cupos: 40, vendidos: 28, estado: 'publicada' },
    { tour: 'tour_roques', fecha: isoFecha(66), hora: '05:30', cupos: 40, vendidos: 40, estado: 'publicada' }, // agotada
    { tour: 'tour_roques', fecha: isoFecha(80), hora: '05:30', cupos: 40, vendidos: 40, estado: 'cerrada', motivo: 'Cupo completo, no se aceptan más reservas.' },
    // Otros tours
    { tour: 'tour_merida', fecha: isoFecha(18), hora: '05:00', cupos: 24, vendidos: 8, estado: 'publicada' },
    { tour: 'tour_merida', fecha: isoFecha(46), hora: '05:00', cupos: 24, vendidos: 15, estado: 'publicada' },
    { tour: 'tour_colonia', fecha: isoFecha(14), hora: '05:30', cupos: 36, vendidos: 5, estado: 'publicada' },
    { tour: 'tour_colonia', fecha: isoFecha(58), hora: '05:30', cupos: 36, vendidos: 20, estado: 'publicada' },
    { tour: 'tour_lacosta', fecha: isoFecha(30), hora: '06:00', cupos: 30, vendidos: 0, estado: 'publicada' },
    { tour: 'tour_lacosta', fecha: isoFecha(44), hora: '06:00', cupos: 30, vendidos: 0, estado: 'borrador' },
  ];

  for (const fs of fechasSeed) {
    const tour = mapaTours.get(fs.tour);
    if (!tour) continue;
    let fecha = await fechas.findOne({ where: { tour_id: tour.id, fecha_salida: fs.fecha } });
    if (!fecha) {
      fecha = await fechas.save(
        fechas.create({
          tour_id: tour.id,
          fecha_salida: fs.fecha,
          hora_salida: fs.hora,
          cupos_total: fs.cupos,
          cupos_vendidos: fs.vendidos,
          cupos_retenidos: 0,
          estado: fs.estado,
          cierre_motivo: fs.estado === 'cerrada' ? 'sin_cupo' : null,
          cancelada_motivo: fs.motivo ?? null,
          corte_venta_horas: 12,
        }),
      );
    }
    // Tarifas por categoría (idempotente: una por fecha+categoría).
    const precios = PRECIOS[fs.tour];
    for (const categoria of CATEGORIAS_BE) {
      const existe = await tarifas.findOne({ where: { fecha_tour_id: fecha.id, categoria } });
      if (existe) continue;
      const precioCat = CATEGORIA_A_PRECIO[categoria];
      const precio = categoria === 'infante' ? '0.00' : (precios?.[precioCat as keyof typeof precios] ?? '0.00');
      const rango = RANGOS[categoria];
      await tarifas.save(
        tarifas.create({
          fecha_tour_id: fecha.id,
          categoria,
          edad_min: rango.min,
          edad_max: rango.max,
          precio_usd: precio,
        }),
      );
    }
    // Cupos por opción de almuerzo.
    for (const op of ALMUERZO_OPCIONES) {
      const existe = await cupos.findOne({ where: { fecha_tour_id: fecha.id, campo_id: 'almuerzo', valor: op.valor } });
      if (existe) continue;
      const vendidos = fs.vendidos >= fs.cupos ? op.cupo : Math.round((op.cupo * Math.min(fs.vendidos, 30)) / 60);
      await cupos.save(
        cupos.create({
          fecha_tour_id: fecha.id,
          campo_id: 'almuerzo',
          valor: op.valor,
          cupo: op.cupo,
          vendidos,
          retenidos: 0,
        }),
      );
    }
  }

  // ── métodos de pago ────────────────────────────────────────────────
  const metodosSeed: {
    clave: string;
    nombre: string;
    moneda: 'USD' | 'VES' | 'USDT';
    datos: { items: { etiqueta: string; valor: string; copiable?: boolean }[]; instrucciones?: string };
    campos: string[];
    comprobante: boolean;
    soloOperador: boolean;
    orden: number;
  }[] = [
    {
      clave: 'transferencia',
      nombre: 'Transferencia bancaria',
      moneda: 'USD',
      datos: {
        items: [
          { etiqueta: 'Banco', valor: 'Bancamiga' },
          { etiqueta: 'Número de cuenta', valor: '0102-0000-00-0000000000', copiable: true },
          { etiqueta: 'Tipo de cuenta', valor: 'Corriente' },
          { etiqueta: 'Titular', valor: 'Escapate Tours C.A.' },
          { etiqueta: 'RIF', valor: 'J-40123456-7' },
        ],
        instrucciones: 'Realiza la transferencia y reporta el pago con la referencia exacta del banco.',
      },
      campos: ['referencia', 'fecha_pago'],
      comprobante: true,
      soloOperador: false,
      orden: 1,
    },
    {
      clave: 'pago_movil',
      nombre: 'Pago Móvil',
      moneda: 'VES',
      datos: {
        items: [
          { etiqueta: 'Banco', valor: 'Banesco' },
          { etiqueta: 'Teléfono', valor: '+584121234567', copiable: true },
          { etiqueta: 'Cédula', valor: 'V-12345678' },
          { etiqueta: 'RIF', valor: 'J-40123456-7' },
        ],
        instrucciones: 'Envía el pago móvil y reporta el monto en bolívares junto con la referencia.',
      },
      campos: ['referencia', 'monto_ves', 'fecha_pago'],
      comprobante: true,
      soloOperador: false,
      orden: 2,
    },
    {
      clave: 'zelle',
      nombre: 'Zelle',
      moneda: 'USD',
      datos: {
        items: [{ etiqueta: 'Correo', valor: 'pagos@escapetour.app', copiable: true }],
        instrucciones: 'Envía el pago en dólares y reporta la referencia del correo de confirmación.',
      },
      campos: ['referencia', 'fecha_pago'],
      comprobante: true,
      soloOperador: false,
      orden: 3,
    },
    {
      clave: 'efectivo',
      nombre: 'Efectivo',
      moneda: 'USD',
      datos: {
        items: [{ etiqueta: 'Caja', valor: 'Mostrador Escapate Tours, Av. Libertador' }],
        instrucciones: 'Paga en la agencia. El operador registra el pago en efectivo.',
      },
      campos: ['referencia'],
      comprobante: false,
      soloOperador: true,
      orden: 4,
    },
    {
      clave: 'binance',
      nombre: 'Binance Pay',
      moneda: 'USDT',
      datos: {
        items: [{ etiqueta: 'Binance ID', valor: '842199553', copiable: true }],
        instrucciones: 'Paga con Binance Pay y reporta el ID de la transacción.',
      },
      campos: ['referencia', 'fecha_pago'],
      comprobante: true,
      soloOperador: false,
      orden: 5,
    },
  ];
  for (const m of metodosSeed) {
    const existe = await metodos.findOne({ where: { clave: m.clave } });
    if (existe) continue;
    await metodos.save(
      metodos.create({
        clave: m.clave,
        nombre: m.nombre,
        moneda: m.moneda,
        datos_cuenta: m.datos,
        campos_requeridos: m.campos.map((c) => ({ clave: c, etiqueta: c, requerido: true })),
        requiere_comprobante: m.comprobante,
        solo_operador: m.soloOperador,
        activo: true,
        orden: m.orden,
      }),
    );
  }

  // ── tasa de cambio ─────────────────────────────────────────────────
  const tasaVigente = await tasas.findOne({ where: {} , order: { vigente_desde: 'DESC' } });
  if (!tasaVigente) {
    const admin = await usuarios.findOne({ where: { correo: 'admin@escapetour.app' } });
    await tasas.save(
      tasas.create({
        tasa: '36.5000',
        vigente_desde: new Date(),
        registrada_por: admin?.id ?? 'sistema',
        nota: 'Tasa inicial demo',
      }),
    );
  }

  // ── códigos promocionales ──────────────────────────────────────────
  const promoSeeds: Partial<CodigoPromocional>[] = [
    { codigo: 'BIENVENIDA10', tipo: 'porcentaje', valor: '10.00', usos_max: 30, usos: 8, activo: true },
    { codigo: 'VERANO20', tipo: 'monto', valor: '20.00', usos_max: 50, usos: 3, activo: true },
  ];
  for (const p of promoSeeds) {
    const existe = await promos.findOne({ where: { codigo: p.codigo } });
    if (existe) continue;
    const roques = mapaTours.get('tour_roques');
    await promos.save(
      promos.create({
        ...p,
        tour_id: p.codigo === 'VERANO20' ? roques?.id ?? null : null,
        desde: new Date(Date.now() - 10 * DIAS),
        hasta: new Date(Date.now() + 60 * DIAS),
      } as CodigoPromocional),
    );
  }

  // ── plantillas de mensajes ─────────────────────────────────────────
  const plantillasSeed = [
    { clave: 'registro_completado', cuerpo: 'Hola {nombre_cliente}, tu registro para {tour} (salida {fecha}) quedó completado. Referencia {ref_corta}.' },
    { clave: 'pago_reportado', cuerpo: 'Hola {nombre_cliente}, recibimos tu reporte de pago para {tour} (salida {fecha}). Lo estamos verificando. Referencia {ref_corta}.' },
    { clave: 'pago_rechazado', cuerpo: 'Hola {nombre_cliente}, no pudimos validar tu pago de {tour} (salida {fecha}). Revisa el motivo y vuelve a reportarlo. Referencia {ref_corta}.' },
    { clave: 'voucher_emitido', cuerpo: '¡Listo, {nombre_cliente}! Tu voucher de {tour} (salida {fecha}) está disponible. Referencia {ref_corta}.' },
  ];
  for (const pl of plantillasSeed) {
    const existe = await plantillas.findOne({ where: { clave: pl.clave } });
    if (!existe) {
      await plantillas.save(
        plantillas.create({
          clave: pl.clave,
          canal: 'whatsapp',
          asunto: pl.clave,
          cuerpo: pl.cuerpo,
          variables: ['nombre_cliente', 'tour', 'fecha', 'ref_corta'],
          version: 1,
          activa: true,
        }),
      );
    }
  }

  // ── configuración extra ────────────────────────────────────────────
  const extraConfig: Record<string, unknown> = {
    agencia_whatsapp: '+584121234567',
    agencia_direccion: 'Av. Libertador, Caracas',
    enlace_vigencia_horas: 72,
    abono_minimo_porcentaje: 50,
    hold_horas: 24,
    max_pasajeros_reserva: 10,
    permite_sobreventa: false,
    Requires_autorizacion_menores: true,
    documento_menores: 'opcional',
    minutos_inactividad: 30,
    captcha_activo: false,
  };
  const roques = mapaTours.get('tour_roques');
  if (roques) extraConfig.tour_activo_default = roques.id;
  for (const [clave, valor] of Object.entries(extraConfig)) {
    const existe = await config.findOne({ where: { clave } });
    if (!existe) {
      await config.save(config.create({ clave, valor, actualizado_en: new Date() }));
    }
  }

  // eslint-disable-next-line no-console
  console.log('Seed demo completado (usuarios, catálogo, fechas, tarifas, métodos, tasa, promos)');
}

// Referencias para evitar unused imports en builds estrictos.
void Pasajero;
void isoHace;
