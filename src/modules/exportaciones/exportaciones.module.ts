import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Exportacion } from '../../database/entities';
import { ArchivosModule } from '../archivos/archivos.module';
import { ExportacionesController } from './exportaciones.controller';
import { ExportacionesService } from './exportaciones.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Exportacion]),
    ArchivosModule,
  ],
  controllers: [ExportacionesController],
  providers: [ExportacionesService],
  exports: [ExportacionesService],
})
export class ExportacionesModule {}
