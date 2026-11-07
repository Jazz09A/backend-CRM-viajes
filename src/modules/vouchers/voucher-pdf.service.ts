import { Injectable, Logger } from '@nestjs/common';
import { chromium } from 'playwright';

const PDF_TIMEOUT_MS = 20_000;

/**
 * Servicio de generación de PDFs usando Playwright.
 *
 * Renderiza HTML a PDF con Chromium headless.
 * Timeout: 20 segundos por voucher.
 */
@Injectable()
export class VoucherPdfService {
  private readonly logger = new Logger(VoucherPdfService.name);

  /**
   * Genera un PDF a partir de HTML.
   * @param html - contenido HTML completo
   * @returns Buffer con el PDF
   */
  async generarPdf(html: string): Promise<Buffer> {
    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
      });

      const page = await browser.newPage();
      page.setDefaultTimeout(PDF_TIMEOUT_MS);
      await page.setContent(html, { waitUntil: 'load' });

      const pdf = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' },
      });

      return Buffer.from(pdf);
    } catch (error) {
      this.logger.error(`Error generando PDF: ${error}`);
      throw error;
    } finally {
      if (browser) await browser.close();
    }
  }
}
