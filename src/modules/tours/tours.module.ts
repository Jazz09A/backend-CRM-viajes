import { Module } from '@nestjs/common';
import { CuposModule } from '../cupos/cupos.module';
import { ToursController } from './tours.controller';
import { ToursService } from './tours.service';

@Module({
  imports: [CuposModule],
  controllers: [ToursController],
  providers: [ToursService],
  exports: [ToursService],
})
export class ToursModule {}
