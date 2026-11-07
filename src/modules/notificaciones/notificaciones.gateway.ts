import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { IncomingMessage } from 'http';
import type { Server as HttpServer } from 'http';
import { WebSocket, WebSocketServer } from 'ws';

const RUTA_WS = '/ws';

/**
 * Gateway WebSocket para notificaciones del panel admin.
 *
 * Se monta manualmente sobre el servidor HTTP de Fastify en la ruta `/ws`.
 * El navegador no puede enviar `Authorization` en el handshake, así que el
 * access token viaja como `?token=` y se verifica con el mismo JwtService
 * del guard HTTP. Solo emite hacia los clientes: el panel no envía mensajes.
 */
@Injectable()
export class NotificacionesGateway implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificacionesGateway.name);
  private wss?: WebSocketServer;
  private readonly clientes = new Set<WebSocket>();

  constructor(
    private readonly http: HttpAdapterHost,
    private readonly jwt: JwtService,
  ) {}

  onModuleInit() {
    // FastifyAdapter.getHttpServer() devuelve la instancia de Fastify;
    // el servidor HTTP crudo está en `.server`.
    const adaptador = this.http.httpAdapter.getHttpServer() as unknown;
    const httpServer =
      (adaptador as { server?: HttpServer }).server ?? (adaptador as HttpServer);
    if (typeof (httpServer as HttpServer).on !== 'function') {
      this.logger.warn('No se pudo montar el gateway WS: servidor HTTP no disponible');
      return;
    }

    this.wss = new WebSocketServer({ server: httpServer, path: RUTA_WS });
    this.wss.on('connection', (ws: WebSocket, req: IncomingMessage) => {
      void this.autenticar(ws, req);
    });
    this.logger.log(`WebSocket de notificaciones escuchando en ${RUTA_WS}`);
  }

  onModuleDestroy() {
    for (const cliente of this.clientes) cliente.close();
    this.clientes.clear();
    this.wss?.close();
  }

  /** Reenvía una notificación ya serializada a todos los admins conectados. */
  emitirNotificacion(payload: Record<string, unknown>) {
    if (!this.wss || this.clientes.size === 0) return;
    const mensaje = JSON.stringify({ type: 'notificacion', data: payload });
    for (const cliente of this.clientes) {
      if (cliente.readyState === WebSocket.OPEN) cliente.send(mensaje);
    }
  }

  private async autenticar(ws: WebSocket, req: IncomingMessage) {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const token = url.searchParams.get('token');
      if (!token) throw new Error('sin token');
      await this.jwt.verifyAsync(token);
      this.clientes.add(ws);
      ws.on('close', () => this.clientes.delete(ws));
      ws.on('error', () => this.clientes.delete(ws));
    } catch {
      ws.close(4401, 'No autenticado');
    }
  }
}
