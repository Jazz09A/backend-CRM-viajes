/**
 * Template HTML para el voucher de reserva.
 *
 * Diseño limpio y profesional con:
 * - Logo/marca Ruta Clara
 * - Código de reserva, tour, salida
 * - Pasajeros con categoría y selecciones
 * - Desglose de pagos
 * - QR de verificación
 * - Términos y firma
 */

export interface VoucherTemplateData {
  codigoReserva: string;
  titularNombre: string;
  tourNombre: string;
  fechaSalida: string;
  horaSalida: string;
  puntoAbordaje: string;
  pasajeros: {
    nombre: string;
    categoria: string;
    documento: string;
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
  terminosVersion: string;
  emitidoEn: string;
}

export function generarHtmlVoucher(datos: VoucherTemplateData): string {
  
  const pasajerosHtml = datos.pasajeros.map((p, i) => `
    <div class="pasajero">
      <div class="pasajero-header">
        <span class="pasajero-num">${i + 1}</span>
        <strong>${p.nombre}</strong>
        <span class="categoria">${p.categoria}</span>
      </div>
      <div class="pasajero-detalles">
        <span>Doc: ${p.documento}</span>
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
      align-items: center;
      border-bottom: 3px solid #2563eb;
      padding-bottom: 15px;
      margin-bottom: 20px;
    }
    .logo {
      font-size: 24px;
      font-weight: bold;
      color: #2563eb;
    }
    .voucher-title {
      font-size: 18px;
      font-weight: bold;
      color: #1a1a1a;
    }
    .codigo {
      font-size: 14px;
      font-weight: bold;
      color: #2563eb;
      margin-top: 5px;
    }
    .qr-section {
      text-align: center;
      margin: 20px 0;
    }
    .qr-img {
      width: 120px;
      height: 120px;
      border: 1px solid #ddd;
      padding: 5px;
    }
    .qr-text {
      font-size: 10px;
      color: #666;
      margin-top: 5px;
    }
    .section {
      margin-bottom: 20px;
    }
    .section-title {
      font-size: 14px;
      font-weight: bold;
      color: #2563eb;
      border-bottom: 1px solid #e5e7eb;
      padding-bottom: 5px;
      margin-bottom: 10px;
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
      color: #666;
      text-transform: uppercase;
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
      background: #2563eb;
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
    .categoria {
      background: #e0e7ff;
      color: #2563eb;
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
    .footer {
      margin-top: 30px;
      padding-top: 15px;
      border-top: 1px solid #e5e7eb;
      font-size: 10px;
      color: #666;
      text-align: center;
    }
    .terminos {
      margin-top: 10px;
      font-size: 9px;
      color: #9ca3af;
    }
  </style>
</head>
<body>
  <div class="header">
    <div>
      <div class="logo">Ruta Clara</div>
      <div class="voucher-title">Voucher de Reserva</div>
      <div class="codigo">${datos.codigoReserva}</div>
    </div>
    <div class="qr-section">
      <img src="${datos.qrDataUrl}" alt="QR" class="qr-img">
      <div class="qr-text">Escanea para verificar</div>
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

  <div class="footer">
    <div>Emitido: ${datos.emitidoEn}</div>
    <div>Términos: v${datos.terminosVersion}</div>
    <div class="terminos">
      Este voucher es un comprobante de reserva. Para cualquier consulta, contacta a Ruta Clara Viajes.
    </div>
  </div>
</body>
</html>`;
}
