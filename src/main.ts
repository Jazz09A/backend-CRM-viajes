import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyMultipart from '@fastify/multipart';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';
import { loadConfig } from './config/configuration';
import { ProblemDetailsFilter } from './common/filters/problem-details.filter';
import { RequestIdInterceptor } from './common/interceptors/request-id.interceptor';

async function bootstrap() {
  const config = loadConfig();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    // bodyLimit: las fotos del documento viajan en base64 dentro del JSON
    // (5 MB binarios ≈ 6.7 MB en base64); el default de1 MB no alcanzaba.
    new FastifyAdapter({ logger: false, trustProxy: true, bodyLimit: 8 * 1024 * 1024 }),
  );

  await app.register(fastifyMultipart, { limits: { fileSize: 10 * 1024 * 1024 } });
  app.setGlobalPrefix('api/v1', { exclude: ['metrics'] });
  app.enableCors({
    origin: config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Enlace-Token', 'X-Request-Id', 'Idempotency-Key', 'If-Match'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalInterceptors(new RequestIdInterceptor());

  // Registrar interceptor de métricas de forma condicional
  const metricsEnabled = process.env.METRICS_ENABLED !== 'false';
  if (metricsEnabled) {
    app.useGlobalInterceptors(new MetricsInterceptor());
  }

  app.enableShutdownHooks();

  await app.listen(config.port, '0.0.0.0');
  // eslint-disable-next-line no-console
  console.log(`API lista en http://localhost:${config.port}/api/v1  (driver: ${config.dbDriver})`);
}

void bootstrap();
