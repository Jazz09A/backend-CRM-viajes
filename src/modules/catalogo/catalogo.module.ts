import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  FechaTour,
  PlantillaTerminos,
  PoliticaCancelacion,
  PuntoSalida,
  Tarifa,
  Tour,
  TourFormVersion,
  TourPrecio,
  TourPuntoAbordaje,
} from '../../database/entities';
import { CatalogoService } from './catalogo.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tour,
      TourPrecio,
      TourPuntoAbordaje,
      TourFormVersion,
      FechaTour,
      Tarifa,
      PuntoSalida,
      PoliticaCancelacion,
      PlantillaTerminos,
    ]),
  ],
  providers: [CatalogoService],
  exports: [CatalogoService],
})
export class CatalogoModule {}
