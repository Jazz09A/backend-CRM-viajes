/**
 * Template HTML para el voucher de reserva.
 *
 * Diseño limpio y profesional con:
 * - Logo/marca Escapate Tours y datos de la empresa
 * - Código de reserva, tour, salida
 * - Pasajeros con categoría y selecciones
 * - Desglose de pagos
 * - QR de verificación
 * - Firmas y condiciones generales del servicio
 */

import { LOGO_ESCAPATE_DATA_URL } from './logo-escapate';

/** Datos de contacto de la empresa impresos en el encabezado del voucher. */
const EMPRESA = {
  telefono: '0414-156-3709',
  instagram: '@EscapateTours_',
  ubicacion: 'Caracas — Sabana Grande',
  rif: 'J-503198427',
  rtn: '21544',
};

/** Condiciones generales del servicio, impresas al pie del documento. */
const CONDICIONES: { titulo: string; texto: string }[] = [
  {
    titulo: 'Pago y asistencia',
    texto:
      'El pago de la reservación es el compromiso de asistencia. De no poder asistir al viaje no hacemos devolución ni se deja abonado para otro fullday.',
  },
  {
    titulo: 'Saldo restante',
    texto:
      'El monto restante del paquete debe ser cancelado al momento de abordar la unidad únicamente en divisas en efectivo. En otro método de pago (Bs / Zelle o Binance) debe realizarse 3 días antes del viaje.',
  },
  {
    titulo: 'Consumo de alcohol',
    texto: 'Está prohibido el consumo de bebidas alcohólicas dentro de la unidad de transporte.',
  },
  {
    titulo: 'Asignación de puestos',
    texto:
      'Los puestos en la unidad de traslado se asignan por orden de pago. Si tiene alguna condición de salud que amerite preferencia, por favor envíe su informe médico antes de reservar para evitar molestias.',
  },
  {
    titulo: 'Quórum mínimo',
    texto:
      'Nuestros viajes terrestres dependen de una cantidad mínima de personas para su realización. En el caso de que no se cumpla el quórum se notificará mínimo 3 días antes del viaje, ofreciendo alternativas y próximas fechas.',
  },
  {
    titulo: 'Fuerza mayor',
    texto:
      'Si por razones de casos fortuitos o de fuerza mayor (condiciones climatológicas, manifestaciones, suspensión de zarpe, pronunciamiento del Ejecutivo Nacional, pandemia, etc.) es necesario reprogramar el viaje, no hacemos devolución de dinero. Se aplicarán las penalidades y descuentos correspondientes según cada caso.',
  },
];

export interface VoucherTemplateData {
  /** Nombre de la agencia impreso en el voucher (config `agencia_nombre`). */
  agenciaNombre: string;
  codigoReserva: string;
  titularNombre: string;
  tourNombre: string;
  fechaSalida: string;
  horaSalida: string;
  puntoAbordaje: string;
  /** `true` cuando los pasajeros tienen puntos de salida distintos. */
  multiplesPuntos?: boolean;
  pasajeros: {
    nombre: string;
    /** Nota del pasajero: «sin costo» para menores de 5 (vacío si no aplica). */
    nota: string;
    documento: string;
    /** Punto de salida propio del pasajero (salidas personalizadas). */
    puntoAbordaje?: string;
    selecciones: string[];
    alergias?: string;
  }[];
  totalUsd: string;
  pagos: {
    metodo: string;
    monto: string;
    estado: string;
  }[];
  verifToken: string;
  /** Data URL PNG del QR de verificación (generado localmente, sin red). */
  qrDataUrl: string;
  /** Data URL de la imagen de firma de la empresa ('' si no está configurada). */
  firmaEmpresaDataUrl?: string;
  /** Data URL de la firma manuscrita del cliente ('' si no hay). */
  firmaClienteDataUrl?: string;
  /** `true` si hay firma registrada pero el archivo ya no está en el storage. */
  firmaClienteArchivoPerdido?: boolean;
  firmaClienteNombre?: string;
  firmaClienteFecha?: string;
  terminosVersion: string;
  emitidoEn: string;
}

export function generarHtmlVoucher(datos: VoucherTemplateData): string {

  const pasajerosHtml = datos.pasajeros.map((p, i) => `
    <div class="pasajero">
      <div class="pasajero-header">
        <span class="pasajero-num">${i + 1}</span>
        <strong>${p.nombre}</strong>
        ${p.nota ? `<span class="nota">${p.nota}</span>` : ''}
      </div>
      <div class="pasajero-detalles">
        <span>Doc: ${p.documento}</span>
        ${p.puntoAbordaje && (datos.multiplesPuntos || p.puntoAbordaje !== datos.puntoAbordaje) ? `<span>Salida: ${p.puntoAbordaje}</span>` : ''}
        ${p.selecciones.length > 0 ? `<span>Selecciones: ${p.selecciones.join(', ')}</span>` : ''}
        ${p.alergias ? `<span class="alergia">Alergias: ${p.alergias}</span>` : ''}
      </div>
    </div>
  `).join('');

  const pagosHtml = datos.pagos.map((p) => `
    <div class="pago">
      <span>${p.metodo}</span>
      <span>$${p.monto} USD</span>
      <span class="estado-${p.estado}">${p.estado}</span>
    </div>
  `).join('');

  const condicionesHtml = CONDICIONES.map((c, i) => `
    <li class="condicion">
      <span class="condicion-num">${i + 1}.</span>
      <div>
        <strong>${c.titulo}.</strong> ${c.texto}
      </div>
    </li>
  `).join('');

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Voucher ${datos.codigoReserva}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
      font-size: 12px;
      color: #1a1a1a;
      background: #fff;
      padding: 20px;
    }
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 3px solid #1e3a8a;
      padding-bottom: 14px;
      margin-bottom: 20px;
    }
    .header-izq {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .logo-img {
      height: 56px;
      width: auto;
      display: block;
    }
    .empresa-nombre {
      font-size: 18px;
      font-weight: bold;
      color: #1a1a1a;
      letter-spacing: 0.02em;
    }
    .voucher-title {
      font-size: 15px;
      font-weight: bold;
      color: #1e3a8a;
      margin-top: 2px;
      text-transform: uppercase;
      letter-spacing: 0.06em;
    }
    .codigo {
      font-size: 13px;
      font-weight: bold;
      color: #2563eb;
      margin-top: 4px;
    }
    .header-der {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      gap: 6px;
      text-align: right;
    }
    .empresa-contacto {
      font-size: 10px;
      color: #4b5563;
      line-height: 1.6;
    }
    .empresa-contacto .etiqueta {
      display: inline-block;
      min-width: 52px;
      font-size: 8px;
      font-weight: bold;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .qr-img {
      width: 96px;
      height: 96px;
      border: 1px solid #e5e7eb;
      padding: 4px;
      margin-top: 4px;
    }
    .qr-text {
      font-size: 9px;
      color: #6b7280;
      margin-top: 3px;
    }
    .section {
      margin-bottom: 20px;
    }
    .section-title {
      font-size: 13px;
      font-weight: bold;
      color: #1e3a8a;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 5px;
      margin-bottom: 10px;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }
    .info-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10px;
    }
    .info-item {
      display: flex;
      flex-direction: column;
    }
    .info-label {
      font-size: 10px;
      color: #6b7280;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    .info-value {
      font-size: 12px;
      font-weight: 500;
    }
    .pasajero {
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      padding: 10px;
      margin-bottom: 10px;
    }
    .pasajero-header {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-bottom: 8px;
    }
    .pasajero-num {
      background: #1e3a8a;
      color: white;
      width: 20px;
      height: 20px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-size: 10px;
      font-weight: bold;
    }
    .nota {
      background: #dcfce7;
      color: #15803d;
      padding: 2px 8px;
      border-radius: 12px;
      font-size: 10px;
      font-weight: 500;
    }
    .pasajero-detalles {
      display: flex;
      flex-direction: column;
      gap: 3px;
      font-size: 11px;
      color: #4b5563;
    }
    .alergia {
      color: #dc2626;
      font-weight: 500;
    }
    .pago {
      display: flex;
      justify-content: space-between;
      padding: 8px 0;
      border-bottom: 1px solid #f3f4f6;
    }
    .estado-aprobado { color: #16a34a; font-weight: 500; }
    .estado-pendiente { color: #f59e0b; font-weight: 500; }
    .estado-rechazado { color: #dc2626; font-weight: 500; }
    .total {
      font-size: 16px;
      font-weight: bold;
      color: #1a1a1a;
      text-align: right;
      margin-top: 10px;
    }
    .firmas {
      display: flex;
      justify-content: space-between;
      gap: 24px;
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px solid #e5e7eb;
    }
    .firma-bloque {
      flex: 1 1 0;
      max-width: 280px;
    }
    .firma-caja {
      position: relative;
      height: 80px;
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
      align-items: flex-start;
    }
    .firma-caja img {
      max-height: 64px;
      max-width: 100%;
      object-fit: contain;
      margin-bottom: 2px;
    }
    .firma-perdida {
      font-size: 10px;
      color: #b45309;
      background: #fffbeb;
      border: 1px dashed #fcd34d;
      border-radius: 4px;
      padding: 6px 8px;
      margin-bottom: 2px;
    }
    .firma-linea {
      border-bottom: 1.5px solid #4b5563;
      width: 100%;
    }
    .firma-rol {
      font-size: 10px;
      font-weight: bold;
      color: #1a1a1a;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      margin-top: 4px;
    }
    .firma-nombre {
      font-size: 10px;
      color: #4b5563;
      margin-top: 1px;
    }
    .firma-fecha {
      font-size: 9px;
      color: #9ca3af;
      margin-top: 1px;
    }
    .condiciones {
      margin-top: 28px;
      padding-top: 14px;
      border-top: 2px solid #1e3a8a;
    }
    .condiciones-title {
      font-size: 13px;
      font-weight: bold;
      color: #1e3a8a;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 10px;
    }
    .condiciones-lista {
      list-style: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }
    .condicion {
      display: flex;
      gap: 8px;
      font-size: 10px;
      line-height: 1.5;
      color: #374151;
      text-align: justify;
    }
    .condicion-num {
      font-weight: bold;
      color: #1e3a8a;
      flex-shrink: 0;
    }
    .condicion strong {
      color: #1a1a1a;
    }
    .condiciones-nota {
      margin-top: 12px;
      font-size: 10px;
      font-style: italic;
      color: #4b5563;
      line-height: 1.5;
    }
    .qr-final {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 4px;
      margin: 8px 0 4px;
    }
    .qr-final .qr-img {
      margin-top: 0;
    }
    .footer {
      margin-top: 20px;
      padding-top: 12px;
      border-top: 1px solid #e5e7eb;
      font-size: 10px;
      color: #6b7280;
      text-align: center;
      line-height: 1.6;
    }
    .terminos {
      font-size: 9px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="header">
    <div class="header-izq">
      <img class="logo-img" src="${LOGO_ESCAPATE_DATA_URL}" alt="Escapate Tours">
      <div>
        <div class="empresa-nombre">${datos.agenciaNombre}</div>
        <div class="voucher-title">Voucher de Reserva</div>
        <div class="codigo">${datos.codigoReserva}</div>
      </div>
    </div>
    <div class="header-der">
      <div class="empresa-contacto">
        <div><span class="etiqueta">Teléfono</span> ${EMPRESA.telefono}</div>
        <div><span class="etiqueta">Instagram</span> ${EMPRESA.instagram}</div>
        <div><span class="etiqueta">Ubicación</span> ${EMPRESA.ubicacion}</div>
        <div><span class="etiqueta">RIF</span> ${EMPRESA.rif} &nbsp;·&nbsp; <span class="etiqueta">RTN</span> ${EMPRESA.rtn}</div>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Información del Viaje</div>
    <div class="info-grid">
      <div class="info-item">
        <span class="info-label">Tour</span>
        <span class="info-value">${datos.tourNombre}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Fecha</span>
        <span class="info-value">${datos.fechaSalida}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Hora</span>
        <span class="info-value">${datos.horaSalida}</span>
      </div>
      <div class="info-item">
        <span class="info-label">Punto de Abordaje</span>
        <span class="info-value">${datos.puntoAbordaje}</span>
      </div>
    </div>
  </div>

  <div class="section">
    <div class="section-title">Pasajeros (${datos.pasajeros.length})</div>
    ${pasajerosHtml}
  </div>

  <div class="section">
    <div class="section-title">Pagos</div>
    ${pagosHtml}
    <div class="total">Total: $${datos.totalUsd} USD</div>
  </div>

  <div class="firmas">
    <div class="firma-bloque">
      <div class="firma-caja">
        ${datos.firmaEmpresaDataUrl ? `<img src="${datos.firmaEmpresaDataUrl}" alt="Firma de la empresa">` : ''}
        <div class="firma-linea"></div>
      </div>
      <div class="firma-rol">Por la empresa</div>
      <div class="firma-nombre">${datos.agenciaNombre}</div>
      <div class="firma-fecha">Emitido: ${datos.emitidoEn}</div>
    </div>
    <div class="firma-bloque">
      <div class="firma-caja">
        ${datos.firmaClienteDataUrl
          ? `<img src="${datos.firmaClienteDataUrl}" alt="Firma del cliente">`
          : datos.firmaClienteArchivoPerdido
            ? '<span class="firma-perdida">Firma no disponible</span>'
            : ''}
        <div class="firma-linea"></div>
      </div>
      <div class="firma-rol">Por el cliente</div>
      <div class="firma-nombre">${datos.firmaClienteNombre ?? datos.titularNombre}</div>
      <div class="firma-fecha">${datos.firmaClienteFecha ? `Firmado: ${datos.firmaClienteFecha}` : 'Firma pendiente'}</div>
    </div>
  </div>

  <div class="condiciones">
    <div class="condiciones-title">Condiciones Generales del Servicio</div>
    <ol class="condiciones-lista">
      ${condicionesHtml}
    </ol>
    <p class="condiciones-nota">
      * Por favor leer detenidamente el documento de las cláusulas específicas de nuestros servicios
      antes de su pago. Ya que al ejecutarlo está aceptando nuestras condiciones.
    </p>
  </div>

  <div class="qr-final">
    <img src="${datos.qrDataUrl}" alt="QR" class="qr-img">
    <div class="qr-text">Escanea para verificar este voucher</div>
  </div>

  <div class="footer">
    <div>Emitido: ${datos.emitidoEn}</div>
    <div>Términos: v${datos.terminosVersion}</div>
    <div class="terminos">
      Este voucher es un comprobante de reserva. Para cualquier consulta, contacta a ${datos.agenciaNombre}.
    </div>
  </div>
</body>
</html>`;
}
