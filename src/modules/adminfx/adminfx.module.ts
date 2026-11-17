import { Module } from '@nestjs/common';
import { AdminFxController } from './adminfx.controller';
import { AdminFxService } from './adminfx.service';
import { ConfiguracionModule } from '../configuracion/configuracion.module';
import { CatalogoModule } from '../catalogo/catalogo.module';
import { CuposModule } from '../cupos/cupos.module';
import { FechasModule } from '../fechas/fechas.module';
import { PagosModule } from '../pagos/pagos.module';
import { ReservasModule } from '../reservas/reservas.module';
import { ToursModule } from '../tours/tours.module';
import { ArchivosModule } from '../archivos/archivos.module';

@Module({
  imports: [
    ConfiguracionModule,
    CatalogoModule,
    CuposModule,
    FechasModule,
    PagosModule,
    ReservasModule,
    ToursModule,
    ArchivosModule,
  ],
  controllers: [AdminFxController],
  providers: [AdminFxService],
})
export class AdminFxModule {}
