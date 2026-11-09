import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Configuracion, Usuario } from '../../database/entities';
import { AuthModule } from '../auth/auth.module';
import { SetupController } from './setup.controller';
import { SetupLimiteGuard } from './setup-limite.guard';
import { SetupService } from './setup.service';

@Module({
  imports: [TypeOrmModule.forFeature([Usuario, Configuracion]), AuthModule],
  controllers: [SetupController],
  providers: [SetupService, SetupLimiteGuard],
})
export class SetupModule {}
