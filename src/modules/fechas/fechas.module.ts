import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CupoOpcion, FechaSobrecupo, FechaTour, Tarifa, Tour } from '../../database/entities';
import { FechasController } from './fechas.controller';
import { FechasService } from './fechas.service';

@Module({
  imports: [TypeOrmModule.forFeature([FechaTour, Tarifa, CupoOpcion, FechaSobrecupo, Tour])],
  controllers: [FechasController],
  providers: [FechasService],
  exports: [FechasService],
})
export class FechasModule {}
