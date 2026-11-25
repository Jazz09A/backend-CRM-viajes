import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { APP_GUARD } from '@nestjs/core';
import { AppConfig, loadConfig } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { JwtAuthGuard, RolesGuard } from './common/guards/auth.guard';
import { HealthModule } from './modules/health/health.module';
import { AuthModule } from './modules/auth/auth.module';
import { SetupModule } from './modules/setup/setup.module';
import { UsuariosModule } from './modules/usuarios/usuarios.module';
import { ConfiguracionModule } from './modules/configuracion/configuracion.module';
import { ToursModule } from './modules/tours/tours.module';
import { FechasModule } from './modules/fechas/fechas.module';
import { ReservasModule } from './modules/reservas/reservas.module';
import { PublicoModule } from './modules/publico/publico.module';
import { PagosModule } from './modules/pagos/pagos.module';
import { VouchersModule } from './modules/vouchers/vouchers.module';
import { ArchivosModule } from './modules/archivos/archivos.module';
import { AuditoriaModule } from './modules/auditoria/auditoria.module';
import { NotificacionesModule } from './modules/notificaciones/notificaciones.module';
import { ReportesModule } from './modules/reportes/reportes.module';
import { ExportacionesModule } from './modules/exportaciones/exportaciones.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { AdminFxModule } from './modules/adminfx/adminfx.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { MetricsInterceptor } from './modules/metrics/metrics.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [() => loadConfig()],
    }),
    JwtModule.registerAsync({
      global: true,
      inject: [ConfigService],
      useFactory: (config: ConfigService<AppConfig, true>) => ({
        secret: config.get('jwtSecret', { infer: true }),
        signOptions: { expiresIn: config.get('jwtAccessTtl', { infer: true }) as never },
      }),
    }),
    DatabaseModule,
    HealthModule,
    AuthModule,
    SetupModule,
    UsuariosModule,
    ConfiguracionModule,
    ToursModule,
    FechasModule,
    ReservasModule,
    PublicoModule,
    PagosModule,
    VouchersModule,
    ArchivosModule,
    AuditoriaModule,
    NotificacionesModule,
    ReportesModule,
    ExportacionesModule,
    JobsModule,
    AdminFxModule,
    MetricsModule,
  ],
  providers: [
    // Guards globales: JWT en todo salvo @Public(); RBAC donde haya @Roles().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    // Interceptor global de métricas (solo si METRICS_ENABLED=true en config)
    {
      provide: 'METRICS_ENABLED',
      useFactory: (config: ConfigService<AppConfig, true>) => {
        const v = (process.env.METRICS_ENABLED ?? 'true').toLowerCase();
        return v !== 'false';
      },
      inject: [ConfigService],
    },
    {
      provide: MetricsInterceptor,
      useFactory: (enabled: boolean) => enabled ? new MetricsInterceptor() : null,
      inject: ['METRICS_ENABLED'],
    },
  ],
})
export class AppModule {}
