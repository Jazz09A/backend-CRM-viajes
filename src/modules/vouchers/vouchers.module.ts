import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Archivo,
  Configuracion,
  FechaTour,
  Firma,
  OutboxEvento,
  Pasajero,
  Pago,
  Reserva,
  Tour,
  TourPuntoAbordaje,
  Voucher,
} from '../../database/entities';
import { ArchivosModule } from '../archivos/archivos.module';
import { VouchersController } from './vouchers.controller';
import { VouchersService } from './vouchers.service';
import { VoucherPdfService } from './voucher-pdf.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Voucher,
      Archivo,
      Reserva,
      Pasajero,
      Pago,
      FechaTour,
      Tour,
      TourPuntoAbordaje,
      Firma,
      Configuracion,
      OutboxEvento,
    ]),
    ConfigModule,
    ArchivosModule,
  ],
  controllers: [VouchersController],
  providers: [VouchersService, VoucherPdfService],
  exports: [VouchersService, VoucherPdfService],
})
export class VouchersModule {}
