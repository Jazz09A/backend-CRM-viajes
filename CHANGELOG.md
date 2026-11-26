# Changelog

Todos los cambios notables de este proyecto se documentan en este archivo.
El formato está basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/)
y este proyecto adhiere a [Versionado Semántico](https://semver.org/lang/es/).

## [1.1.0](https://github.com/Jazz09A/backend-CRM-viajes/compare/v1.0.0...v1.1.0) (2026-11-26)


### Features

* **auth:** nuevo rol administrador ([9fb3e86](https://github.com/Jazz09A/backend-CRM-viajes/commit/9fb3e86c493707dc93409e8c1b40db2f567a044e))
* **auth:** nuevo rol administrador (superadmin sin auditoría ni usuarios) ([83922f7](https://github.com/Jazz09A/backend-CRM-viajes/commit/83922f76ac8cf4e0c05f6e3ce788c23d6b011cec))
* backend support for Ruta Clara plan (payment at link creation, 0% cancellation, breakfast flavors, exportaciones) ([dd1d480](https://github.com/Jazz09A/backend-CRM-viajes/commit/dd1d4803e1f39ed5f7b7ea0564675fcdfd1df9c1))
* **brand:** rebranding a Escapate Tours en voucher y textos ([5f0423e](https://github.com/Jazz09A/backend-CRM-viajes/commit/5f0423ef0a9340dfac23acf210f61d3917200aa6))
* **metrics:** integra Prometheus — endpoint /metrics, interceptor HTTP y métricas de negocio ([f149137](https://github.com/Jazz09A/backend-CRM-viajes/commit/f149137cac54dc83cf0dd1cc5805f126c866ba69))
* sabores de desayuno en el seed demo y conteo robusto en cocina ([3c7339b](https://github.com/Jazz09A/backend-CRM-viajes/commit/3c7339b00c1180de3e69dccd4ce609b9686e9736))
* **security:** separar variables de entorno + fix(vouchers): tamaño de firma ([33d1329](https://github.com/Jazz09A/backend-CRM-viajes/commit/33d1329bbf7eb57fe374e50afd74d9a5e2ad1159))
* **security:** separar variables de entorno local y producción ([a4887d8](https://github.com/Jazz09A/backend-CRM-viajes/commit/a4887d857ac0566695aac8bc8b374fbf63370bf5))
* voucher formal, desayuno de empanadas y puntos de salida por pasajero ([6ae5dbd](https://github.com/Jazz09A/backend-CRM-viajes/commit/6ae5dbd05ec8925b131a6ebf82894a4278e01c57))
* **vouchers:** nuevo formato formal + selección de desayuno y puntos por pasajero ([d47cdf6](https://github.com/Jazz09A/backend-CRM-viajes/commit/d47cdf6ee3dd09b6ee320613960666f5d2d8c8c6))


### Bug Fixes

* **adminfx:** resolver cliente por documento en claro y 404 ante uuid inválido ([c66d1c2](https://github.com/Jazz09A/backend-CRM-viajes/commit/c66d1c27092ed99f576de881d07fd2167cbdf393))
* **adminfx:** resolver cliente por documento en claro y 404 ante uuid inválido ([597a700](https://github.com/Jazz09A/backend-CRM-viajes/commit/597a700a727031b83c739b4848172fb5ab0a803a))
* **deploy:** aumentar espera de healthcheck a 60 segundos ([8cc69d2](https://github.com/Jazz09A/backend-CRM-viajes/commit/8cc69d215b1e48daef0c4c73ae3f1d265fa62403))
* **deploy:** aumentar espera de healthcheck a 60s ([22f24e7](https://github.com/Jazz09A/backend-CRM-viajes/commit/22f24e740ccb5184b2eb6eed4653e72e6c94566c))
* **deploy:** compose apunta a GHCR y CD usa la ruta real del server ([bd4f85f](https://github.com/Jazz09A/backend-CRM-viajes/commit/bd4f85fc0bb8943baf9a533ecb146a4caf84a392))
* **deploy:** corregir rutas del servidor ([55a5b54](https://github.com/Jazz09A/backend-CRM-viajes/commit/55a5b54eb5246eba931c5a96b8a34af1bfaffc14))
* **deploy:** corregir rutas del servidor a /home/alvaro ([bbe4147](https://github.com/Jazz09A/backend-CRM-viajes/commit/bbe4147bbbb7ed2059dd0d79c768976718fc0f1f))
* **deploy:** corregir sintaxis YAML del workflow ([c0f4de7](https://github.com/Jazz09A/backend-CRM-viajes/commit/c0f4de720506fabbb7aa3cc35c89b5f39bdf4911))
* **deploy:** corregir sintaxis YAML y transferencia de .env ([83d8b52](https://github.com/Jazz09A/backend-CRM-viajes/commit/83d8b52f991c49a38e82fba2d8d3e31e6eba360d))
* **deploy:** expandir variables en heredoc del .env ([2ec0e87](https://github.com/Jazz09A/backend-CRM-viajes/commit/2ec0e877241e5974ad3ba046ba857ff56612b5ac))
* **deploy:** expandir variables en heredoc del .env ([c3eaf95](https://github.com/Jazz09A/backend-CRM-viajes/commit/c3eaf95b603aaefd32a9de04fb9e7effd2d19727))
* **deploy:** mejorar creación de .env y forzar recreación ([9d9ee75](https://github.com/Jazz09A/backend-CRM-viajes/commit/9d9ee75583c737fdf2954d24bf6f25acbe023b8e))
* **deploy:** mejorar creación de .env y forzar recreación de contenedor ([3a657e1](https://github.com/Jazz09A/backend-CRM-viajes/commit/3a657e1ba2c466d10bdd1d251b1389572f682294))
* **deploy:** quitar channel_binding=require de DATABASE_URL ([447c040](https://github.com/Jazz09A/backend-CRM-viajes/commit/447c04041709c6f94ea08b67b9838f40a65832dc))
* **deploy:** quitar channel_binding=require de DATABASE_URL ([d1b095f](https://github.com/Jazz09A/backend-CRM-viajes/commit/d1b095fe3d6b976740cc6845e69169fb2ea12064))
* **deploy:** quitar volumen de storage local del compose de producción ([086f55c](https://github.com/Jazz09A/backend-CRM-viajes/commit/086f55c254c18a3955e3d2b8cfb5b05b70adf61a))
* **deploy:** usar .env.prod en lugar de .env ([d1f80b1](https://github.com/Jazz09A/backend-CRM-viajes/commit/d1f80b142a997b7f882743975759c36350971f32))
* **deploy:** usar .env.prod en lugar de .env ([26de59a](https://github.com/Jazz09A/backend-CRM-viajes/commit/26de59ada251ac9b5c7103be7ab1347a090ff43c))
* **deploy:** usar printf en lugar de heredoc para .env ([fc9d903](https://github.com/Jazz09A/backend-CRM-viajes/commit/fc9d903f856dc21f3b02a28226b6570dde7664b2))
* **deploy:** usar printf para .env (evitar heredoc) ([6e2a8bc](https://github.com/Jazz09A/backend-CRM-viajes/commit/6e2a8bc7d650afbb99b1599269aac680179d7801))
* **deps:** fastify como dependencia directa + integración Neon ([6d0ad6a](https://github.com/Jazz09A/backend-CRM-viajes/commit/6d0ad6af171f8878f895c6deaf62aaceef649b16))
* **metrics:** registry único, DI correcta y status de errores en interceptor ([abd87e8](https://github.com/Jazz09A/backend-CRM-viajes/commit/abd87e8b1ff74cc1c4c791e7c02c820db06eaea8))
* **setup:** upsert de configuración de agencia en el onboarding ([159f963](https://github.com/Jazz09A/backend-CRM-viajes/commit/159f9631163a128aa6220e132ba7ea2249f852bd))
* **vouchers:** ajustar tamaño de caja de firma y altura de imagen ([d8393ab](https://github.com/Jazz09A/backend-CRM-viajes/commit/d8393ab6125db751fef0f8117658a40bdae683f9))
* **vouchers:** firma de la empresa ahora se renderiza más grande ([b2529a1](https://github.com/Jazz09A/backend-CRM-viajes/commit/b2529a1d4f89aeabc1d17f5887dc76e6b2bf9d25))
* **vouchers:** firma de la empresa más grande en el voucher ([ad2bc5f](https://github.com/Jazz09A/backend-CRM-viajes/commit/ad2bc5f9461e44d68c12932b2b434850fa2e4977))
* **voucher:** subida idempotente de archivos y caja de firma ampliada ([ef634c1](https://github.com/Jazz09A/backend-CRM-viajes/commit/ef634c19eef5b77f4e5c25d86a2ad27b78ced8a5))

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
