import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Configuracion,
  TasaCambio,
  MetodoPago,
  PlantillaTerminos,
  PlantillaTerminosVersion,
  PoliticaCancelacion,
  CodigoPromocional,
} from '../../database/entities';
import { ConfiguracionController } from './configuracion.controller';
import { ConfiguracionService } from './configuracion.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Configuracion,
      TasaCambio,
      MetodoPago,
      PlantillaTerminos,
      PlantillaTerminosVersion,
      PoliticaCancelacion,
      CodigoPromocional,
    ]),
  ],
  controllers: [ConfiguracionController],
  providers: [ConfiguracionService],
  exports: [ConfiguracionService],
})
export class ConfiguracionModule {}
