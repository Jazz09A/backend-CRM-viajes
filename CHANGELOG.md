# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.
El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto adhiere a [Versionado Semántico](https://semver.org/lang/es/).

## [1.0.0] - 2026-11-23

Primera versión estable de la API de Escapate Tours.

### Añadido

- API NestJS + Fastify con TypeScript: reservas, pagos, salidas, tours,
  clientes, reportes y configuración.
- Onboarding del primer administrador (`GET/POST /api/v1/setup/estado|iniciar`)
  con claim atómico y sesión inmediata.
- Autenticación JWT (access en memoria del cliente + refresh por cookie
  HttpOnly), roles/permisos y auditoría.
- Catálogo de tours por documento con importador CLI
  (`importar-escapate`).
- Vouchers PDF generados con Playwright (worker + outbox), exportaciones
  XLSX asincrónicas y almacenamiento de archivos con URLs firmadas.
- Soporte SQLite (dev) y PostgreSQL/Neon (producción) con migraciones
  versionadas.
- Marca Escapate Tours en voucher, exportaciones y seeds.

### Corregido

- Onboarding: upsert de `configuracion` para no chocar con las claves
  `agencia_*` que ya crea el seed (500 ERROR_INTERNO).
