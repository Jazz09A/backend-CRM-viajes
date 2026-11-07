import { Module } from '@nestjs/common';
import { ExportacionesModule } from '../exportaciones/exportaciones.module';
import { NotificacionesModule } from '../notificaciones/notificaciones.module';
import { VouchersModule } from '../vouchers/vouchers.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [VouchersModule, ExportacionesModule, NotificacionesModule],
  providers: [JobsService],
  exports: [JobsService],
})
export class JobsModule {}
