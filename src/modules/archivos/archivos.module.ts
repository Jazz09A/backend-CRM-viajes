import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Archivo } from '../../database/entities';
import { ArchivosController } from './archivos.controller';
import { ArchivosService } from './archivos.service';

@Module({
  imports: [TypeOrmModule.forFeature([Archivo]), ConfigModule],
  controllers: [ArchivosController],
  providers: [ArchivosService],
  exports: [ArchivosService],
})
export class ArchivosModule {}
