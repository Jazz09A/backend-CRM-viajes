import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  addDecimals,
  calcularPrecio,
  calcularPrecioAdministrado,
  categoriaPorEdad,
  detectarOpcionesAgotadas,
  edadEn,
  errorValidacion,
  esCampoComida,
  esCampoPuntoSalida,
  evaluarCondicion,
  horaLegible,
  isValidEmail,
  isValidPhone,
  multiplyDecimal,
  subtractDecimals,
  toDecimalString,
  validarCampo,
  validarCorreo,
  validarDocumento,
  validarDocumentosUnicos,
  validarFechaNacimiento,
  validarFormulario,
  validarNombre,
  validarTelefono,
  type CampoDef,
  type ContextoFormulario,
  type EntradaCalculo,
  type Respuesta,
} from './domain';

const campo = (parcial: Partial<CampoDef> & { id: string; tipo: string }): CampoDef => ({
  label: parcial.id,
  alcance: 'por_reserva',
  ...parcial,
});

const ctx = (parcial: Partial<ContextoFormulario>): ContextoFormulario => ({
  campos: [],
  globales: {},
  porPasajero: {},
  categorias: {},
  ...parcial,
});

const entrada = (parcial: Partial<EntradaCalculo>): EntradaCalculo => ({
  pasajeros: [],
  tarifas: [],
  camposExtra: [],
  respuestasGlobales: {},
  ...parcial,
});

describe('domain — detección de campos especiales', () => {
  it('esCampoComida reconoce grupo y los ids legados', () => {
    assert.equal(esCampoComida(campo({ id: 'x', tipo: 'select', grupo: 'comida' })), true);
    assert.equal(esCampoComida(campo({ id: 'almuerzo', tipo: 'select' })), true);
    assert.equal(esCampoComida(campo({ id: 'menu_infantil', tipo: 'select' })), true);
    assert.equal(esCampoComida(campo({ id: 'menu', tipo: 'select' })), false);
  });

  it('esCampoPuntoSalida reconoce fuente y el id legado', () => {
    assert.equal(esCampoPuntoSalida(campo({ id: 'x', tipo: 'select', fuente: 'puntos_salida' })), true);
    assert.equal(esCampoPuntoSalida(campo({ id: 'punto_abordaje', tipo: 'select' })), true);
    assert.equal(esCampoPuntoSalida(campo({ id: 'punto', tipo: 'select' })), false);
  });

  it('horaLegible formatea AM/PM y devuelve la entrada si no calza', () => {
    assert.equal(horaLegible('06:30'), '6:30 a. m.');
    assert.equal(horaLegible('00:15'), '12:15 a. m.');
    assert.equal(horaLegible('12:00'), '12:00 p. m.');
    assert.equal(horaLegible('23:59'), '11:59 p. m.');
    assert.equal(horaLegible('7:05'), '7:05 a. m.');
    // Inválidas devuelven la entrada tal cual (documentado).
    assert.equal(horaLegible('24:00'), '24:00');
    assert.equal(horaLegible('6:5'), '6:5');
    assert.equal(horaLegible('abc'), 'abc');
    assert.equal(horaLegible(''), '');
    assert.equal(horaLegible(' 06:30 '), '6:30 a. m.'); // hace trim
  });
});

describe('domain — decimales', () => {
  it('toDecimalString sanea basura a 0.00', () => {
    assert.equal(toDecimalString(null), '0.00');
    assert.equal(toDecimalString(undefined), '0.00');
    assert.equal(toDecimalString(''), '0.00');
    assert.equal(toDecimalString('abc'), '0.00');
    assert.equal(toDecimalString('  '), '0.00');
  });

  it('toDecimalString tiene las mismas rarezas del port frontend', () => {
    // "1.234,56" → replace(',', '.') → "1.234.56" → parseFloat para en el
    // segundo punto → 1.234 → "1.23" (NO 1234.56). Comportamiento real.
    assert.equal(toDecimalString('1.234,56'), '1.23');
    // Notación científica: la "e" se elimina → "1e3" → "13".
    assert.equal(toDecimalString('1e3'), '13.00');
    assert.equal(toDecimalString('-5'), '-5.00');
    assert.equal(toDecimalString('5-'), '5.00'); // parseFloat se detiene
    assert.equal(toDecimalString('.5'), '0.50');
    assert.equal(toDecimalString('12,5'), '12.50');
    assert.equal(toDecimalString(7), '7.00');
  });

  it('add/subtract/multiply usan centavos y no arrastran flotantes', () => {
    assert.equal(addDecimals('0.10', '0.20'), '0.30');
    // "1.005" → toFixed(2) sobre el float 1.0049999… → "1.00" (redondeo
    // half-even del binario, documentado — no es half-up decimal).
    assert.equal(addDecimals('1.005', '0'), '1.00');
    assert.equal(subtractDecimals('0.30', '0.10'), '0.20');
    assert.equal(subtractDecimals('0.00', '0.01'), '-0.01');
    assert.equal(multiplyDecimal('19.99', 3), '59.97');
    assert.equal(multiplyDecimal('10.00', 0.5), '5.00');
    // Factor NaN/Infinity produce literales rotos que addDecimals luego sanea.
    assert.equal(multiplyDecimal('10.00', NaN), 'NaN');
    assert.equal(addDecimals('NaN', '1.00'), '1.00'); // toDecimalString("NaN") → 0.00
  });
});

describe('domain — validadores de titular', () => {
  it('validarNombre: vacío, largo máximo y bordes', () => {
    assert.equal(validarNombre('').ok, false);
    assert.equal(validarNombre('   ').ok, false);
    assert.equal(validarNombre('x'.repeat(120)).ok, true);
    assert.equal(validarNombre('x'.repeat(121)).ok, false);
    assert.equal(validarNombre('  Ana  ').ok, true); // trim
  });

  it('validarDocumento por tipo y bordes de longitud', () => {
    assert.equal(validarDocumento('V', '123456').ok, true); // mínimo
    assert.equal(validarDocumento('V', '123456789').ok, true); // máximo
    assert.equal(validarDocumento('V', '12345').ok, false);
    assert.equal(validarDocumento('V', '1234567890').ok, false);
    assert.equal(validarDocumento('V', '12345A').ok, false);
    assert.equal(validarDocumento('E', '123456').ok, true);
    assert.equal(validarDocumento('P', 'A123456').ok, true);
    assert.equal(validarDocumento('P', 'A12345').ok, true); // 6 chars = mínimo
    assert.equal(validarDocumento('P', 'A1234').ok, false); // 5 chars
    assert.equal(validarDocumento('P', 'A12345678901').ok, true); // 12 chars
    assert.equal(validarDocumento('P', 'A123456789012').ok, false);
    assert.equal(validarDocumento('P', 'AB 1234').ok, false); // espacio no vale
    // OTRO y tipos desconocidos comparten la regla 3-32.
    assert.equal(validarDocumento('OTRO', 'ab').ok, false);
    assert.equal(validarDocumento('OTRO', 'DOC-1234').ok, true);
    assert.equal(validarDocumento('X', 'ab').ok, false); // desconocido → regla OTRO
    assert.equal(validarDocumento('X', 'x'.repeat(33)).ok, false);
  });

  it('validarFechaNacimiento: formato, fecha real, futuro y edad máxima', () => {
    assert.equal(validarFechaNacimiento('').ok, false);
    assert.equal(validarFechaNacimiento('14/05/1990').ok, false);
    assert.equal(validarFechaNacimiento('1990-5-4').ok, false); // sin padding
    assert.equal(validarFechaNacimiento('2023-02-29').ok, false); // no bisiesto
    assert.equal(validarFechaNacimiento('2024-02-29').ok, true); // bisiesto real
    assert.equal(validarFechaNacimiento('2999-01-01').ok, false); // futuro
    assert.equal(validarFechaNacimiento('1900-01-01').ok, false); // >120 años siempre
    assert.equal(validarFechaNacimiento('2000-06-15').ok, true);
  });

  it('edadEn: cumpleaños exacto, strings con hora y fechas inválidas', () => {
    assert.equal(edadEn('1990-05-14', '2024-05-13'), 33);
    assert.equal(edadEn('1990-05-14', '2024-05-14'), 34);
    assert.equal(edadEn('1990-05-14', '2024-04-30'), 33);
    // Divergencia documentada del port: slice(0,10) acepta datetimes —
    // "1990-05-14T99:99:99" cuenta como 1990-05-14 aunque la hora sea basura.
    assert.equal(edadEn('1990-05-14T99:99:99', '2024-05-14'), 34);
    // Referencia anterior al nacimiento → edad negativa (no null).
    assert.equal(edadEn('2020-01-01', '2010-01-01'), -10);
    assert.equal(edadEn('', '2024-01-01'), null);
    assert.equal(edadEn('no-fecha', '2024-01-01'), null);
    assert.equal(edadEn('1990-05-14', 'basura'), null);
  });

  it('validarTelefono y validarCorreo en bordes', () => {
    assert.equal(validarTelefono('').ok, false);
    assert.equal(validarTelefono('+58 412 1234567').ok, true);
    assert.equal(validarTelefono('1234567890').ok, true); // 10 dígitos mínimo
    assert.equal(validarTelefono('123456789012345').ok, true); // 15 máximo
    assert.equal(validarTelefono('123456789').ok, false);
    assert.equal(validarTelefono('1234567890123456').ok, false);
    assert.equal(validarTelefono('abc').ok, false);

    assert.equal(validarCorreo('').ok, false);
    assert.equal(validarCorreo('a@b.co').ok, true);
    assert.equal(validarCorreo('a@b.c').ok, false); // TLD <2
    assert.equal(validarCorreo('a b@c.com').ok, false);
    assert.equal(validarCorreo('a@b').ok, false);
    assert.equal(isValidEmail('  A@B.COM '), true); // trim+lower
    assert.equal(isValidPhone('++--12 34'), false);
  });

  it('validarDocumentosUnicos: duplicados entre TIPOS distintos colisionan', () => {
    const ok = validarDocumentosUnicos([
      { tipo_doc: 'V', documento: '123456' },
      { tipo_doc: 'P', documento: 'A12345' },
    ]);
    assert.equal(ok.ok, true);

    // Quirk real: la clave ignora el tipo para V/E/P — "V:123456" y
    // "P:123456" (sólo dígitos) producen la MISMA clave → duplicado.
    const colision = validarDocumentosUnicos([
      { tipo_doc: 'V', documento: '12.345-6' },
      { tipo_doc: 'P', documento: '123456' },
    ]);
    assert.equal(colision.ok, false);
    assert.equal(colision.indiceDuplicado, 1);

    // OTRO sí distingue por tipo y normaliza espacios.
    const otro = validarDocumentosUnicos([
      { tipo_doc: 'OTRO', documento: 'DOC  1' },
      { tipo_doc: 'OTRO', documento: 'doc 1' },
    ]);
    assert.equal(otro.ok, false);

    // Documentos vacíos se saltan (no bloquean).
    const vacios = validarDocumentosUnicos([
      { tipo_doc: 'V', documento: '   ' },
      { tipo_doc: 'V', documento: '' },
      { tipo_doc: 'V', documento: '123456' },
    ]);
    assert.equal(vacios.ok, true);
  });
});

describe('domain — calcularPrecio', () => {
  const tarifas = [
    { categoria: 'adulto', precio_usd: '100.00' },
    { categoria: 'nino', precio_usd: '50.00' },
  ];

  it('sin tarifa para una categoría avisa y no cobra', () => {
    const r = calcularPrecio(
      entrada({
        pasajeros: [{ categoria: 'infante', respuestas: {} }],
        tarifas,
      }),
    );
    assert.equal(r.total_usd, '0.00');
    assert.equal(r.advertencias.length, 1);
    assert.match(r.advertencias[0], /infante/);
    assert.equal(r.lineas.length, 0);
  });

  it('pasajeros vacíos → todo en cero', () => {
    const r = calcularPrecio(entrada({ tarifas }));
    assert.deepEqual(r.lineas, []);
    assert.equal(r.total_usd, '0.00');
    assert.equal(r.saldo_usd, '0.00');
  });

  it('extras: cantidad global 0 ignora los valores por pasajero', () => {
    const extra = { id: 'toldo', label: 'Toldo', precio_usd: '10.00', cantidad_max: 5 };
    const base = {
      tarifas,
      camposExtra: [extra],
      pasajeros: [
        { categoria: 'adulto', respuestas: { toldo: 3 } },
        { categoria: 'adulto', respuestas: { toldo: 2 } },
      ],
    };
    // Sin global → suma pasajeros (3+2=5).
    const sinGlobal = calcularPrecio(entrada(base));
    assert.equal(sinGlobal.lineas.find((l) => l.concepto === 'Toldo')?.cantidad, 5);
    // Global 0 → aCantidad devuelve 0 (no null) → gana y suprime pasajeros.
    const conCero = calcularPrecio(
      entrada({ ...base, respuestasGlobales: { toldo: 0 } }),
    );
    assert.equal(conCero.lineas.find((l) => l.concepto === 'Toldo'), undefined);
    // Global NaN (string "NaN" o number) → aCantidad null → cae a pasajeros.
    const conNaN = calcularPrecio(
      entrada({ ...base, respuestasGlobales: { toldo: NaN } }),
    );
    assert.equal(conNaN.lineas.find((l) => l.concepto === 'Toldo')?.cantidad, 5);
  });

  it('extras con cantidad negativa, decimal o sobre el máximo', () => {
    const extra = { id: 'toldo', label: 'Toldo', precio_usd: '10.00', cantidad_max: 4 };
    const r = calcularPrecio(
      entrada({
        tarifas,
        camposExtra: [extra],
        pasajeros: [{ categoria: 'adulto', respuestas: { toldo: -2 } }],
      }),
    );
    assert.equal(r.lineas.find((l) => l.concepto === 'Toldo'), undefined); // <=0 skip

    const decimal = calcularPrecio(
      entrada({
        tarifas,
        camposExtra: [extra],
        pasajeros: [{ categoria: 'adulto', respuestas: { toldo: 2.5 } }],
      }),
    );
    // 2.5 unidades sí se cobran (no hay validación de entero aquí).
    assert.equal(decimal.lineas.find((l) => l.concepto === 'Toldo')?.total_usd, '25.00');

    const exceso = calcularPrecio(
      entrada({
        tarifas,
        camposExtra: [extra],
        pasajeros: [{ categoria: 'adulto', respuestas: { toldo: 9 } }],
      }),
    );
    assert.match(exceso.advertencias[0], /supera el máximo/);
  });

  it('promoción porcentaje >100% se topa al total; monto negativo sube el precio', () => {
    const base = {
      tarifas,
      pasajeros: [{ categoria: 'adulto', respuestas: {} }],
    };
    const exceso = calcularPrecio(entrada({ ...base, promocion: { tipo: 'porcentaje' as const, valor: 150 } }));
    assert.equal(exceso.total_usd, '0.00');
    assert.equal(exceso.descuento_usd, '100.00'); // descuento = base

    const negativo = calcularPrecio(entrada({ ...base, promocion: { tipo: 'monto' as const, valor: -20 } }));
    // Descuento negativo → total = base - (-20) = 120 (documentado).
    assert.equal(negativo.total_usd, '120.00');
  });

  it('saldoPrevio mayor que el total deja saldo 0; negativo lo infla', () => {
    const base = {
      tarifas,
      pasajeros: [{ categoria: 'adulto', respuestas: {} }],
    };
    const cubierto = calcularPrecio(entrada({ ...base, saldoPrevio: '150.00' }));
    assert.equal(cubierto.saldo_usd, '0.00');
    assert.equal(cubierto.total_usd, '100.00'); // el total no cambia

    const negativo = calcularPrecio(entrada({ ...base, saldoPrevio: '-10.00' }));
    assert.equal(negativo.saldo_usd, '110.00'); // 100 - (-10)
  });
});

describe('domain — calcularPrecioAdministrado', () => {
  const tarifas = [{ categoria: 'adulto', precio_usd: '100.00' }];

  it('cantidad NaN en línea admin genera línea "NaN" pero no contamina totales', () => {
    // Mismo bug documentado del frontend: Math.max(0, NaN) = NaN y
    // NaN <= 0 es false → la línea entra con total_usd "NaN"; addDecimals
    // la sanea a 0 al sumar.
    const r = calcularPrecioAdministrado({
      pasajeros: [{ categoria: 'adulto' }],
      tarifas,
      lineas: [{ concepto: 'Toldo', cantidad: NaN, precio_unit_usd: '10.00' }],
    });
    const linea = r.lineas.find((l) => l.concepto === 'Toldo');
    assert.equal(linea?.total_usd, 'NaN');
    assert.equal(linea?.cantidad, NaN);
    assert.equal(r.adicionales_usd, '0.00');
    assert.equal(r.total_usd, '100.00');
  });

  it('cantidad fraccionaria se trunca; cero/negativa se omite', () => {
    const r = calcularPrecioAdministrado({
      pasajeros: [{ categoria: 'adulto' }],
      tarifas,
      lineas: [
        { concepto: 'A', cantidad: 2.9, precio_unit_usd: '10.00' },
        { concepto: 'B', cantidad: -3, precio_unit_usd: '10.00' },
        { concepto: 'C', cantidad: 0, precio_unit_usd: '10.00' },
      ],
    });
    assert.equal(r.lineas.find((l) => l.concepto === 'A')?.cantidad, 2);
    assert.equal(r.lineas.find((l) => l.concepto === 'A')?.total_usd, '20.00');
    assert.equal(r.lineas.find((l) => l.concepto === 'B'), undefined);
    assert.equal(r.lineas.find((l) => l.concepto === 'C'), undefined);
  });

  it('ajustes: descuento con motivo, recargo suma a adicionales, tipo raro = recargo', () => {
    const r = calcularPrecioAdministrado({
      pasajeros: [{ categoria: 'adulto' }],
      tarifas,
      ajustes: [
        { tipo: 'descuento', monto_usd: '10.00', motivo: '  Cortesía  ' },
        { tipo: 'recargo', monto_usd: '5.00' },
        { tipo: 'otro' as 'descuento', monto_usd: '1.00' }, // cualquier no-descuento → recargo
      ],
    });
    // subtotal 100 + recargos 6 → base 106 - descuento 10 = 96.
    assert.equal(r.subtotal_usd, '100.00');
    assert.equal(r.adicionales_usd, '6.00');
    assert.equal(r.descuento_usd, '10.00');
    assert.equal(r.total_usd, '96.00');
    const desc = r.lineas.find((l) => l.detalle === 'Descuento administrativo');
    assert.equal(desc?.concepto, 'Cortesía'); // motivo trim
    assert.equal(desc?.total_usd, '-10.00');
    const rec = r.lineas.find((l) => l.detalle === 'Recargo administrativo');
    assert.equal(rec?.concepto, 'Recargo'); // motivo ausente → etiqueta por tipo
  });

  it('descuento mayor que la base topa el total a 0; monto basura → 0.00', () => {
    const r = calcularPrecioAdministrado({
      pasajeros: [{ categoria: 'adulto' }],
      tarifas,
      ajustes: [
        { tipo: 'descuento', monto_usd: '500.00' },
        { tipo: 'descuento', monto_usd: 'basura' },
      ],
    });
    assert.equal(r.total_usd, '0.00');
    assert.equal(r.saldo_usd, '0.00');
  });
});

describe('domain — categoría por edad y opciones agotadas', () => {
  const tarifas = [
    { categoria: 'infante', edad_min: 0, edad_max: 2 },
    { categoria: 'nino', edad_min: 3, edad_max: 11 },
    { categoria: 'adulto', edad_min: 12, edad_max: 120 },
  ];

  it('categoriaPorEdad: bordes exactos y solapamientos (gana el primero)', () => {
    assert.equal(categoriaPorEdad(tarifas, '2024-06-01', '2024-05-30'), 'infante'); // 2 días
    assert.equal(categoriaPorEdad(tarifas, '2024-06-01', '2021-06-01'), 'nino'); // 3 años
    assert.equal(categoriaPorEdad(tarifas, '2024-06-01', '2012-06-01'), 'adulto'); // 12 años
    // Solapamiento: adulto 12-120 y otro rango 10-15 → gana el primero en la lista.
    const solapado = [
      { categoria: 'A', edad_min: 10, edad_max: 15 },
      { categoria: 'B', edad_min: 12, edad_max: 20 },
    ];
    assert.equal(categoriaPorEdad(solapado, '2024-01-01', '2010-01-01'), 'A'); // edad 14
    assert.equal(categoriaPorEdad(tarifas, '2024-01-01', 'basura'), null);
    assert.equal(categoriaPorEdad(tarifas, 'basura', '2000-01-01'), null);
  });

  it('detectarOpcionesAgotadas: cupo<=agotados, colisión de claves y respuestas', () => {
    const cupos = [
      { campo_id: 'comida', opcion: 'vegano', cupo: 5, agotados: 5 }, // lleno
      { campo_id: 'comida', opcion: 'normal', cupo: 5, agotados: 2 }, // hay cupo
      { campo_id: 'punto', opcion: 'x', cupo: 0, agotados: 0 }, // cupo 0 → agotado
      { campo_id: 'punto', opcion: 'y', cupo: -1, agotados: 0 }, // cupo negativo → agotado
    ];
    const agotadas = detectarOpcionesAgotadas(cupos, { comida: 'vegano' });
    assert.equal(agotadas['comida:vegano'], true);
    assert.equal(agotadas['comida:normal'], undefined);
    assert.equal(agotadas['punto:x'], true);
    assert.equal(agotadas['punto:y'], true);

    // Colisión documentada: campo "a:b" + opción "c" ≡ campo "a" + opción "b:c".
    const colision = detectarOpcionesAgotadas(
      [{ campo_id: 'a', opcion: 'b:c', cupo: 1, agotados: 1 }],
      { 'a:b': 'c' },
    );
    assert.equal(colision['a:b:c'], true);

    // Valores no-string en respuestas se ignoran.
    const numeros = detectarOpcionesAgotadas(
      [{ campo_id: 'n', opcion: '1', cupo: 1, agotados: 1 }],
      { n: 1 },
    );
    assert.equal(numeros['n:1'], true); // del cupo, no de la respuesta
  });
});

describe('domain — motor de condiciones', () => {
  it('sin operadores reconocidos → true (fail-open)', () => {
    assert.equal(evaluarCondicion({ campo: 'x', desconocido: 1 }, {}), true);
    assert.equal(evaluarCondicion({ campo: 'x' }, { x: 'cualquier' }), true);
  });

  it('igual_a/distinto_de/en/no_vacio con valores faltantes', () => {
    // Campo ausente → actual ?? null → null.
    assert.equal(evaluarCondicion({ campo: 'x', igual_a: null }, {}), true);
    assert.equal(evaluarCondicion({ campo: 'x', igual_a: 'y' }, {}), false);
    assert.equal(evaluarCondicion({ campo: 'x', distinto_de: 'y' }, {}), true); // null ≠ 'y'
    assert.equal(evaluarCondicion({ campo: 'x', no_vacio: true }, {}), false);
    // en no-array → lista vacía → false.
    assert.equal(evaluarCondicion({ campo: 'x', en: 'no-array' }, { x: 'no-array' }), false);
    assert.equal(evaluarCondicion({ campo: 'x', en: ['a', 'b'] }, { x: 'b' }), true);
    // Múltiples predicados se combinan con AND.
    assert.equal(
      evaluarCondicion({ campo: 'x', igual_a: 'a', no_vacio: true }, { x: 'a' }),
      true,
    );
    assert.equal(
      evaluarCondicion({ campo: 'x', igual_a: 'a', distinto_de: 'a' }, { x: 'a' }),
      false,
    );
  });
});

describe('domain — validarCampo', () => {
  it('tipo no soportado: obligatorio falla, opcional pasa', () => {
    const raro = campo({ id: 'raro', tipo: 'signature-pad', obligatorio: true });
    assert.equal(validarCampo(raro, 'x', {}).ok, false);
    assert.match(validarCampo(raro, 'x', {}).mensaje ?? '', /no se puede mostrar/);
    assert.equal(validarCampo({ ...raro, obligatorio: false }, 'x', {}).ok, true);
    assert.equal(validarCampo({ ...raro, obligatorio: true }, null, {}).ok, false);
  });

  it('undefined NO es vacío: cae a validación de tipo (documentado)', () => {
    // validarFormulario convierte ausencias a null antes de llamar, pero
    // validarCampo directo con undefined da error de tipo, no "obligatoria".
    const texto = campo({ id: 't', tipo: 'text', obligatorio: true });
    const r = validarCampo(texto, undefined as unknown as Respuesta, {});
    assert.equal(r.ok, false);
    assert.match(r.mensaje ?? '', /texto/);
  });

  it('opción agotada se detecta antes que la obligatoriedad', () => {
    const sel = campo({
      id: 'comida',
      tipo: 'select',
      obligatorio: true,
      opciones: [{ valor: 'veg', label: 'Veg' }],
    });
    assert.equal(validarCampo(sel, 'veg', { 'comida:veg': true }).ok, false);
    assert.match(validarCampo(sel, 'veg', { 'comida:veg': true }).mensaje ?? '', /agotó/);
  });

  it('text/textarea: tipos, trim en vacío y max_length', () => {
    const t = campo({ id: 't', tipo: 'text' });
    assert.equal(validarCampo(t, null, {}).ok, true); // opcional vacío
    assert.equal(validarCampo(t, '   ', {}).ok, true); // espacios = vacío
    assert.equal(validarCampo({ ...t, obligatorio: true }, '   ', {}).ok, false);
    assert.equal(validarCampo(t, 42 as unknown as Respuesta, {}).ok, false);
    assert.equal(validarCampo({ ...t, max_length: 3 }, 'abcd', {}).ok, false);
    const ta = campo({ id: 'ta', tipo: 'textarea' });
    assert.equal(validarCampo(ta, 'x'.repeat(1000), {}).ok, true);
    assert.equal(validarCampo(ta, 'x'.repeat(1001), {}).ok, false);
  });

  it('select sin opciones rechaza todo; con opciones exige membresía', () => {
    const sin = campo({ id: 's', tipo: 'select' });
    assert.equal(validarCampo(sin, 'cualquiera', {}).ok, false); // opciones ?? [] → nada vale
    const con = campo({
      id: 's',
      tipo: 'select',
      opciones: [{ valor: 'a', label: 'A' }],
    });
    assert.equal(validarCampo(con, 'a', {}).ok, true);
    assert.equal(validarCampo(con, 'b', {}).ok, false);
    assert.equal(validarCampo(con, 1 as unknown as Respuesta, {}).ok, false);
  });

  it('multiselect: no-array, no-strings, duplicados y opciones desconocidas', () => {
    const m = campo({
      id: 'm',
      tipo: 'multiselect',
      opciones: [
        { valor: 'a', label: 'A' },
        { valor: 'b', label: 'B' },
      ],
    });
    assert.equal(validarCampo(m, [], {}).ok, true); // vacío opcional
    assert.equal(validarCampo(m, 'a', {} as never as Record<string, boolean>).ok, false);
    assert.equal(validarCampo(m, ['a', 1] as unknown as Respuesta, {}).ok, false);
    assert.equal(validarCampo(m, ['a', 'a'], {}).ok, false); // duplicado
    assert.equal(validarCampo(m, ['a', 'zzz'], {}).ok, false); // fuera de lista
    assert.equal(validarCampo(m, ['a', 'b'], {}).ok, true);
    // Orden distinto sigue siendo válido (es conjunto, no secuencia).
    assert.equal(validarCampo(m, ['b', 'a'], {}).ok, true);
  });

  it('checkbox exige boolean; false es un valor VÁLIDO aunque sea obligatorio', () => {
    const c = campo({ id: 'c', tipo: 'checkbox', obligatorio: true });
    assert.equal(validarCampo(c, false, {}).ok, true); // documentado: false no es "vacío"
    assert.equal(validarCampo(c, true, {}).ok, true);
    assert.equal(validarCampo(c, 'si', {} as never as Record<string, boolean>).ok, false);
    assert.equal(validarCampo(c, null, {}).ok, false); // null sí es vacío
  });

  it('number: no finitos, min/max contradictorios y step 0', () => {
    const n = campo({ id: 'n', tipo: 'number' });
    assert.equal(validarCampo(n, NaN, {}).ok, false);
    assert.equal(validarCampo(n, Infinity, {}).ok, false);
    assert.equal(validarCampo(n, '5' as unknown as Respuesta, {}).ok, false);
    const rango = campo({ id: 'n', tipo: 'number', min: 1, max: 10 });
    assert.equal(validarCampo(rango, 0, {}).ok, false);
    assert.equal(validarCampo(rango, 11, {}).ok, false);
    assert.equal(validarCampo(rango, 5, {}).ok, true);
    // min > max contradictorio: todo valor falla (gana el primer chequeo).
    const contradictorio = campo({ id: 'n', tipo: 'number', min: 10, max: 1 });
    assert.equal(validarCampo(contradictorio, 5, {}).ok, false);
    // step 0 → esMultiploDe siempre true.
    const paso0 = campo({ id: 'n', tipo: 'number', step: 0 });
    assert.equal(validarCampo(paso0, 3.14159, {}).ok, true);
    const paso2 = campo({ id: 'n', tipo: 'number', step: 2 });
    assert.equal(validarCampo(paso2, 4, {}).ok, true);
    assert.equal(validarCampo(paso2, 5, {}).ok, false);
  });

  it('date exige YYYY-MM-DD real sin trim ni padding laxo', () => {
    const d = campo({ id: 'd', tipo: 'date' });
    assert.equal(validarCampo(d, '2026-12-14', {}).ok, true);
    assert.equal(validarCampo(d, '2026-02-30', {}).ok, false); // fecha inexistente
    assert.equal(validarCampo(d, '2026-1-4', {}).ok, false); // sin padding
    assert.equal(validarCampo(d, ' 2026-01-04', {}).ok, false); // espacios no se recortan
    assert.equal(validarCampo(d, '2026-01-04T00:00:00Z', {}).ok, false);
    assert.equal(validarCampo(d, '14/01/2026', {}).ok, false);
    assert.equal(validarCampo(d, 20260104 as unknown as Respuesta, {}).ok, false);
  });

  it('extra exige entero no negativo dentro de cantidad_max', () => {
    const e = campo({ id: 'e', tipo: 'extra', cantidad_max: 3 });
    assert.equal(validarCampo(e, 0, {}).ok, true);
    assert.equal(validarCampo(e, 3, {}).ok, true);
    assert.equal(validarCampo(e, 4, {}).ok, false);
    assert.equal(validarCampo(e, 1.5, {}).ok, false); // no entero
    assert.equal(validarCampo(e, -1, {}).ok, false);
    assert.equal(validarCampo(e, NaN, {}).ok, false);
    assert.equal(validarCampo(e, '2' as unknown as Respuesta, {}).ok, false);
    // Sin cantidad_max no hay techo.
    assert.equal(validarCampo(campo({ id: 'e2', tipo: 'extra' }), 999, {}).ok, true);
  });
});

describe('domain — validarFormulario', () => {
  it('campo por_reserva oculto por visible_si no se valida', () => {
    const oculto = campo({
      id: 'detalle',
      tipo: 'text',
      obligatorio: true,
      visible_si: { campo: 'modo', igual_a: 'especial' },
    });
    const r = validarFormulario(
      ctx({
        campos: [oculto, campo({ id: 'modo', tipo: 'select', opciones: [{ valor: 'normal', label: 'N' }] })],
        globales: { modo: 'normal' }, // detalle oculto → no exige valor
      }),
    );
    assert.equal(r.ok, true);
  });

  it('visible_si que apunta a campo de otro alcance se ignora (fail-open)', () => {
    // Campo por_reserva que depende de uno por_pasajero → dependenciaFueraDeAlcance → visible.
    const c = campo({
      id: 'global_dep',
      tipo: 'text',
      obligatorio: true,
      visible_si: { campo: 'por_pax', igual_a: 'x' },
    });
    const r = validarFormulario(
      ctx({
        campos: [
          c,
          campo({ id: 'por_pax', tipo: 'text', alcance: 'por_pasajero' }),
        ],
        categorias: { p1: 'adulto' },
        porPasajero: { p1: { por_pax: 'y' } }, // la condición NO se cumple, pero se ignora
      }),
    );
    // global_dep queda visible → obligatorio → falla por falta de valor.
    assert.equal(r.ok, false);
    assert.ok(r.errores.some((e) => e.campo === 'global_dep'));
  });

  it('permite_por_pasajero valida cada respuesta por pasajero, no la global', () => {
    const c = campo({
      id: 'alergia',
      tipo: 'text',
      obligatorio: true,
      permite_por_pasajero: true,
    });
    const r = validarFormulario(
      ctx({
        campos: [c],
        categorias: { p1: 'adulto', p2: 'nino' },
        globales: { alergia: 'global-ok' }, // la global NO salva a los por-pasajero
        porPasajero: {
          p1: { alergia: '  ' }, // vacío → falla
          p2: { alergia: 'mariscos' },
        },
      }),
    );
    assert.equal(r.ok, false);
    assert.deepEqual(
      r.errores.map((e) => e.pasajero_ref),
      ['p1'],
    );
  });

  it('por_pasajero aplica_a filtra por categoría; sin categoría no se valida', () => {
    const soloNinos = campo({
      id: 'autorizacion',
      tipo: 'text',
      obligatorio: true,
      alcance: 'por_pasajero',
      aplica_a: ['nino'],
    });
    const r = validarFormulario(
      ctx({
        campos: [soloNinos],
        categorias: { p1: 'adulto', p2: 'nino', p3: 'desconocida' },
        porPasajero: {}, // nadie tiene valor → nino falla, adulto no aplica
      }),
    );
    assert.equal(r.ok, false);
    assert.deepEqual(
      r.errores.map((e) => e.pasajero_ref),
      ['p2'],
    );
  });

  it('visible_si de por_pasajero evalúa globales + respuestas del pasajero', () => {
    const condicional = campo({
      id: 'detalle_pax',
      tipo: 'text',
      obligatorio: true,
      alcance: 'por_pasajero',
      visible_si: { campo: 'tiene_alergia', igual_a: 'si' },
    });
    const r = validarFormulario(
      ctx({
        campos: [condicional],
        categorias: { p1: 'adulto', p2: 'nino' },
        porPasajero: {
          p1: { tiene_alergia: 'si' }, // visible → detalle_pax obligatorio → falla
          p2: { tiene_alergia: 'no' }, // oculto → no se valida
        },
      }),
    );
    assert.equal(r.ok, false);
    assert.deepEqual(
      r.errores.map((e) => e.pasajero_ref),
      ['p1'],
    );
  });

  it('pasajero sin entrada en porPasajero → sus campos por_pasajero fallan si obligatorios', () => {
    const c = campo({ id: 'cedula', tipo: 'text', obligatorio: true, alcance: 'por_pasajero' });
    const r = validarFormulario(
      ctx({ campos: [c], categorias: { p1: 'adulto' }, porPasajero: {} }),
    );
    assert.equal(r.ok, false);
    assert.equal(r.errores[0].pasajero_ref, 'p1');
  });
});

describe('domain — errorValidacion', () => {
  it('produce ApiError 422 con detalles RFC 7807', () => {
    const error = errorValidacion([
      { campo: 'nombre', mensaje: 'Obligatorio' },
      { campo: 'edad', mensaje: 'Inválida' },
    ]);
    assert.equal(error.getStatus(), 422);
    assert.equal(error.codigo, 'VALIDACION');
    const cuerpo = error.getResponse() as Record<string, unknown>;
    assert.deepEqual(cuerpo['detalles'], [
      { campo: 'nombre', codigo: 'VALIDACION', mensaje: 'Obligatorio' },
      { campo: 'edad', codigo: 'VALIDACION', mensaje: 'Inválida' },
    ]);
    // Título personalizable.
    const otro = errorValidacion([{ campo: 'x', mensaje: 'y' }], 'Otro título');
    assert.equal(
      (otro.getResponse() as Record<string, unknown>)['mensaje'],
      'Otro título',
    );
  });
});
