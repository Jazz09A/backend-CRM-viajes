import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CupoMovimiento, CupoOpcion, FechaTour } from '../../database/entities';
import { CuposService } from './cupos.service';

@Module({
  imports: [TypeOrmModule.forFeature([FechaTour, CupoOpcion, CupoMovimiento])],
  providers: [CuposService],
  exports: [CuposService],
})
export class CuposModule {}
