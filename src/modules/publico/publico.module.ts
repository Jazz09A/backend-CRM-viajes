import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Archivo,
  CodigoPromocional,
  CupoOpcion,
  EnlaceReserva,
  FechaTour,
  Firma,
  Idempotencia,
  MetodoPago,
  Pasajero,
  Pago,
  PlantillaTerminos,
  PlantillaTerminosVersion,
  PoliticaCancelacion,
  Reserva,
  ReservaAjuste,
  TasaCambio,
  Tarifa,
  Tour,
  TourFormVersion,
  TourPuntoAbordaje,
  Voucher,
} from '../../database/entities';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { CuposModule } from '../cupos/cupos.module';
import { PagosModule } from '../pagos/pagos.module';
import { ReservasModule } from '../reservas/reservas.module';
import { ArchivosModule } from '../archivos/archivos.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { PublicoController } from './publico.controller';
import { PublicoService } from './publico.service';
import { EnlaceAuthGuard } from './enlace-auth.guard';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Reserva,
      EnlaceReserva,
      Pasajero,
      FechaTour,
      Tarifa,
      CupoOpcion,
      Tour,
      TourFormVersion,
      TourPuntoAbordaje,
      MetodoPago,
      Pago,
      ReservaAjuste,
      Firma,
      Voucher,
      PlantillaTerminosVersion,
      PlantillaTerminos,
      PoliticaCancelacion,
      TasaCambio,
      CodigoPromocional,
      Archivo,
      Idempotencia,
    ]),
    ConfiguracionModule,
    CuposModule,
    ReservasModule,
    PagosModule,
    ArchivosModule,
    VouchersModule,
  ],
  controllers: [PublicoController],
  providers: [PublicoService, EnlaceAuthGuard],
})
export class PublicoModule {}
