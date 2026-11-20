import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { DataSource, Repository } from 'typeorm';
import { Workbook } from 'exceljs';
import { AppConfig } from '../../config/configuration';
import {
  Archivo,
  Cliente,
  Exportacion,
  Pasajero,
  Pago,
  Reserva,
  TipoExportacion,
} from '../../database/entities';
import { ApiError } from '../../common/errors';
import { afectados, ph } from '../../common/sql.util';
import { ArchivosService } from '../archivos/archivos.service';
import { UsuarioActual } from '../../common/decorators/current-user.decorator';
import { Rol } from '../../common/decorators/roles.decorator';

const PERMISOS_POR_TIPO: Record<TipoExportacion, Rol[]> = {
  reservas: ['superadmin', 'operador', 'validador'],
  tours: ['superadmin', 'operador'],
  pasajeros_tour: ['superadmin', 'operador', 'guia'],
  clientes: ['superadmin', 'operador'],
  pagos: ['superadmin', 'validador'],
  manifest: ['superadmin', 'operador', 'guia'],
  cocina: ['superadmin', 'operador', 'guia'],
};

const NOMBRES_ARCHIVO: Record<TipoExportacion, string> = {
  reservas: 'reservas',
  tours: 'tours',
  pasajeros_tour: 'pasajeros-tour',
  clientes: 'clientes',
  pagos: 'pagos',
  manifest: 'manifest',
  cocina: 'cocina',
};

@Injectable()
export class ExportacionesService {
  private readonly logger = new Logger(ExportacionesService.name);

  constructor(
    @InjectDataSource() private readonly ds: DataSource,
    @InjectRepository(Exportacion) private readonly exportaciones: Repository<Exportacion>,
    private readonly archivosService: ArchivosService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  /**
   * Solicita una exportación. Valida permisos y encola el job.
   */
  async solicitar(
    tipo: TipoExportacion,
    filtros: Record<string, unknown>,
    usuario: UsuarioActual,
  ): Promise<Exportacion> {
    // Validar permisos
    const rolesPermitidos = PERMISOS_POR_TIPO[tipo];
    const tienePermiso = usuario.roles.some((r) => rolesPermitidos.includes(r));
    if (!tienePermiso) {
      throw ApiError.sinPermiso(`exportar ${tipo}`);
    }

    // Validar filtros requeridos
    this.validarFiltros(tipo, filtros);

    const exportacion = this.exportaciones.create({
      tipo,
      filtros,
      estado: 'en_cola',
      solicitada_por: usuario.id,
      intentos: 0,
    });
    const guardada = await this.exportaciones.save(exportacion);

    // Encolar job
    await this.outbox('exportacion.generar', { exportacion_id: guardada.id });

    this.logger.log(`Exportación ${guardada.id} (${tipo}) solicitada por ${usuario.id}`);
    return guardada;
  }

  /**
   * Lista exportaciones del usuario (o todas para superadmin).
   */
  async listar(usuario: UsuarioActual): Promise<Exportacion[]> {
    const esSuperadmin = usuario.roles.includes('superadmin');
    const where = esSuperadmin ? {} : { solicitada_por: usuario.id };
    return this.exportaciones.find({
      where,
      order: { creado_en: 'DESC' },
      take: 50,
    });
  }

  /**
   * Obtiene una exportación por ID.
   */
  async obtener(id: string, usuario: UsuarioActual): Promise<Exportacion> {
    const exportacion = await this.exportaciones.findOne({ where: { id } });
    if (!exportacion) throw ApiError.noEncontrado('Exportación');

    // Solo el solicitante o superadmin puede ver
    const esSuperadmin = usuario.roles.includes('superadmin');
    if (!esSuperadmin && exportacion.solicitada_por !== usuario.id) {
      throw ApiError.sinPermiso('ver esta exportación');
    }

    return exportacion;
  }

  /**
   * Genera URL firmada para descarga.
   */
  async descargar(id: string, usuario: UsuarioActual): Promise<{ url: string; expira_en: Date }> {
    const exportacion = await this.obtener(id, usuario);
    
    if (exportacion.estado !== 'lista' || !exportacion.archivo_id) {
      throw ApiError.transicionInvalida('La exportación aún no está lista');
    }

    if (exportacion.expira_en && exportacion.expira_en < new Date()) {
      exportacion.estado = 'expirada';
      await this.exportaciones.save(exportacion);
      throw ApiError.transicionInvalida('La exportación ha expirado');
    }

    const url = await this.archivosService.obtenerUrlFirmada(exportacion.archivo_id);
    return { url, expira_en: exportacion.expira_en ?? new Date(Date.now() + 24 * 3600 * 1000) };
  }

  /**
   * Procesa una exportación: genera XLSX, sube a storage, marca lista.
   * Llamado por el worker/outbox.
   */
  async procesar(id: string): Promise<void> {
    const exportacion = await this.exportaciones.findOne({ where: { id } });
    if (!exportacion || exportacion.estado !== 'en_cola') return;

    try {
      exportacion.estado = 'procesando';
      exportacion.intentos += 1;
      await this.exportaciones.save(exportacion);

      // Generar XLSX según tipo
      const workbook = await this.generarWorkbook(exportacion.tipo, exportacion.filtros);
      const buffer = await workbook.xlsx.writeBuffer();

      const nombreArchivo = `${NOMBRES_ARCHIVO[exportacion.tipo]}-${new Date().toISOString().slice(0, 10)}.xlsx`;
      const archivoId = await this.archivosService.subir(
        Buffer.from(buffer),
        nombreArchivo,
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'exportacion',
        exportacion.solicitada_por,
      );

      exportacion.archivo_id = archivoId;
      exportacion.nombre_archivo = nombreArchivo;
      exportacion.estado = 'lista';
      exportacion.expira_en = new Date(Date.now() + 24 * 3600 * 1000); // 24h
      exportacion.error = null;
      await this.exportaciones.save(exportacion);

      this.logger.log(`Exportación ${id} procesada exitosamente`);
    } catch (error) {
      this.logger.error(`Error procesando exportación ${id}: ${error}`);
      exportacion.estado = 'error';
      exportacion.error = error instanceof Error ? error.message : 'Error desconocido';
      await this.exportaciones.save(exportacion);
      throw error; // Re-lanzar para que el worker reintente
    }
  }

  /**
   * Marca exportaciones expiradas (job de limpieza).
   */
  async expirarAntiguas(): Promise<number> {
    const d = this.ds.options.type as string;
    const res = await this.ds.query(
      `UPDATE exportacion SET estado = ${ph(d, 0)}
       WHERE estado = ${ph(d, 1)} AND expira_en IS NOT NULL AND expira_en < ${ph(d, 2)}`,
      ['expirada', 'lista', new Date().toISOString()],
    );
    return afectados(d, res);
  }

  // ── Generación de workbooks ──────────────────────────────────────────

  private async generarWorkbook(tipo: TipoExportacion, filtros: Record<string, unknown>): Promise<Workbook> {
    const wb = new Workbook();
    wb.creator = 'Ruta Clara Viajes';
    wb.created = new Date();

    switch (tipo) {
      case 'reservas':
        await this.hojaReservas(wb, filtros);
        break;
      case 'tours':
        await this.hojaTours(wb, filtros);
        break;
      case 'pasajeros_tour':
        await this.hojaPasajerosTour(wb, filtros);
        break;
      case 'clientes':
        await this.hojaClientes(wb, filtros);
        break;
      case 'pagos':
        await this.hojaPagos(wb, filtros);
        break;
      case 'manifest':
        await this.hojaManifest(wb, filtros);
        break;
      case 'cocina':
        await this.hojaCocina(wb, filtros);
        break;
      default:
        throw ApiError.validacion(`Tipo de exportación no soportado: ${tipo}`);
    }

    return wb;
  }

  private async hojaReservas(wb: Workbook, filtros: Record<string, unknown>) {
    const ws = wb.addWorksheet('Reservas');
    ws.columns = [
      { header: 'Código', key: 'codigo', width: 15 },
      { header: 'Titular', key: 'titular', width: 30 },
      { header: 'Tour', key: 'tour', width: 25 },
      { header: 'Fecha Salida', key: 'fecha_salida', width: 15 },
      { header: 'Estado', key: 'estado', width: 15 },
      { header: 'Estado Pago', key: 'estado_pago', width: 15 },
      { header: 'Total USD', key: 'total_usd', width: 12 },
      { header: 'Pasajeros', key: 'pasajeros', width: 10 },
      { header: 'Creada', key: 'creada_en', width: 20 },
    ];

    const d = this.ds.options.type as string;
    const condiciones: string[] = [];
    const params: unknown[] = [];

    if (filtros.estado) {
      condiciones.push(`r.estado = ${ph(d, params.length)}`);
      params.push(filtros.estado);
    }
    if (filtros.fecha_desde) {
      condiciones.push(`ft.fecha_salida >= ${ph(d, params.length)}`);
      params.push(filtros.fecha_desde);
    }
    if (filtros.fecha_hasta) {
      condiciones.push(`ft.fecha_salida <= ${ph(d, params.length)}`);
      params.push(filtros.fecha_hasta);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const rows = await this.ds.query(
      `SELECT r.codigo, r.estado, r.estado_pago, r.total_usd, r.creado_en,
              t.nombre as tour_nombre, ft.fecha_salida,
              (SELECT COUNT(*) FROM pasajero p WHERE p.reserva_id = r.id) as pasajeros
       FROM reserva r
       JOIN fecha_tour ft ON ft.id = r.fecha_tour_id
       JOIN tour t ON t.id = ft.tour_id
       ${where}
       ORDER BY r.creado_en DESC
       LIMIT 10000`,
      params,
    );

    for (const row of rows) {
      ws.addRow({
        codigo: row.codigo ?? '',
        titular: '', // TODO: obtener titular
        tour: row.tour_nombre,
        fecha_salida: row.fecha_salida,
        estado: row.estado,
        estado_pago: row.estado_pago,
        total_usd: row.total_usd,
        pasajeros: row.pasajeros,
        creada_en: row.creado_en,
      });
    }
  }

  private async hojaTours(wb: Workbook, _filtros: Record<string, unknown>) {
    const ws = wb.addWorksheet('Tours');
    ws.columns = [
      { header: 'Nombre', key: 'nombre', width: 30 },
      { header: 'Tipo', key: 'tipo', width: 15 },
      { header: 'Estado', key: 'estado', width: 15 },
      { header: 'Descripción', key: 'descripcion', width: 50 },
    ];

    const tours = await this.ds.getRepository('Tour').find({ order: { nombre: 'ASC' } });
    for (const tour of tours) {
      ws.addRow({
        nombre: tour.nombre,
        tipo: tour.tipo,
        estado: tour.estado,
        descripcion: tour.descripcion ?? '',
      });
    }
  }

  private async hojaPasajerosTour(wb: Workbook, filtros: Record<string, unknown>) {
    const fechaTourId = filtros.fecha_tour_id as string;
    if (!fechaTourId) throw ApiError.validacion('fecha_tour_id es requerido');

    const ws = wb.addWorksheet('Pasajeros');
    ws.columns = [
      { header: 'Nombre', key: 'nombre', width: 30 },
      { header: 'Categoría', key: 'categoria', width: 15 },
      { header: 'Documento', key: 'documento', width: 15 },
      { header: 'Titular', key: 'titular', width: 10 },
      { header: 'Reserva', key: 'reserva', width: 15 },
      { header: 'Punto de salida', key: 'punto_salida', width: 34 },
    ];

    const d = this.ds.options.type as string;
    const rows = await this.ds.query(
      `SELECT p.nombre, p.categoria, p.documento_ultimos4, p.es_titular, p.respuestas,
              r.codigo, r.respuestas_globales
       FROM pasajero p
       JOIN reserva r ON r.id = p.reserva_id
       WHERE r.fecha_tour_id = ${ph(d, 0)}
       ORDER BY p.orden`,
      [fechaTourId],
    );
    const puntos = await this.mapaPuntos();

    for (const row of rows) {
      ws.addRow({
        nombre: row.nombre,
        categoria: row.categoria,
        documento: row.documento_ultimos4 ? `***${row.documento_ultimos4}` : '',
        titular: row.es_titular ? 'Sí' : 'No',
        reserva: row.codigo ?? '',
        punto_salida: this.puntoDeRespuestas(row, puntos),
      });
    }
  }

  /** clave → "Nombre (hora)" del catálogo global de puntos de salida. */
  private async mapaPuntos(): Promise<Map<string, string>> {
    const filas = await this.ds.query(`SELECT clave, nombre, hora FROM punto_salida`);
    return new Map(
      filas.map((f: { clave: string; nombre: string; hora: string }) => [f.clave, `${f.nombre} (${f.hora})`]),
    );
  }

  /**
   * Punto de salida de un pasajero: el suyo si lo definió (salidas
   * personalizadas por miembro), si no el global de la reserva.
   */
  private puntoDeRespuestas(row: Record<string, unknown>, puntos: Map<string, string>): string {
    const parse = (valor: unknown): Record<string, unknown> | null => {
      if (valor && typeof valor === 'object') return valor as Record<string, unknown>;
      if (typeof valor === 'string' && valor) {
        try {
          const obj = JSON.parse(valor);
          return obj && typeof obj === 'object' ? (obj as Record<string, unknown>) : null;
        } catch {
          return null;
        }
      }
      return null;
    };
    const propias = parse(row.respuestas) ?? {};
    const globales = parse(row.respuestas_globales) ?? {};
    const clave = [propias['punto_abordaje'], globales['punto_abordaje']].find((v) => typeof v === 'string' && v);
    if (!clave) return '';
    const claveStr = String(clave);
    if (claveStr === 'caracas') return 'Caracas — punto por confirmar';
    return puntos.get(claveStr) ?? claveStr.replace(/_/g, ' ');
  }

  private async hojaClientes(wb: Workbook, filtros: Record<string, unknown>) {
    const ws = wb.addWorksheet('Clientes');
    ws.columns = [
      { header: 'Nombre', key: 'nombre', width: 30 },
      { header: 'Reservas', key: 'reservas', width: 10 },
      { header: 'Primera Reserva', key: 'primera', width: 15 },
      { header: 'Última Reserva', key: 'ultima', width: 15 },
      { header: 'Anonymized', key: 'anonimizado', width: 12 },
    ];

    const d = this.ds.options.type as string;
    const condiciones: string[] = [];
    const params: unknown[] = [];

    if (filtros.fecha_desde) {
      condiciones.push(`c.creado_en >= ${ph(d, params.length)}`);
      params.push(filtros.fecha_desde);
    }
    if (filtros.fecha_hasta) {
      condiciones.push(`c.creado_en <= ${ph(d, params.length)}`);
      params.push(filtros.fecha_hasta);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const rows = await this.ds.query(
      `SELECT c.nombre_ultimo as nombre,
              COUNT(r.id) as reservas,
              MIN(r.creado_en) as primera,
              MAX(r.creado_en) as ultima,
              c.anonimizado_en
       FROM cliente c
       LEFT JOIN reserva r ON r.cliente_id = c.id
       ${where}
       GROUP BY c.id
       ORDER BY c.nombre_ultimo`,
      params,
    );

    for (const row of rows) {
      ws.addRow({
        nombre: row.nombre,
        reservas: row.reservas,
        primera: row.primera,
        ultima: row.ultima,
        anonimizado: row.anonimizado_en ? 'Sí' : 'No',
      });
    }
  }

  private async hojaPagos(wb: Workbook, filtros: Record<string, unknown>) {
    const ws = wb.addWorksheet('Pagos');
    ws.columns = [
      { header: 'Reserva', key: 'reserva', width: 15 },
      { header: 'Método', key: 'metodo', width: 20 },
      { header: 'Monto', key: 'monto', width: 12 },
      { header: 'Moneda', key: 'moneda', width: 10 },
      { header: 'Estado', key: 'estado', width: 15 },
      { header: 'Fecha Pago', key: 'fecha_pago', width: 15 },
      { header: 'Referencia', key: 'referencia', width: 20 },
    ];

    const d = this.ds.options.type as string;
    const condiciones: string[] = [];
    const params: unknown[] = [];

    if (filtros.estado) {
      condiciones.push(`p.estado = ${ph(d, params.length)}`);
      params.push(filtros.estado);
    }
    if (filtros.fecha_desde) {
      condiciones.push(`p.fecha_pago >= ${ph(d, params.length)}`);
      params.push(filtros.fecha_desde);
    }
    if (filtros.fecha_hasta) {
      condiciones.push(`p.fecha_pago <= ${ph(d, params.length)}`);
      params.push(filtros.fecha_hasta);
    }

    const where = condiciones.length ? `WHERE ${condiciones.join(' AND ')}` : '';
    const rows = await this.ds.query(
      `SELECT p.monto, p.moneda, p.estado, p.fecha_pago, p.referencia,
              r.codigo as reserva_codigo, m.nombre as metodo_nombre
       FROM pago p
       JOIN reserva r ON r.id = p.reserva_id
       JOIN metodo_pago m ON m.id = p.metodo_id
       ${where}
       ORDER BY p.creado_en DESC
       LIMIT 10000`,
      params,
    );

    for (const row of rows) {
      ws.addRow({
        reserva: row.reserva_codigo ?? '',
        metodo: row.metodo_nombre,
        monto: row.monto,
        moneda: row.moneda,
        estado: row.estado,
        fecha_pago: row.fecha_pago,
        referencia: row.referencia ?? '',
      });
    }
  }

  private async hojaManifest(wb: Workbook, filtros: Record<string, unknown>) {
    const fechaTourId = filtros.fecha_tour_id as string;
    if (!fechaTourId) throw ApiError.validacion('fecha_tour_id es requerido');

    const ws = wb.addWorksheet('Manifest');
    ws.columns = [
      { header: 'Orden', key: 'orden', width: 8 },
      { header: 'Nombre', key: 'nombre', width: 30 },
      { header: 'Categoría', key: 'categoria', width: 15 },
      { header: 'Documento', key: 'documento', width: 15 },
      { header: 'Titular', key: 'titular', width: 10 },
      { header: 'Reserva', key: 'reserva', width: 15 },
      { header: 'Teléfono', key: 'telefono', width: 15 },
      { header: 'Punto de salida', key: 'punto_salida', width: 34 },
    ];

    const d = this.ds.options.type as string;
    const rows = await this.ds.query(
      `SELECT p.orden, p.nombre, p.categoria, p.documento_ultimos4, p.es_titular,
              p.telefono, p.respuestas, r.codigo, r.respuestas_globales
       FROM pasajero p
       JOIN reserva r ON r.id = p.reserva_id
       WHERE r.fecha_tour_id = ${ph(d, 0)} AND r.estado != 'cancelada'
       ORDER BY p.orden`,
      [fechaTourId],
    );
    const puntos = await this.mapaPuntos();

    for (const row of rows) {
      ws.addRow({
        orden: row.orden,
        nombre: row.nombre,
        categoria: row.categoria,
        documento: row.documento_ultimos4 ? `***${row.documento_ultimos4}` : '',
        titular: row.es_titular ? 'Sí' : 'No',
        reserva: row.codigo ?? '',
        telefono: row.telefono ?? '',
        punto_salida: this.puntoDeRespuestas(row, puntos),
      });
    }
  }

  private async hojaCocina(wb: Workbook, filtros: Record<string, unknown>) {
    const fechaTourId = filtros.fecha_tour_id as string;
    if (!fechaTourId) throw ApiError.validacion('fecha_tour_id es requerido');

    const ws = wb.addWorksheet('Cocina');
    ws.columns = [
      { header: 'Opción', key: 'opcion', width: 30 },
      { header: 'Cantidad', key: 'cantidad', width: 12 },
    ];

    // Conteo de selecciones de almuerzo (campo 'almuerzo' del formulario).
    // Se agrega en memoria para mantener portabilidad sqlite/postgres.
    const d = this.ds.options.type as string;
    const rows = await this.ds.query(
      `SELECT p.respuestas
       FROM pasajero p
       JOIN reserva r ON r.id = p.reserva_id
       WHERE r.fecha_tour_id = ${ph(d, 0)} AND r.estado != 'cancelada'`,
      [fechaTourId],
    );

    const conteoAlmuerzo = new Map<string, number>();
    const conteoDesayuno = new Map<string, number>();

    for (const row of rows) {
      const respuestas = typeof row.respuestas === 'string' ? JSON.parse(row.respuestas) : row.respuestas;
      const almuerzo = respuestas?.almuerzo;
      if (almuerzo) conteoAlmuerzo.set(almuerzo, (conteoAlmuerzo.get(almuerzo) ?? 0) + 1);

      const desayuno = respuestas?.sabor_desayuno;
      if (desayuno) {
        const opciones = Array.isArray(desayuno) ? desayuno : [desayuno];
        for (const opt of opciones) {
          conteoDesayuno.set(opt, (conteoDesayuno.get(opt) ?? 0) + 1);
        }
      }
    }

    // Sección Almuerzo
    if (conteoAlmuerzo.size > 0) {
      ws.addRow({ opcion: '--- ALMUERZOS ---', cantidad: '' });
      const ordenadas = [...conteoAlmuerzo.entries()].sort((a, b) => b[1] - a[1]);
      for (const [opcion, cantidad] of ordenadas) {
        ws.addRow({ opcion, cantidad });
      }
    }

    // Sección Desayunos
    if (conteoDesayuno.size > 0) {
      ws.addRow({ opcion: '--- DESAYUNOS (EMPANADAS) ---', cantidad: '' });
      const ordenadas = [...conteoDesayuno.entries()].sort((a, b) => b[1] - a[1]);
      for (const [opcion, cantidad] of ordenadas) {
        ws.addRow({ opcion, cantidad });
      }
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

  private validarFiltros(tipo: TipoExportacion, filtros: Record<string, unknown>) {
    if ((tipo === 'pasajeros_tour' || tipo === 'manifest' || tipo === 'cocina') && !filtros.fecha_tour_id) {
      throw ApiError.validacion('fecha_tour_id es requerido para este tipo de exportación');
    }
  }
}
