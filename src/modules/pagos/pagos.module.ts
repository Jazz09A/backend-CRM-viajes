import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Pago, Reembolso, Reserva } from '../../database/entities';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { ReservasModule } from '../reservas/reservas.module';
import { PagosController } from './pagos.controller';
import { PagosService } from './pagos.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pago, Reembolso, Reserva]),
    ConfiguracionModule,
    ReservasModule,
  ],
  controllers: [PagosController],
  providers: [PagosService],
  exports: [PagosService],
})
export class PagosModule {}
