import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HttpStatus } from '@nestjs/common';
import { ApiError } from './errors';

describe('ApiError — forma RFC 7807', () => {
  it('expone status, codigo, tipo, mensaje y cuerpo serializable', () => {
    const error = ApiError.validacion('Revisa los datos', [
      { campo: 'nombre', codigo: 'VALIDACION', mensaje: 'Obligatorio' },
    ]);
    assert.equal(error.getStatus(), HttpStatus.UNPROCESSABLE_ENTITY);
    assert.equal(error.codigo, 'VALIDACION');
    assert.equal(error.tipo, 'https://agencia-viajes.local/errores/VALIDACION');

    const cuerpo = error.getResponse() as Record<string, unknown>;
    assert.equal(cuerpo['codigo'], 'VALIDACION');
    assert.equal(cuerpo['mensaje'], 'Revisa los datos');
    assert.deepEqual(cuerpo['detalles'], [
      { campo: 'nombre', codigo: 'VALIDACION', mensaje: 'Obligatorio' },
    ]);
  });

  it('detalles vacío NO aparece en el cuerpo (documentado)', () => {
    const error = ApiError.validacion('Solo mensaje', []);
    const cuerpo = error.getResponse() as Record<string, unknown>;
    assert.equal('detalles' in cuerpo, false);
  });

  it('data y tipo personalizado se propagan', () => {
    const error = new ApiError(
      HttpStatus.CONFLICT,
      'CUSTOM',
      'Mensaje',
      undefined,
      'https://example.com/tipo',
      { retry_after: 30 },
    );
    const cuerpo = error.getResponse() as Record<string, unknown>;
    assert.equal(cuerpo['tipo'], 'https://example.com/tipo');
    assert.deepEqual(cuerpo['data'], { retry_after: 30 });
    assert.equal(error.data?.['retry_after'], 30);
  });
});

describe('ApiError — factories', () => {
  const casos: [() => ApiError, number, string][] = [
    [() => ApiError.noAutenticado(), 401, 'NO_AUTENTICADO'],
    [() => ApiError.sinPermiso(), 403, 'SIN_PERMISO'],
    [() => ApiError.sinPermiso('editar tours'), 403, 'SIN_PERMISO'],
    [() => ApiError.noEncontrado(), 404, 'NO_ENCONTRADO'],
    [() => ApiError.noEncontrado('La reserva'), 404, 'NO_ENCONTRADO'],
    [() => ApiError.transicionInvalida('No se puede'), 409, 'TRANSICION_INVALIDA'],
    [() => ApiError.versionDesactualizada(), 409, 'VERSION_DESACTUALIZADA'],
    [() => ApiError.setupYaCompletado(), 409, 'SETUP_YA_COMPLETADO'],
    [() => ApiError.demasiadasSolicitudes(), 429, 'DEMASIADAS_SOLICITUDES'],
    [() => ApiError.enlaceInvalido(), 404, 'ENLACE_INVALIDO'],
    [() => ApiError.enlaceVencido(), 410, 'ENLACE_VENCIDO'],
    [() => ApiError.enlaceVencido('+584121234567'), 410, 'ENLACE_VENCIDO'],
  ];

  for (const [factory, status, codigo] of casos) {
    it(`${codigo} → HTTP ${status}`, () => {
      const error = factory();
      assert.equal(error.getStatus(), status);
      assert.equal(error.codigo, codigo);
      assert.ok((error.getResponse() as Record<string, unknown>)['mensaje'], codigo);
    });
  }

  it('los mensajes con parámetros los interpolan en el cuerpo', () => {
    // HttpException.message es 'Api Error' para respuestas objeto: el
    // mensaje de dominio vive en getResponse().mensaje.
    const mensaje = (e: ApiError) =>
      (e.getResponse() as Record<string, unknown>)['mensaje'] as string;
    assert.match(mensaje(ApiError.noEncontrado('La reserva')), /La reserva no encontrado/);
    assert.match(mensaje(ApiError.sinPermiso('editar tours')), /editar tours/);
    assert.match(mensaje(ApiError.enlaceVencido('+584121234567')), /\+584121234567/);
    assert.match(mensaje(ApiError.noAutenticado('Custom')), /Custom/);
  });

  it('demasiadasSolicitudes lleva retry_after en data sólo si se indica', () => {
    const sinDato = ApiError.demasiadasSolicitudes();
    assert.equal(sinDato.data, undefined);

    const conDato = ApiError.demasiadasSolicitudes('Espera', 42);
    assert.equal(conDato.data?.['retry_after'], 42);
    const cuerpo = conDato.getResponse() as Record<string, unknown>;
    assert.deepEqual(cuerpo['data'], { retry_after: 42 });
  });
});
