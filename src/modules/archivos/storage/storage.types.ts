/**
 * Interfaz de almacenamiento de archivos (vouchers, exportaciones, comprobantes).
 *
 * Soporta:
 * - Local (dev/tests): archivos en disco en ./data/storage
 * - S3-compatible (producción): bucket privado con URLs firmadas temporales
 */

export interface ArchivoStorage {
  /**
   * Sube un archivo y devuelve la clave del bucket.
   * @param key - ruta relativa dentro del bucket, ej. "vouchers/abc123.pdf"
   * @param buffer - contenido binario
   * @param mimeType - tipo MIME (application/pdf, image/jpeg, etc.)
   */
  put(key: string, buffer: Buffer, mimeType: string): Promise<void>;

  /**
   * Obtiene el contenido como Buffer.
   * Útil para procesamiento server-side (ej. PDF→imágenes de preview).
   */
  getBuffer(key: string): Promise<Buffer>;

  /**
   * Genera una URL firmada temporal para descarga.
   * La URL expira según `ttlSeconds` (configuración, por defecto 5 min).
   */
  signedDownloadUrl(key: string, ttlSeconds?: number): Promise<string>;

  /**
   * Obtiene metadatos básicas (tamaño, si existe).
   */
  head(key: string): Promise<{ size: number } | null>;

  /**
   * Elimina un archivo.
   */
  delete(key: string): Promise<void>;
}
