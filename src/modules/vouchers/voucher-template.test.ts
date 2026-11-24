import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { generarHtmlVoucher, type VoucherTemplateData } from './voucher-template';

const datos = (parcial: Partial<VoucherTemplateData> = {}): VoucherTemplateData => ({
  agenciaNombre: 'Escapate Tours',
  codigoReserva: 'VJ-2026-00001',
  titularNombre: 'Ana Pérez',
  tourNombre: 'Chuspa full day',
  fechaSalida: '2026-06-01',
  horaSalida: '06:00',
  puntoAbordaje: 'CCCT Los Dos Caminos',
  pasajeros: [
    { nombre: 'Ana Pérez', nota: '', documento: 'V-12345678', selecciones: [] },
  ],
  totalUsd: '100.00',
  pagos: [],
  verifToken: 'tok',
  qrDataUrl: 'data:image/png;base64,x',
  terminosVersion: '3',
  emitidoEn: '2026-01-01 10:00',
  ...parcial,
});

describe('generarHtmlVoucher', () => {
  it('produce un HTML completo con los datos principales', () => {
    const html = generarHtmlVoucher(datos());
    assert.match(html, /<!DOCTYPE html>/);
    assert.match(html, /Voucher de Reserva/);
    assert.match(html, /VJ-2026-00001/);
    assert.match(html, /Chuspa full day/);
    assert.match(html, /2026-06-01/);
    assert.match(html, /Total: \$100\.00 USD/);
    assert.match(html, /Pasajeros \(1\)/);
    assert.match(html, /Escanea para verificar/);
    assert.match(html, /Términos: v3/);
    // El logo y el QR van como data URLs.
    assert.match(html, /data:image/);
  });

  it('sin pasajeros ni pagos no rompe: secciones vacías', () => {
    const html = generarHtmlVoucher(datos({ pasajeros: [], pagos: [] }));
    assert.match(html, /Pasajeros \(0\)/);
    assert.doesNotMatch(html, /class="pasajero"/);
    assert.match(html, /Total: \$100\.00 USD/);
  });

  it('pasajero: nota, selecciones, alergias y punto de abordaje propio', () => {
    const html = generarHtmlVoucher(
      datos({
        pasajeros: [
          {
            nombre: 'Bebé',
            nota: 'sin costo',
            documento: 'OTRO-1',
            puntoAbordaje: 'Otro punto', // distinto al global → se muestra
            selecciones: ['Almuerzo: pollo', 'Café'],
            alergias: 'nueces',
          },
          {
            nombre: 'Igual',
            nota: '',
            documento: 'V-9',
            puntoAbordaje: 'CCCT Los Dos Caminos', // igual al global → NO se muestra
            selecciones: [],
          },
        ],
      }),
    );
    assert.match(html, /sin costo/);
    assert.match(html, /Salida: Otro punto/);
    assert.match(html, /Almuerzo: pollo, Café/);
    assert.match(html, /Alergias: nueces/);
    // El punto global va en la sección viaje (sin prefijo "Salida:"); los
    // pasajeros que repiten el global NO generan línea "Salida:".
    assert.doesNotMatch(html, /Salida: CCCT Los Dos Caminos/);
    assert.equal((html.match(/Salida: Otro punto/g) ?? []).length, 1);
  });

  it('con varios puntos de salida cada pasajero muestra el suyo', () => {
    const html = generarHtmlVoucher(
      datos({
        multiplesPuntos: true,
        pasajeros: [
          {
            nombre: 'Uno',
            nota: '',
            documento: 'V-1',
            puntoAbordaje: 'CCCT Los Dos Caminos', // igual al global pero se muestra igual
            selecciones: [],
          },
          {
            nombre: 'Dos',
            nota: '',
            documento: 'V-2',
            puntoAbordaje: 'Farmatodo Trocha',
            selecciones: [],
          },
        ],
      }),
    );
    assert.match(html, /Salida: CCCT Los Dos Caminos/);
    assert.match(html, /Salida: Farmatodo Trocha/);
  });

  it('pagos listan método, monto y estado con su clase CSS', () => {
    const html = generarHtmlVoucher(
      datos({
        pagos: [
          { metodo: 'Pago móvil', monto: '50.00', estado: 'aprobado' },
          { metodo: 'Efectivo', monto: '50.00', estado: 'pendiente' },
        ],
      }),
    );
    assert.match(html, /Pago móvil/);
    assert.match(html, /\$50\.00 USD/);
    assert.match(html, /estado-aprobado/);
    assert.match(html, /estado-pendiente/);
  });

  it('bloque de firmas: empresa con imagen, cliente con datos y fallback', () => {
    const conFirmas = generarHtmlVoucher(
      datos({
        firmaEmpresaDataUrl: 'data:image/png;base64,emp',
        firmaClienteDataUrl: 'data:image/png;base64,cli',
        firmaClienteNombre: 'Ana Pérez',
        firmaClienteFecha: '2026-01-02',
      }),
    );
    assert.match(conFirmas, /Firma de la empresa/);
    assert.match(conFirmas, /Firma del cliente/);
    assert.match(conFirmas, /Firmado: 2026-01-02/);
    assert.match(conFirmas, /Por la empresa/);
    assert.match(conFirmas, /Por el cliente/);

    // Sin imagen de cliente pero con nombre/fecha.
    const sinImagen = generarHtmlVoucher(
      datos({ firmaClienteNombre: 'Otro Nombre', firmaClienteFecha: '2026-01-03' }),
    );
    assert.match(sinImagen, /Otro Nombre/);
    assert.match(sinImagen, /Firmado: 2026-01-03/);
    assert.doesNotMatch(sinImagen, /Firma del cliente/);
  });

  it('firma_cliente_archivo_perdido muestra aviso sólo sin data URL', () => {
    const perdido = generarHtmlVoucher(datos({ firmaClienteArchivoPerdido: true }));
    assert.match(perdido, /Firma no disponible/);
    const conImagen = generarHtmlVoucher(
      datos({ firmaClienteArchivoPerdido: true, firmaClienteDataUrl: 'data:image/png;base64,x' }),
    );
    // La imagen gana sobre el aviso de pérdida.
    assert.doesNotMatch(conImagen, /Firma no disponible/);
  });

  it('sin firmaClienteNombre usa el titular; sin fecha dice "Firma pendiente"', () => {
    const html = generarHtmlVoucher(datos());
    assert.match(html, /Ana Pérez<\/div>/); // firma-nombre del cliente
    assert.match(html, /Firma pendiente/);
  });

  it('encabezado con datos de la empresa', () => {
    const html = generarHtmlVoucher(datos());
    assert.match(html, /0414-156-3709/);
    assert.match(html, /@EscapateTours_/);
    assert.match(html, /Caracas — Sabana Grande/);
    assert.match(html, /J-503198427/);
    assert.match(html, /RTN<\/span> 21544/);
    assert.match(html, /Escapate Tours/);
  });

  it('pie del documento con Condiciones Generales del Servicio', () => {
    const html = generarHtmlVoucher(datos());
    assert.match(html, /Condiciones Generales del Servicio/);
    assert.match(html, /compromiso de asistencia/);
    assert.match(html, /divisas en efectivo/);
    assert.match(html, /bebidas alcohólicas/);
    assert.match(html, /orden de pago/);
    assert.match(html, /quórum/);
    assert.match(html, /fuerza mayor/i);
    assert.match(html, /está aceptando nuestras condiciones/);
  });

  it('los campos se interpolan SIN escape HTML (documentado)', () => {
    // Hallazgo: nombres con markup se insertan crudos en el voucher.
    // El PDF se genera server-side para un destinatario concreto, pero un
    // nombre como `<img src=x onerror=...>` llegaría literal al HTML.
    const html = generarHtmlVoucher(
      datos({
        pasajeros: [{ nombre: '<b>Inyectado</b>', nota: '', documento: '<script>x</script>', selecciones: [] }],
      }),
    );
    assert.match(html, /<b>Inyectado<\/b>/); // pasa tal cual, sin &lt;
    assert.match(html, /<script>x<\/script>/);
  });
});
