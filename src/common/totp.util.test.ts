import assert from 'node:assert/strict';
import { describe, it, mock } from 'node:test';
import { base32Decode, verificarTotp } from './totp.util';

/**
 * TOTP RFC 6238 (HMAC-SHA1, 30 s, 6 dígitos) con los vectores oficiales
 * del RFC para el secreto ASCII "12345678901234567890".
 */

// "12345678901234567890" en base32.
const SECRETO_RFC = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp.util — base32Decode', () => {
  it('decodifica vectores conocidos de base32', () => {
    assert.equal(base32Decode('').length, 0);
    // "f" → "MY======"; "fo" → "MZXQ===="; "foo" → "MZXW6===".
    assert.equal(base32Decode('MY').toString(), 'f');
    assert.equal(base32Decode('MZXQ').toString(), 'fo');
    assert.equal(base32Decode('MZXW6').toString(), 'foo');
    // Vector RFC 4648: "Hello!\xDE\xAD\xBE\xEF".
    assert.deepEqual([...base32Decode('JBSWY3DPEHPK3PXP')], [
      72, 101, 108, 108, 111, 33, 0xde, 0xad, 0xbe, 0xef,
    ]);
  });

  it('tolera minúsculas, espacios y padding', () => {
    assert.deepEqual(base32Decode('  mzxw6==='), base32Decode('MZXW6'));
  });

  it('los caracteres inválidos se saltan en silencio (documentado)', () => {
    // "M!Z#XW6" → indexOf -1 → continue → decodifica como "MZXW6" = "foo".
    assert.equal(base32Decode('M!Z#XW6').toString(), 'foo');
    // Un secreto 100% inválido produce buffer vacío.
    assert.equal(base32Decode('!@#$%').length, 0);
  });
});

describe('totp.util — verificarTotp', () => {
  // Vectores RFC 6238 (SHA-1, 8 dígitos en el RFC; aquí se usan los 6
  // últimos porque el sistema emite 6 dígitos).
  const casos: [number, string][] = [
    [59, '287082'], // T=59  → RFC 94287082
    [1111111109, '081804'], // T=1111111109 → RFC 07081804
    [1234567890, '005924'], // T=1234567890 → RFC 89005924
    [2000000000, '279037'], // T=2000000000 → RFC 69279037
    [20000000000, '353130'], // T=20000000000 → RFC 65353130
  ];

  for (const [epoch, esperado] of casos) {
    it(`verifica el vector T=${epoch} → ${esperado}`, () => {
      mock.timers.enable({ apis: ['Date'], now: epoch * 1000 });
      try {
        assert.equal(verificarTotp(SECRETO_RFC, esperado), true);
      } finally {
        mock.timers.reset();
      }
    });
  }

  it('un código incorrecto en el mismo instante se rechaza', () => {
    mock.timers.enable({ apis: ['Date'], now: 59_000 });
    try {
      assert.equal(verificarTotp(SECRETO_RFC, '000000'), false);
      // Ni siquiera con los otros 5 dígitos del vector de 8.
      assert.equal(verificarTotp(SECRETO_RFC, '942870'), false);
    } finally {
      mock.timers.reset();
    }
  });

  it('la ventana ±1 acepta el paso anterior y siguiente', () => {
    // En T=59 el paso actual es 1; el código del paso 0 (T≈0-29) vale 755224.
    mock.timers.enable({ apis: ['Date'], now: 59_000 });
    try {
      assert.equal(verificarTotp(SECRETO_RFC, '755224'), true); // paso anterior
      // Con ventana 0 sólo vale el paso actual.
      assert.equal(verificarTotp(SECRETO_RFC, '755224', 30, 0), false);
    } finally {
      mock.timers.reset();
    }
  });

  it('códigos mal formados se rechazan sin tocar el secreto', () => {
    for (const codigo of ['', '12345', '1234567', 'abcdef', '12 34 5', ' 12345 ']) {
      assert.equal(verificarTotp(SECRETO_RFC, codigo), false, `codigo=${codigo}`);
    }
    // "123456 " con espacio final → se limpia → 6 dígitos → evalúa (probablemente false, no throw).
    assert.doesNotThrow(() => verificarTotp(SECRETO_RFC, ' 287082 '));
  });

  it('un secreto sin caracteres válidos siempre falla', () => {
    assert.equal(verificarTotp('!@#$%', '287082'), false);
  });

  it('ventana negativa nunca verifica (documentado)', () => {
    mock.timers.enable({ apis: ['Date'], now: 59_000 });
    try {
      assert.equal(verificarTotp(SECRETO_RFC, '287082', 30, -1), false);
    } finally {
      mock.timers.reset();
    }
  });

  it('pasoSegundos 0 rompe con RangeError (documentado)', () => {
    mock.timers.enable({ apis: ['Date'], now: 59_000 });
    try {
      assert.throws(() => verificarTotp(SECRETO_RFC, '287082', 0), RangeError);
    } finally {
      mock.timers.reset();
    }
  });
});
