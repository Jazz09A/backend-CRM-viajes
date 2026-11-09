import { Injectable } from '@nestjs/common';
import { LimiteIntentosGuard } from '../../common/guards/limite-intentos.guard';

/**
 * Límite de intentos para el alta del administrador inicial.
 *
 * 5 intentos por IP cada 15 minutos: suficiente para corregir un formulario y
 * suficiente para frenar un alta masiva sobre una instalación nueva.
 */
@Injectable()
export class SetupLimiteGuard extends LimiteIntentosGuard {
  constructor() {
    super(5, 15 * 60 * 1000);
  }
}
