import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import QRCode from 'qrcode';
import { Archivo, Configuracion, Firma, OutboxEvento, PlantillaTerminosVersion, Reserva, Voucher, Pasajero, Pago, FechaTour, Tour, PuntoSalida } from '../../database/entities';
import { ApiError } from '../../common/errors';
import { ArchivosService } from '../archivos/archivos.service';
import { VoucherPdfService } from './voucher-pdf.service';
import { generarHtmlVoucher } from './voucher-template';
import { horaLegible } from '../reservas/domain';
import { ph } from '../../common/sql.util';

/** Vouchers PDF (spec 6.6, 8.7). La generación real corre en el worker. */
@Injectable()
export class VouchersService {
  private readonly logger = new Logger(VouchersService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Voucher) private readonly vouchers: Repository<Voucher>,
    @InjectRepository(Archivo) private readonly archivos: Repository<Archivo>,
    @InjectRepository(Reserva) private readonly reservas: Repository<Reserva>,
    @InjectRepository(Pasajero) private readonly pasajeros: Repository<Pasajero>,
    @InjectRepository(Pago) private readonly pagos: Repository<Pago>,
    @InjectRepository(FechaTour) private readonly fechas: Repository<FechaTour>,
    @InjectRepository(Tour) private readonly tours: Repository<Tour>,
    @InjectRepository(Firma) private readonly firmas: Repository<Firma>,
    @InjectRepository(PuntoSalida) private readonly puntos: Repository<PuntoSalida>,
    @InjectRepository(Configuracion) private readonly configRepo: Repository<Configuracion>,
    private readonly archivosService: ArchivosService,
    private readonly pdfService: VoucherPdfService,
    private readonly config: ConfigService,
  ) {}

  listarPorReserva(reservaId: string) {
    return this.vouchers.find({ where: { reserva_id: reservaId }, order: { version: 'DESC' } });
  }

  async regenerar(reservaId: string, motivo: string) {
    const vigentes = await this.vouchers.find({ where: { reserva_id: reservaId, vigente: true } });
    for (const v of vigentes) {
      v.vigente = false;
      v.estado = 'reemplazado';
      await this.vouchers.save(v);
    }
    const max = await this.vouchers.maximum('version', { reserva_id: reservaId });
    const voucher = await this.vouchers.save(
      this.vouchers.create({
        reserva_id: reservaId,
        version: (max ?? 0) + 1,
        tipo: 'final',
        estado: 'generando',
        vigente: false,
        motivo_regeneracion: motivo,
      }),
    );
    // Encolar evento outbox para el worker
    await this.outbox('voucher.generar', { voucher_id: voucher.id, reserva_id: reservaId });
    return voucher;
  }

  async urlDescarga(voucherId: string) {
    const voucher = await this.vouchers.findOne({ where: { id: voucherId } });
    if (!voucher) throw ApiError.noEncontrado('Voucher');
    if (voucher.estado !== 'listo' || !voucher.archivo_id) {
      throw ApiError.transicionInvalida('El voucher aún no está listo');
    }
    return { url: await this.archivosService.obtenerUrlFirmada(voucher.archivo_id), expira_en: new Date(Date.now() + 5 * 60 * 1000) };
  }

  /**
   * Procesa un voucher: genera PDF, sube a storage, actualiza estado.
   * Llamado por el worker/outbox.
   */
  async procesarVoucher(voucherId: string): Promise<void> {
    const voucher = await this.vouchers.findOne({ where: { id: voucherId } });
    if (!voucher || voucher.estado !== 'generando') return;

    try {
      voucher.intentos += 1;
      const datos = await this.cargarDatosVoucher(voucher.reserva_id);
      const appUrl = this.config.get<string>('PUBLIC_APP_URL') ?? 'http://localhost:8080';
      const qrUrl = `${appUrl}/v/${datos.verifToken}`;
      datos.qrDataUrl = await QRCode.toDataURL(qrUrl, { width: 240, margin: 1 });
      const html = generarHtmlVoucher(datos);
      const pdfBuffer = await this.pdfService.generarPdf(html);
      
      const archivoId = await this.archivosService.subir(
        pdfBuffer,
        `voucher-${voucher.reserva_id}-v${voucher.version}.pdf`,
        'application/pdf',
        'voucher',
        undefined,
        voucher.reserva_id,
      );

      // En transacción: actualizar voucher y desactivar otros vigentes
      voucher.archivo_id = archivoId;
      voucher.estado = 'listo';
      voucher.vigente = true;
      voucher.generado_en = new Date();
      voucher.error = null;
      await this.vouchers.save(voucher);

      // Desactivar otros vouchers vigentes de la misma reserva
      await this.vouchers
        .createQueryBuilder()
        .update(Voucher)
        .set({ vigente: false, estado: 'reemplazado' })
        .where('reserva_id = :reservaId', { reservaId: voucher.reserva_id })
        .andWhere('id != :voucherId', { voucherId: voucher.id })
        .andWhere('vigente = :vigente', { vigente: true })
        .execute();

      this.logger.log(`Voucher ${voucherId} generado exitosamente`);
    } catch (error) {
      this.logger.error(`Error generando voucher ${voucherId}: ${error}`);
      voucher.estado = 'error';
      voucher.error = error instanceof Error ? error.message : 'Error desconocido';
      await this.vouchers.save(voucher);
      throw error; // Re-lanzar para que el worker reintente
    }
  }

  private async outbox(tipo: string, payload: Record<string, unknown>) {
    const d = this.ds.options.type as string;
    await this.ds.query(
      `INSERT INTO outbox_evento (tipo, payload, estado, intentos, proximo_intento, creado_en)
       VALUES (${ph(d, 0)}, ${ph(d, 1)}, 'pendiente', 0, ${ph(d, 2)}, ${ph(d, 3)})`,
      [tipo, JSON.stringify(payload), new Date().toISOString(), new Date().toISOString()],
    );
  }

  private async cargarDatosVoucher(reservaId: string) {
    const reserva = await this.reservas.findOne({ where: { id: reservaId } });
    if (!reserva) throw ApiError.noEncontrado('Reserva');

    const [pasajeros, pagos, fecha, firmaVigente] = await Promise.all([
      this.pasajeros.find({ where: { reserva_id: reservaId }, order: { orden: 'ASC' } }),
      this.pagos.find({ where: { reserva_id: reservaId }, order: { creado_en: 'ASC' } }),
      this.fechas.findOne({ where: { id: reserva.fecha_tour_id } }),
      this.firmas.findOne({ where: { reserva_id: reservaId, vigente: true }, order: { creado_en: 'DESC' } }),
    ]);

    if (!fecha) throw ApiError.noEncontrado('Fecha de tour');
    const tour = await this.tours.findOne({ where: { id: fecha.tour_id } });
    if (!tour) throw ApiError.noEncontrado('Tour');

    const titular = pasajeros.find((p) => p.es_titular) ?? pasajeros[0];
    const verifToken = reserva.verif_token ?? '';

    // Punto de salida elegido en el formulario (catálogo global).
    const globales = (reserva.respuestas_globales ?? {}) as Record<string, unknown>;
    const claveGlobal = typeof globales['punto_abordaje'] === 'string' ? String(globales['punto_abordaje']) : '';
    // Sólo los puntos activos sirven para traducir claves → nombre legible.
    const puntosPorClave = new Map(
      (await this.puntos.find()).map((p) => [p.clave, `${p.nombre} (${horaLegible(p.hora)})`]),
    );
    const nombrePunto = (clave: string): string => {
      if (!clave) return 'Por definir';
      // Pseudo-clave del selector de ciudades: el punto exacto de Caracas se
      // confirma después por WhatsApp.
      if (clave === 'caracas') return 'Caracas — punto por confirmar';
      return puntosPorClave.get(clave) ?? clave.replace(/_/g, ' ');
    };
    // Cada pasajero puede salir de un punto distinto (salida personalizada);
    // si no respondió, hereda el punto global de la reserva.
    const puntoDePasajero = (p: Pasajero): string => {
      const respuestas = (p.respuestas ?? {}) as Record<string, unknown>;
      const clave = typeof respuestas['punto_abordaje'] === 'string' ? String(respuestas['punto_abordaje']) : '';
      return nombrePunto(clave || claveGlobal);
    };
    // El titular resume la salida en la cabecera; cada fila lleva su propio punto.
    const puntoAbordaje = titular ? puntoDePasajero(titular) : nombrePunto(claveGlobal);

    const [firmaEmpresaDataUrl, firmaCliente, configAgencia] = await Promise.all([
      this.dataUrlFirmaEmpresa(),
      firmaVigente
        ? this.firmaClienteDataUrl(firmaVigente)
        : Promise.resolve({ dataUrl: '', archivoPerdido: false }),
      this.configRepo.findOne({ where: { clave: 'agencia_nombre' } }),
    ]);
    const agenciaNombre =
      typeof configAgencia?.valor === 'string' && configAgencia.valor.trim()
        ? configAgencia.valor
        : 'Escapate Tours';

    // Versión legible de los términos que firmó el titular (número de la
    // versión, no el UUID).
    const versionTerminos = firmaVigente?.terminos_version_id
      ? await this.ds
          .getRepository(PlantillaTerminosVersion)
          .findOne({ where: { id: firmaVigente.terminos_version_id } })
      : null;
    const terminosVersion = versionTerminos ? `v${versionTerminos.version}` : '';

    return {
      agenciaNombre,
      codigoReserva: reserva.codigo ?? reserva.ref_corta ?? reserva.id,
      titularNombre: titular?.nombre ?? 'Cliente',
      tourNombre: tour.nombre,
      fechaSalida: fecha.fecha_salida,
      horaSalida: fecha.hora_salida,
      puntoAbordaje,
      pasajeros: pasajeros.map((p) => {
        const respuestas = (p.respuestas ?? {}) as Record<string, unknown>;
        const detalle =
          typeof respuestas['detalle_alergias'] === 'string'
            ? String(respuestas['detalle_alergias']).trim()
            : '';
        return {
          nombre: p.nombre,
          // Sin etiqueta de categoría en el voucher: los menores de 5 años
          // viajan gratis y sólo se muestra la nota de «sin costo».
          nota:
            p.categoria === 'infante'
              ? 'Sin costo · viaja en piernas de su representante'
              : '',
          documento: p.documento_ultimos4 ? `***${p.documento_ultimos4}` : 'Sin documento',
          // Punto de salida propio del pasajero (si lo definió) o el de la reserva.
          puntoAbordaje: puntoDePasajero(p),
          selecciones: [], // TODO: obtener del formulario
          // Condición médica declarada por pasajero (campo `detalle_alergias`).
          alergias: detalle ? detalle : undefined,
        };
      }),
      totalUsd: reserva.total_usd ?? '0.00',
      pagos: pagos.map((p) => ({
        metodo: p.metodo_id,
        monto: p.monto,
        estado: p.estado,
      })),
      verifToken,
      qrDataUrl: '',
      firmaEmpresaDataUrl,
      firmaClienteDataUrl: firmaCliente.dataUrl,
      firmaClienteArchivoPerdido: firmaCliente.archivoPerdido,
      firmaClienteNombre: titular?.nombre ?? 'Titular',
      firmaClienteFecha: firmaVigente ? new Date(firmaVigente.firmada_en).toLocaleDateString('es-VE') : '',
      // Versión legible de los términos firmados (número de la versión).
      terminosVersion,
      emitidoEn: new Date().toLocaleString('es-VE'),
    };
  }

  /** Data URL de la firma de la empresa configurada en el panel ('', si no hay). */
  private async dataUrlFirmaEmpresa(): Promise<string> {
    const fila = await this.configRepo.findOne({ where: { clave: 'firma_empresa_archivo_id' } });
    const archivoId = fila?.valor ? String(fila.valor) : '';
    if (!archivoId) return '';
    return this.dataUrlArchivo(archivoId);
  }

  /** Data URL PNG/JPEG de un archivo guardado en storage ('', si falla). */
  private async dataUrlArchivo(archivoId: string): Promise<string> {
    try {
      const { buffer, mime } = await this.archivosService.obtenerBuffer(archivoId);
      return `data:${mime};base64,${buffer.toString('base64')}`;
    } catch {
      // El archivo puede haber sido eliminado del storage: la firma queda en blanco.
      return '';
    }
  }

  /**
   * Imagen de la firma del cliente para el voucher.
   *
   * Si el archivo ya no está en el storage (p. ej. se perdió en un redeploy del
   * contenedor), se marca `archivoPerdido` para que el PDF lo diga en lugar de
   * dejar la casilla de la firma vacía en silencio.
   */
  private async firmaClienteDataUrl(
    firma: Firma,
  ): Promise<{ dataUrl: string; archivoPerdido: boolean }> {
    try {
      const { buffer, mime } = await this.archivosService.obtenerBuffer(firma.archivo_id);
      return { dataUrl: `data:${mime};base64,${buffer.toString('base64')}`, archivoPerdido: false };
    } catch (e) {
      this.logger.warn(
        `Voucher: archivo de la firma no disponible (reserva ${firma.reserva_id}): ${(e as Error).message}`,
      );
      return { dataUrl: '', archivoPerdido: true };
    }
  }
}
