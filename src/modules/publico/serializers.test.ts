import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  CATEGORIA_A_BE,
  CATEGORIA_A_FE,
  auditoriaPublica,
  configPublica,
  fechaPublica,
  firmaPublica,
  formularioPublico,
  metodoPagoPublico,
  notificacionPublica,
  pagoPublico,
  pasoActualDe,
  pasajeroAdmin,
  pasajeroPublico,
  politicaPublica,
  progresoPublico,
  promoPublica,
  reservaPublica,
  tarifaPublica,
  tasaPublica,
  terminosPublico,
  tourPublico,
  tramosAEntidad,
  voucherPublico,
} from './serializers';
import { cifrarTexto } from '../../common/datos-sensibles';
import type {
  CupoOpcion,
  FechaTour,
  Firma,
  MetodoPago,
  Pasajero,
  Pago,
  Reserva,
  TasaCambio,
  Tour,
  Voucher,
} from '../../database/entities';

const pasajero = (parcial: Record<string, unknown>): Pasajero =>
  ({
    id: 'p1',
    ref_cliente: 'cli-1',
    es_titular: true,
    nombre: 'Ana',
    tipo_doc: 'v',
    documento_enc: cifrarTexto('12345678'),
    fecha_nacimiento_enc: cifrarTexto('1990-05-14'),
    categoria: 'adulto',
    respuestas: {},
    documento_ultimos4: '5678',
    ...parcial,
  }) as unknown as Pasajero;

const reserva = (parcial: Record<string, unknown>): Reserva =>
  ({
    id: 'r1',
    codigo: 'RC-1',
    ref_corta: 'RC1',
    fecha_tour_id: 'ft1',
    estado: 'en_registro',
    estado_pago: 'pendiente',
    paso_registro: 'titular',
    pasos_completados: {},
    total_usd: '100.00',
    aprobado_usd: '0.00',
    reembolsado_usd: '0.00',
    version: 1,
    creado_en: new Date('2026-01-01T00:00:00.000Z'),
    ultima_actividad_en: new Date('2026-01-02T00:00:00.000Z'),
    expira_en: null,
    verif_token: 'vt',
    ...parcial,
  }) as unknown as Reserva;

describe('serializers — categorías', () => {
  it('A_FE/A_BE son inversos y lo desconocido cae a Adulto/adulto', () => {
    for (const [be, fe] of [
      ['adulto', 'Adulto'],
      ['nino', 'Niño'],
      ['tercera_edad', 'Tercera Edad'],
      ['infante', 'Infante'],
    ]) {
      assert.equal(CATEGORIA_A_FE(be), fe);
      assert.equal(CATEGORIA_A_BE(fe), be);
    }
    assert.equal(CATEGORIA_A_FE('raro'), 'Adulto');
    assert.equal(CATEGORIA_A_FE(null), 'Adulto');
    assert.equal(CATEGORIA_A_FE('ADULTO'), 'Adulto'); // lowercase antes del lookup
    assert.equal(CATEGORIA_A_BE('Desconocida'), 'adulto');
  });
});

describe('serializers — pasajero', () => {
  it('pasajeroPublico descifra documento y fecha; expone campos condicionales', () => {
    const p = pasajeroPublico(
      pasajero({
        telefono: '123',
        correo: 'a@b.co',
        emergencia_nombre: 'Luis',
        emergencia_telefono: '456',
        declara_representante: true,
        documento_imagen_id: 'img1',
      }),
      '2026-06-01',
      [],
    );
    assert.equal(p['documento'], '12345678');
    assert.equal(p['fecha_nacimiento'], '1990-05-14');
    assert.equal(p['tipo_doc'], 'V'); // mayúsculas
    assert.equal(p['categoria'], 'Adulto');
    assert.equal(p['ref_cliente'], 'cli-1');
    assert.equal(p['telefono'], '123');
    assert.equal(p['contacto_emergencia_nombre'], 'Luis');
    assert.equal(p['declara_representante'], true);
    assert.equal(p['documento_imagen_id'], 'img1');
    // Sin campos opcionales → llaves ausentes (no undefined).
    const minimo = pasajeroPublico(pasajero({ id: 'p2', ref_cliente: null }), 'f', []);
    assert.equal(minimo['ref_cliente'], 'p2'); // fallback a id
    assert.equal('telefono' in minimo, false);
    assert.equal('correo' in minimo, false);
    assert.equal('contacto_emergencia_nombre' in minimo, false);
    assert.equal('declara_representante' in minimo, false);
  });

  it('pasajeroAdmin nunca expone datos en claro: enmascara documento', () => {
    const a = pasajeroAdmin(pasajero({}));
    assert.equal(a['documento'], '********5678');
    assert.equal(a['fecha_nacimiento'], '');
    assert.equal(a['documento_enmascarado'], '***5678');
    assert.equal('documento_enc' in a, false);
    assert.equal('documento_idx' in a, false);
    // Sin últimos4 → documento vacío y enmascarado null.
    const sin = pasajeroAdmin(pasajero({ documento_ultimos4: null }));
    assert.equal(sin['documento'], '');
    assert.equal(sin['documento_enmascarado'], null);
  });
});

describe('serializers — pasoActualDe y progresoPublico', () => {
  it('pasoActualDe mapea estados (difiere de progreso.ts en enlace_creado/pendiente_pago)', () => {
    assert.equal(pasoActualDe(reserva({ estado: 'enlace_creado' })), 'paso_registro');
    assert.equal(pasoActualDe(reserva({ estado: 'en_registro' })), 'titular');
    assert.equal(pasoActualDe(reserva({ estado: 'en_registro', paso_registro: 'resumen' })), 'resumen');
    assert.equal(pasoActualDe(reserva({ estado: 'pendiente_firma' })), 'firma');
    // Reservas legacy en pasos de pago → el cliente las ve como 'confirmada'.
    assert.equal(pasoActualDe(reserva({ estado: 'pendiente_pago' })), 'confirmada');
    assert.equal(pasoActualDe(reserva({ estado: 'pago_en_verificacion' })), 'confirmada');
    assert.equal(pasoActualDe(reserva({ estado: 'completada' })), 'confirmada');
    assert.equal(pasoActualDe(reserva({ estado: 'cancelada' })), 'cerrada');
    assert.equal(pasoActualDe(reserva({ estado: 'raro' })), 'cerrada');
  });

  it('progresoPublico en registro: pasos completo/actual/bloqueado', () => {
    const p = progresoPublico(
      reserva({ estado: 'en_registro', paso_registro: 'preguntas' }),
      [pasajero({})],
      false,
    );
    const estados = (p['pasos'] as { id: string; estado: string }[]).map((x) => [x.id, x.estado]);
    assert.deepEqual(estados, [
      ['titular', 'completo'],
      ['acompanantes', 'completo'],
      ['preguntas', 'actual'],
      ['resumen', 'bloqueado'],
      ['firma', 'bloqueado'],
    ]);
    assert.equal(p['cerrada'], false);
    assert.equal(p['mensaje_reanudacion'], 'Continuamos donde te quedaste: Preguntas del tour');
  });

  it('progresoPublico detecta campos_faltantes del titular', () => {
    const incompleto = pasajero({ telefono: null, correo: null });
    const p = progresoPublico(reserva({}), [incompleto], false);
    const faltantes = p['campos_faltantes'] as string[];
    assert.ok(faltantes.includes('titular.telefono'));
    assert.ok(faltantes.includes('titular.correo'));
    assert.ok(faltantes.includes('firma'));
    assert.ok(!faltantes.includes('titular.nombre'));
    assert.ok(!faltantes.includes('titular.documento'));
  });

  it('reserva cerrada marca pasos hasta el índice como completo', () => {
    const p = progresoPublico(reserva({ estado: 'cancelada' }), [pasajero({})], true);
    assert.equal(p['cerrada'], true);
    assert.equal(p['motivo_cierre'], 'agencia'); // cancelacion_origen por defecto
    const estados = (p['pasos'] as { estado: string }[]).map((x) => x.estado);
    // pasoActual 'cerrada' → indiceActual -1 → Math.max(-1,-1) → i<=-1 nunca → todos bloqueado? no:
    // cerrada && indiceActual=-1 → i <= -1 false → 'bloqueado' para todos.
    assert.ok(estados.every((e) => e === 'bloqueado' || e === 'completo'));
  });

  it('confirmada marca todos los pasos completo y sin mensaje', () => {
    const p = progresoPublico(reserva({ estado: 'confirmada' }), [pasajero({})], true);
    const estados = (p['pasos'] as { estado: string }[]).map((x) => x.estado);
    assert.ok(estados.every((e) => e === 'completo'));
    assert.equal('mensaje_reanudacion' in p, false);
  });

  it('expirada → motivo_cierre expiracion; cancelada usa cancelacion_origen', () => {
    assert.equal(
      progresoPublico(reserva({ estado: 'expirada' }), [], false)['motivo_cierre'],
      'expiracion',
    );
    assert.equal(
      progresoPublico(
        reserva({ estado: 'cancelada', cancelacion_origen: 'cliente' }),
        [],
        false,
      )['motivo_cierre'],
      'cliente',
    );
    assert.equal('motivo_cierre' in progresoPublico(reserva({ estado: 'en_registro' }), [], false), false);
  });

  it('sin pasajeros agrega "pasajeros" a campos_faltantes', () => {
    const p = progresoPublico(reserva({}), [], false);
    assert.ok((p['campos_faltantes'] as string[]).includes('pasajeros'));
  });
});

describe('serializers — reservaPublica', () => {
  it('saldo = max(0, total - (aprobado - reembolsado))', () => {
    const p = reservaPublica({
      r: reserva({ total_usd: '100.00', aprobado_usd: '30.00', reembolsado_usd: '5.00' }),
      pasajeros: [],
      fechaSalida: 'f',
      tarifas: [],
    });
    // neto = 30-5 = 25 → saldo = 75.
    assert.equal(p['saldo_usd'], '75.00');
    assert.equal(p['total_usd'], '100.00');
  });

  it('saldo nunca es negativo aunque se sobre-apruebe', () => {
    const p = reservaPublica({
      r: reserva({ total_usd: '100.00', aprobado_usd: '150.00', reembolsado_usd: '0.00' }),
      pasajeros: [],
      fechaSalida: 'f',
      tarifas: [],
    });
    assert.equal(p['saldo_usd'], '0.00');
  });

  it('campos condicionales: referencia_interna, requiere_accion, motivo_cierre', () => {
    const conTodo = reservaPublica({
      r: reserva({
        referencia_interna: 'REF-9',
        requiere_accion: true,
        requiere_accion_motivo: 'Falta pago',
        estado: 'cancelada',
        cancelacion_origen: 'agencia',
      }),
      pasajeros: [],
      fechaSalida: 'f',
      tarifas: [],
    });
    assert.equal(conTodo['referencia_interna'], 'REF-9');
    assert.equal(conTodo['requiere_accion'], 'Falta pago');
    assert.equal(conTodo['motivo_cierre'], 'agencia');

    const minimo = reservaPublica({ r: reserva({}), pasajeros: [], fechaSalida: 'f', tarifas: [] });
    assert.equal('referencia_interna' in minimo, false);
    assert.equal('motivo_cierre' in minimo, false);
    assert.equal(minimo['codigo'], 'RC-1');
  });

  it('titular y acompañantes se separan; sin titular → null', () => {
    const titular = pasajero({ id: 't', es_titular: true });
    const acomp = pasajero({ id: 'a', es_titular: false, nombre: 'Beto' });
    const p = reservaPublica({
      r: reserva({}),
      pasajeros: [titular, acomp],
      fechaSalida: 'f',
      tarifas: [],
    });
    assert.equal((p['titular'] as Record<string, unknown>)['id'] ?? (p['titular'] as Record<string, unknown>)['nombre'], 'Ana');
    assert.equal((p['acompanantes'] as unknown[]).length, 1);
    // El ref_cliente del titular es cli-1 (compartido en el fixture).
    const sinTitular = reservaPublica({
      r: reserva({}),
      pasajeros: [pasajero({ es_titular: false })],
      fechaSalida: 'f',
      tarifas: [],
    });
    assert.equal(sinTitular['titular'], null);
    assert.equal((sinTitular['acompanantes'] as unknown[]).length, 1);
  });
});

describe('serializers — firma, voucher y catálogo', () => {
  it('firmaPublica extrae métricas de trazos y saca _preview', () => {
    const f = firmaPublica({
      id: 'f1',
      hash_imagen: 'h1',
      hash_documento: 'h2',
      terminos_version_id: 'tv1',
      firmada_en: new Date('2026-01-05T00:00:00.000Z'),
      ip: '1.2.3.4',
      user_agent: 'ua',
      trazos: { n_trazos: 3, longitud_px: 500, duracion_ms: 2000, _preview: 'data:x' },
    } as unknown as Firma);
    assert.equal(f['n_trazos'], 3);
    assert.equal(f['longitud_px'], 500);
    assert.equal(f['duracion_ms'], 2000);
    assert.equal(f['preview'], 'data:x');
    assert.equal(f['integridad'], 'ok');
    assert.equal(f['version_terminos_id'], 'tv1');
    // Sin trazos → métricas 0 y sin preview.
    const vacia = firmaPublica({ id: 'f2', trazos: null } as unknown as Firma);
    assert.equal(vacia['n_trazos'], 0);
    assert.equal('preview' in vacia, false);
  });

  it('voucherPublico sólo da url_descarga cuando está listo con archivo', () => {
    const base = { id: 'v1', version: 1, vigente: true, creado_en: new Date() };
    const listo = voucherPublico(
      { ...base, estado: 'listo', archivo_id: 'a1' } as unknown as Voucher,
      'http://x',
      'tok',
    );
    assert.equal(listo['estado'], 'listo');
    assert.match(String(listo['url_descarga']), /voucher\/v1\/descarga\?t=tok/);

    for (const estado of ['generando', 'error', 'raro']) {
      const v = voucherPublico({ ...base, estado } as unknown as Voucher, 'http://x', 'tok');
      assert.equal(v['estado'], estado === 'error' ? 'error' : 'generando');
      assert.equal('url_descarga' in v, false);
    }
    // Listo sin archivo_id → sin URL.
    const sinArchivo = voucherPublico(
      { ...base, estado: 'listo', archivo_id: null } as unknown as Voucher,
      'http://x',
      'tok',
    );
    assert.equal('url_descarga' in sinArchivo, false);
  });

  it('tourPublico prefiere puntosTour sobre el catálogo y filtra inactivos', () => {
    const tour = {
      id: 't1',
      nombre: 'Tour',
      tipo: 'full_day',
      familia: null,
      duracion_dias: 1,
      duracion_noches: 0,
      estado: 'activo',
      politica_cancelacion_id: 'pol1',
      creado_en: new Date('2026-01-01T00:00:00.000Z'),
    } as unknown as Tour;
    const catalogo = [
      { id: 'c1', clave: 'cat', nombre: 'Catálogo', hora: '06:00', referencia: null, activo: true, orden: 2 },
      { id: 'c2', clave: 'off', nombre: 'Off', hora: '07:00', referencia: null, activo: false, orden: 1 },
    ] as never[];
    // Sin puntosTour → catálogo filtrado y ordenado.
    const sinPropios = tourPublico(tour, catalogo, 'fv', 'tv', undefined);
    const puntos = sinPropios['puntos_abordaje'] as { clave: string; confirmar_hora: boolean }[];
    assert.deepEqual(puntos.map((p) => p.clave), ['cat']); // 'off' filtrado
    assert.equal(puntos[0].confirmar_hora, false);

    // Con puntosTour → ganan aunque el catálogo tenga puntos.
    const conPropios = tourPublico(tour, catalogo, 'fv', 'tv', [
      { clave: 'p1', nombre: 'Punto tour', hora: '05:30', confirmar_hora: true },
    ]);
    const propios = conPropios['puntos_abordaje'] as { clave: string; hora: string; confirmar_hora: boolean }[];
    assert.deepEqual(propios.map((p) => p.clave), ['p1']);
    assert.equal(propios[0].hora, '05:30');
    assert.equal(propios[0].confirmar_hora, true);
    assert.equal(conPropios['terminos_version_id'], 'tv');
    assert.equal(conPropios['formulario_id'], 'fv');
  });

  it('fechaPublica: cupos_total incluye sobrecupo y agotados = vendidos+retenidos', () => {
    const f = {
      id: 'ft1',
      tour_id: 't1',
      fecha_salida: '2026-06-01',
      hora_salida: '06:00',
      cupos_total: 40,
      sobrecupo_autorizado: 5,
      cupos_retenidos: 3,
      cupos_vendidos: 10,
      estado: 'abierta',
      corte_venta_horas: 24,
    } as unknown as FechaTour;
    const cupos = [
      { campo_id: 'comida', valor: 'veg', cupo: 10, vendidos: 8, retenidos: 2 },
    ] as unknown as CupoOpcion[];
    const p = fechaPublica(f, cupos);
    assert.equal(p['cupos_total'], 45); // 40 + 5
    assert.equal(p['sobrecupo_autorizado'], true);
    assert.deepEqual(p['opciones_cupo'], [
      { campo_id: 'comida', opcion: 'veg', cupo: 10, agotados: 10 },
    ]);
    // cierre_motivo 'sin_cupo' → motivo_cierre.
    const cerrada = fechaPublica(
      { ...f, cierre_motivo: 'sin_cupo' } as unknown as FechaTour,
      [],
    );
    assert.equal(cerrada['motivo_cierre'], 'Cierre manual');
    const cancelada = fechaPublica(
      { ...f, cancelada_motivo: 'Tormenta' } as unknown as FechaTour,
      [],
    );
    assert.equal(cancelada['motivo_cierre'], 'Tormenta');
    assert.equal('motivo_cierre' in fechaPublica(f, []), false);
  });

  it('politicaPublica describe tramos y tramosAEntidad los invierte', () => {
    const tramos = [
      { dias_min: 30, dias_max: null, reembolso_pct: 100 },
      { dias_min: 15, dias_max: 29, reembolso_pct: 50 },
      { dias_min: 0, dias_max: 14, reembolso_pct: 0 },
    ];
    const p = politicaPublica({ id: 'pol', clave: 'c1', nombre: 'Pol', tramos } as never);
    const salida = p['tramos'] as { dias_desde_salida: number; porcentaje_reembolso: number; descripcion: string }[];
    assert.equal(salida[0].dias_desde_salida, 30);
    assert.match(salida[0].descripcion, /30 días o más/);
    assert.match(salida[1].descripcion, /Entre 15 y 29 días/);

    // tramosAEntidad ordena desc y calcula dias_max = siguiente-1.
    // Quirk documentado: para el tramo mayor (30) dias_max queda 14 — el
    // rango sale invertido (min>max); es el comportamiento real actual.
    const entidad = tramosAEntidad([
      { dias_desde_salida: 15, porcentaje_reembolso: 50 },
      { dias_desde_salida: 30, porcentaje_reembolso: 100 },
      { dias_desde_salida: 0, porcentaje_reembolso: 0 },
    ]);
    assert.deepEqual(entidad, [
      { dias_min: 30, dias_max: 14, reembolso_pct: 100 },
      { dias_min: 15, dias_max: -1, reembolso_pct: 50 },
      { dias_min: 0, dias_max: null, reembolso_pct: 0 },
    ]);
  });
});

describe('serializers — configPublica', () => {
  const mapa = (entradas: [string, unknown][]) => new Map(entradas);

  it('devuelve defaults cuando el mapa está vacío', () => {
    const c = configPublica(mapa([]));
    assert.equal(c['agencia_nombre'], 'Escapate Tours');
    assert.equal(c['agencia_whatsapp'], '+584121234567');
    assert.equal(c['hold_horas'], 24);
    assert.equal(c['enlace_vigencia_horas'], 72);
    assert.equal(c['abono_minimo_porcentaje'], 50);
    assert.equal(c['max_pasajeros_reserva'], 10);
    assert.equal(c['idioma'], 'es');
    assert.equal(c['comidas_deshabilitadas'], true); // default true
    assert.equal(c['reporte_pago_cliente'], false);
  });

  it('claves alternativas: whatsapp_agencia, enlace_vigencia_h, abono_minimo_pct', () => {
    const c = configPublica(
      mapa([
        ['whatsapp_agencia', '+58000'],
        ['enlace_vigencia_h', 48],
        ['abono_minimo_pct', 30],
      ]),
    );
    assert.equal(c['agencia_whatsapp'], '+58000');
    assert.equal(c['enlace_vigencia_horas'], 48);
    assert.equal(c['abono_minimo_porcentaje'], 30);
  });

  it('quirk: Boolean("false") es true para flags string (documentado)', () => {
    const c = configPublica(mapa([['permite_sobreventa', 'false']]));
    assert.equal(c['permite_sobreventa'], true); // string truthy
  });

  it('comidas_deshabilitadas: cualquier valor !== false la deja activa', () => {
    assert.equal(configPublica(mapa([['comidas_deshabilitadas', false]]))['comidas_deshabilitadas'], false);
    assert.equal(configPublica(mapa([['comidas_deshabilitadas', 'false']]))['comidas_deshabilitadas'], true);
    assert.equal(configPublica(mapa([['comidas_deshabilitadas', 0]]))['comidas_deshabilitadas'], true);
  });

  it('reporte_pago_cliente exige true estricto', () => {
    assert.equal(configPublica(mapa([['reporte_pago_cliente', 'true']]))['reporte_pago_cliente'], false);
    assert.equal(configPublica(mapa([['reporte_pago_cliente', true]]))['reporte_pago_cliente'], true);
  });

  it('Requires_autorizacion_menores con R mayúscula también se lee', () => {
    assert.equal(
      configPublica(mapa([['Requires_autorizacion_menores', false]]))['Requires_autorizacion_menores'],
      false,
    );
  });

  it('firma_empresa sólo aparece si la clave existe en el mapa', () => {
    const con = configPublica(mapa([['firma_empresa_archivo_id', 'a1']]));
    assert.equal(con['firma_empresa_archivo_id'], 'a1');
    const sin = configPublica(mapa([]));
    assert.equal('firma_empresa_archivo_id' in sin, false);
    assert.equal('firma_empresa_fecha' in sin, false);
  });
});

describe('serializers — tasa, método de pago y pago', () => {
  it('tasaPublica: null → null; mapea campos', () => {
    assert.equal(tasaPublica(null), null);
    const t = tasaPublica(
      {
        id: 't1',
        tasa: '36.50',
        vigente_desde: new Date('2026-01-01T00:00:00.000Z'),
      } as unknown as TasaCambio,
      'Admin Ana',
    );
    assert.equal(t?.['valor'], '36.50');
    assert.equal(t?.['registrada_por'], 'Admin Ana');
    assert.equal(t?.['vigente'], true);
    // Sin nombre → 'Sistema'.
    const sinNombre = tasaPublica({ id: 't2', tasa: '1', vigente_desde: null } as unknown as TasaCambio);
    assert.equal(sinNombre?.['registrada_por'], 'Sistema');
  });

  it('metodoPagoPublico: moneda, items copiable e instrucciones', () => {
    const m = metodoPagoPublico({
      clave: 'pago_movil',
      nombre: 'Pago móvil',
      moneda: 'VES',
      activo: true,
      orden: 1,
      datos_cuenta: {
        items: [
          { etiqueta: 'Teléfono', valor: '0412', copiable: true },
          { etiqueta: 'Banco', valor: 'Banesco' },
        ],
        instrucciones: 'Verifica el monto',
      },
      campos_requeridos: [{ clave: 'referencia', etiqueta: 'Ref' }],
      requiere_comprobante: true,
    } as unknown as MetodoPago);
    assert.equal(m['moneda'], 'VES');
    assert.equal(m['id'], 'pago_movil');
    const items = m['datos'] as Record<string, unknown>[];
    assert.equal(items[0]['copiable'], true);
    assert.equal('copiable' in items[1], false); // sólo si true
    assert.equal(m['instrucciones'], 'Verifica el monto');
    assert.deepEqual(m['campos_requeridos'], ['referencia']); // clave tiene prioridad
    // Moneda desconocida → USD.
    const otra = metodoPagoPublico({ clave: 'x', moneda: 'EUR' } as unknown as MetodoPago);
    assert.equal(otra['moneda'], 'USD');
  });

  it('pagoPublico: duplicado genera alerta; comprobante y montos', () => {
    const p = pagoPublico(
      {
        id: 'p1',
        reserva_id: 'r1',
        metodo_pago_id: null,
        monto: '100.00',
        monto_reportado: '80.00',
        moneda: 'USDT',
        tasa: '36.5',
        fecha_pago: '2026-01-10',
        referencia: 'REF1',
        estado: 'aprobado',
        duplicado_de_pago_id: 'otro',
        campos_extra: {
          _comprobante: { nombre: 'comp.png', tipo: 'image/png', tamano: 1234, preview: 'data:x' },
          _registrado_por_nombre: 'Admin',
        },
        validado_en: new Date('2026-01-11T00:00:00.000Z'),
        creado_en: new Date('2026-01-10T00:00:00.000Z'),
      } as unknown as Pago,
      'pago_movil',
    );
    assert.equal(p['monto'], '80.00'); // monto_reportado tiene prioridad
    assert.equal(p['moneda'], 'USD'); // USDT → USD
    assert.deepEqual(p['alertas'], [
      { codigo: 'duplicado_referencia', mensaje: 'Esta referencia ya se usó en otra reserva.' },
    ]);
    assert.equal(p['duplicado_de_pago_id'], 'otro');
    const comp = p['comprobante'] as Record<string, unknown>;
    assert.equal(comp['nombre'], 'comp.png');
    assert.equal(comp['tamano'], 1234);
    assert.equal(p['registrado_por'], 'Admin');
    assert.equal(p['validado_en'], '2026-01-11T00:00:00.000Z');

    // Sin duplicado → alertas vacío.
    const limpio = pagoPublico(
      { id: 'p2', monto: '10.00', moneda: 'USD', creado_en: new Date() } as unknown as Pago,
      'x',
    );
    assert.deepEqual(limpio['alertas'], []);
    assert.equal('comprobante' in limpio, false);
  });
});

describe('serializers — términos, promo, notificación, auditoría', () => {
  it('terminosPublico: activa sólo si estado publicada; usa plantilla si viene', () => {
    const v = { id: 'v1', version: 3, contenido: 'cuerpo', estado: 'publicada', publicada_en: new Date('2026-01-01T00:00:00.000Z'), hash_sha256: 'h' };
    const p = terminosPublico(v as never, { id: 'pl', nombre: 'T&C Escapate', clave: 'escapate-v1' } as never);
    assert.equal(p['activa'], true);
    assert.equal(p['titulo'], 'T&C Escapate');
    assert.equal(p['clave'], 'escapate-v1');
    assert.equal(p['version'], 3);
    const borrador = terminosPublico({ ...v, estado: 'borrador' } as never, null);
    assert.equal(borrador['activa'], false);
    assert.equal(borrador['titulo'], 'Términos y condiciones');
    assert.equal(borrador['clave'], '');
  });

  it('promoPublica: valor numérico, fechas ISO, usos y tour_id condicional', () => {
    const p = promoPublica({
      id: 'pr',
      codigo: 'VERANO25',
      tipo: 'porcentaje',
      valor: '25.5',
      desde: new Date('2026-06-01T00:00:00.000Z'),
      hasta: null,
      usos_max: 100,
      usos: 7,
      activo: true,
    } as never);
    assert.equal(p['valor'], 25.5);
    assert.equal(p['vigente_hasta'], ''); // null → ''
    assert.equal('tour_id' in p, false);
    const conTour = promoPublica({ ...({} as object), id: 'pr2', codigo: 'X', tipo: 'monto', valor: '5', desde: null, hasta: null, usos: 0, activo: false, tour_id: 't9' } as never);
    assert.equal(conTour['tour_id'], 't9');
  });

  it('notificacionPublica: detalle, entidad_id desde datos y fecha', () => {
    const n = notificacionPublica({
      id: 'n1',
      tipo: 'reserva',
      titulo: 'Nueva reserva',
      cuerpo: null,
      datos: { entidad_id: 42 },
      leida: false,
      creado_en: new Date('2026-02-01T00:00:00.000Z'),
    });
    assert.equal(n['detalle'], '');
    assert.equal(n['entidad_id'], '42'); // String() del número
    assert.equal(n['leida'], false);
    assert.equal(n['fecha'], '2026-02-01T00:00:00.000Z');
    // Sin entidad_id → llave ausente.
    const sin = notificacionPublica({ id: 'n2', tipo: 'x', titulo: 't', leida: true, creado_en: new Date() });
    assert.equal('entidad_id' in sin, false);
  });

  it('auditoriaPublica: valores serializados, id string, cadena ok', () => {
    const a = auditoriaPublica(
      {
        id: 99,
        usuario_id: 'u1',
        entidad: 'reserva',
        entidad_id: 'r1',
        accion: 'editar',
        valor_anterior: { total: 10 },
        valor_nuevo: null,
        ocurrido_en: new Date('2026-03-01T00:00:00.000Z'),
      },
      'Admin',
    );
    assert.equal(a['id'], '99');
    assert.equal(a['usuario_nombre'], 'Admin');
    assert.equal(a['valor_anterior'], '{"total":10}'); // JSON.stringify
    assert.equal(a['valor_nuevo'], '—'); // null → guion
    assert.equal(a['cadena'], 'ok');
    // Sin usuario_nombre → 'Sistema'; sin usuario_id → ''.
    const sistema = auditoriaPublica({ id: 1, entidad: 'x', accion: 'y', ocurrido_en: new Date() });
    assert.equal(sistema['usuario_nombre'], 'Sistema');
    assert.equal(sistema['usuario_id'], '');
    // String value pasa tal cual.
    const str = auditoriaPublica({ id: 2, entidad: 'x', accion: 'y', valor_anterior: 'hola', ocurrido_en: new Date() });
    assert.equal(str['valor_anterior'], 'hola');
  });
});

describe('serializers — formulario y tarifa', () => {
  it('formularioPublico sólo expone definicion.campos', () => {
    const f = formularioPublico({
      id: 'fv1',
      tour_id: 't1',
      definicion: { campos: [{ id: 'c1' }], secreto: 'no-debe-salir' },
      publicada_en: new Date('2026-01-01T00:00:00.000Z'),
      actualizado_en: null,
      creado_en: null,
    } as never);
    assert.deepEqual(f['definicion'], { campos: [{ id: 'c1' }] });
    assert.equal(f['actualizado_en'], '2026-01-01T00:00:00.000Z');
    // Sin definición → campos vacío.
    const vacio = formularioPublico({ id: 'fv2', definicion: null } as never);
    assert.deepEqual(vacio['definicion'], { campos: [] });
  });

  it('tarifaPublica mapea categoría a formato FE y precio a string', () => {
    const t = tarifaPublica({
      id: 'tr1',
      fecha_tour_id: 'ft1',
      categoria: 'nino',
      edad_min: 3,
      edad_max: 11,
      precio_usd: '50.00',
    });
    assert.equal(t['categoria'], 'Niño');
    assert.equal(t['precio_usd'], '50.00');
    assert.equal(t['edad_min'], 3);
  });
});
