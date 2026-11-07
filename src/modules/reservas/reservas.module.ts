import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  EnlaceReserva,
  FechaTour,
  Pasajero,
  Reserva,
  ReservaEstadoHistorial,
  Tour,
  TourFormVersion,
  Voucher,
} from '../../database/entities';
import { CuposModule } from '../cupos/cupos.module';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { ReservasController } from './reservas.controller';
import { ReservasService } from './reservas.service';
import { ReservaStateMachine } from './reserva-state-machine';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Reserva,
      EnlaceReserva,
      Pasajero,
      FechaTour,
      Tour,
      TourFormVersion,
      ReservaEstadoHistorial,
      Voucher,
    ]),
    CuposModule,
    ConfiguracionModule,
  ],
  controllers: [ReservasController],
  providers: [ReservasService, ReservaStateMachine],
  exports: [ReservasService, ReservaStateMachine],
})
export class ReservasModule {}
