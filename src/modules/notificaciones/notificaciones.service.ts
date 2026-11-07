import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { NotificacionPanel } from '../../database/entities';
import { Rol } from '../../common/decorators/roles.decorator';
import { NotificacionesGateway } from './notificaciones.gateway';
import { notificacionPublica } from '../publico/serializers';

export interface NuevaNotificacion {
  /** Rol destinatario, o 'todos' para todo el panel. */
  rol: Rol | 'todos';
  tipo: string;
  titulo: string;
  cuerpo?: string;
  datos?: Record<string, unknown>;
}

@Injectable()
export class NotificacionesService {
  constructor(
    @InjectRepository(NotificacionPanel) private readonly repo: Repository<NotificacionPanel>,
    private readonly gateway: NotificacionesGateway,
  ) {}

  listarParaRol(rol: Rol) {
    return this.repo.find({
      where: [{ rol }, { rol: 'todos' }],
      order: { creado_en: 'DESC' },
      take: 50,
    });
  }

  async marcarLeida(id: string) {
    const n = await this.repo.findOne({ where: { id } });
    if (n) {
      n.leida = true;
      n.leida_en = new Date();
      await this.repo.save(n);
    }
    return n;
  }

  /**
   * Persiste una notificación del panel y la empuja por WebSocket a los
   * admins conectados. La usa el worker de jobs al terminar tareas.
   */
  async crear(n: NuevaNotificacion) {
    const guardada = await this.repo.save(
      this.repo.create({
        rol: n.rol,
        tipo: n.tipo,
        titulo: n.titulo,
        cuerpo: n.cuerpo ?? null,
        datos: n.datos ?? null,
        leida: false,
      }),
    );
    this.gateway.emitirNotificacion(notificacionPublica(guardada));
    return guardada;
  }
}
