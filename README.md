# Backend — Ruta Clara Viajes API

API NestJS + Fastify + TypeORM del sistema de reservas. SQLite en
desarrollo/tests (`synchronize`), PostgreSQL en producción (`DATABASE_URL`).

> **Repositorio independiente**: este directorio es un repo separado del
> frontend (`../ruta-clara-travel-vouchers`). Hacer commits por separado.

## Arranque

```bash
npm install
npm run seed        # datos demo (usuarios, catálogo, fechas, tarifas, promos)
npm run start:dev   # http://localhost:3001/api/v1
```

Otros comandos: `npm run typecheck`, `npm run build`, `npm run test`,
`npm run start:prod`.

## Primer arranque (onboarding)

La instalación **no crea ningún administrador por defecto**: las credenciales
semilla conocidas (`admin@agencia.local` / `admin123`) se eliminaron. La
primera vez, el frontend entra a `/instalar` y crea la cuenta:

- `GET /setup/estado` → `{ requiere_onboarding: boolean }` (público). Es
  `true` mientras no exista un usuario **activo** con rol `superadmin`.
- `POST /setup/iniciar` → crea ese administrador (contraseña con scrypt) y
  guarda los datos de la agencia (`agencia_nombre`, `agencia_email`,
  `agencia_direccion`, `whatsapp_agencia`, `zona_horaria`). La respuesta
  incluye la sesión ya iniciada (access token + cookie de refresh).

Sólo puede ejecutarse una vez: el arranque se reclama con la clave única
`setup_completado` en `configuracion` dentro de una transacción, así que dos
peticiones simultáneas producen una sola alta y la otra recibe 409
(`SETUP_YA_COMPLETADO`). El alta tiene un límite de 5 intentos por IP cada
15 minutos (`DEMASIADAS_SOLICITUDES`).

En desarrollo, para ver el onboarding hay que sembrar sin usuarios:

```bash
SEED_DEMO=false npm run seed   # base vacía → /instalar
```

`SEED_ADMIN_CORREO` + `SEED_ADMIN_PASSWORD` siguen existiendo, pero sólo se
aplican fuera de producción (para pruebas automatizadas).

## Autenticación

- `POST /auth/login` → access token JWT + cookie HttpOnly de refresh.
- `POST /auth/refresh`, `POST /auth/logout`, `GET /auth/yo`.
- `GET /public/agencia` → nombre y contacto de la agencia (público; lo fija
  el onboarding).
- **2FA desactivado** del flujo: no hay `/auth/2fa/*`; las columnas
  `dos_fa_activo`/`totp_secret_enc` quedan por compatibilidad.
- Roles: `superadmin`, `operador`, `validador`, `guia` (RBAC con `@Roles`).
- Rutas públicas se marcan con `@Public()`; el resto exige JWT.

## Módulos principales

| Módulo | Responsabilidad |
| --- | --- |
| `auth` | Login/refresh/logout, bloqueo por intentos, rotación de refresh |
| `setup` | Onboarding del primer arranque: alta del administrador inicial |
| `publico` | Flujo público de reserva por token de enlace (`/public/*`), verificación QR |
| `reservas` | CRUD admin, máquina de estados (`ReservaStateMachine`), timeline, enlaces |
| `pagos` | Cola de pagos, aprobación/rechazo/reembolso, comprobantes |
| `vouchers` | Generación PDF (Playwright), versionado, regeneración, URL de descarga |
| `archivos` | Storage abstraction (local/S3), upload, URLs firmadas |
| `exportaciones` | Exportaciones XLSX asíncronas con historial y expiración |
| `jobs` | Loop de fondo: outbox, expiración de reservas, cierre de viajes |
| `adminfx` | BFF/fachada para el panel admin; delega mutaciones a servicios de dominio |
| `configuracion`, `catalogo`, `cupos`, `fechas`, `tours`, `clientes`, `auditoria` | Dominios de soporte |

### Confirmación manual de la reserva

Cuando el titular **no reporta el pago** (la agencia lo cobra por adelantado,
por transferencia o en el punto de encuentro) la reserva se queda en
`pendiente_pago` y nadie la avanza: el cliente no tiene el paso de reporte y
la cola de pagos no ve nada que validar.

`POST /adminfx/reservas/:id/confirmar` (SA/OP/VAL) la confirma: asigna el
código `VJ-AAAA-NNNNN`, convierte el hold en venta y encola la generación del
voucher. No exige saldo cero — la agencia puede confirmar con un abono y
cobrar el resto al abordar — pero sí que no queden pagos por validar y que la
firma de términos esté vigente.

Además, `POST /adminfx/pagos/:reserva_id/efectivo` confirma sola la reserva
cuando el pago en efectivo cubre el saldo.

## Regla de oro

Ningún controlador cambia `reserva.estado` directamente: toda transición pasa
por `ReservaStateMachine.transicionar()`, que valida guardas, aplica efectos,
escribe historial y emite eventos al outbox — en una transacción.

## Outbox y jobs

Las mutaciones escriben eventos en `outbox_evento` dentro de la misma
transacción. `JobsService` (loop cada 60 s en dev) despacha:

- `voucher.generar` → `VouchersService.procesarVoucher` (PDF → storage → `Archivo`)
- `exportacion.generar` → `ExportacionesService.procesar` (XLSX → storage)
- `reserva.expirar`, `reserva.confirmada`, `pago.reportado`, etc.

En producción estos eventos deben consumirlos un worker dedicado (BullMQ/Redis).

## Vouchers

1. `confirmar_pago` (pago completo aprobado) → reserva `confirmada`, código
   `VJ-AAAA-NNNNN`, `Voucher` v1 `generando` + outbox `voucher.generar`.
2. El worker renderiza HTML (`voucher-template.ts`, QR local con `qrcode`
   apuntando a `{PUBLIC_APP_URL}/v/{verif_token}`) → PDF con Playwright
   (timeout 20 s) → `ArchivosService.subir` → `voucher.archivo_id`,
   `estado='listo'`, `vigente=true`; versiones anteriores → `reemplazado`.
3. Descarga admin: `GET /vouchers/:id/descarga` → URL firmada (5 min).
   Público: `GET /public/reserva/voucher` (header `X-Enlace-Token`) devuelve
   estado + `url_descarga`; `GET /public/voucher/:id/descarga?t=` exige el
   token del enlace y que la reserva coincida.
4. Cancelar la reserva → vouchers vigentes pasan a `invalidado`; el QR
   (`GET /public/verificar/:token`) reporta el estado.

## Archivos y storage

`ArchivoStorage` (`src/modules/archivos/storage/`):

- `local` (dev/tests): disco en `STORAGE_LOCAL_DIR` (def. `./data/storage`).
  Las URLs firmadas son HMAC servidas por `GET /api/v1/archivos/local/*`
  (firma `HMAC_SHA256(key:exp, FILE_SIGNING_SECRET)`, `@Public()`).
- `s3`: bucket privado S3-compatible con URLs firmadas (`@aws-sdk/*`).

`ArchivosService` centraliza upload + registro `Archivo` (sha256, MIME real,
tamaño, propósito, `reserva_id`) y URLs firmadas. Nunca exponer archivos por
rutas estáticas públicas.

## Exportaciones XLSX

`POST /exportaciones { tipo, filtros }` → registro `en_cola` + outbox.
Estados: `en_cola → procesando → lista | error`, `expirada` a las 24 h.

| Tipo | Filtros | Roles |
| --- | --- | --- |
| `reservas` | `estado`, `fecha_desde/hasta` | SA, OP, VAL |
| `tours` | — | SA, OP |
| `clientes` | `fecha_desde/hasta` | SA, OP |
| `pagos` | `estado`, `fecha_desde/hasta` | SA, VAL |
| `pasajeros_tour`, `manifest`, `cocina` | `fecha_tour_id` requerido | SA, OP, GU |

`GET /exportaciones` (historial propio; SA ve todo), `GET /:id`,
`GET /:id/descarga` → URL firmada temporal.

## Configuración (`.env`)

Ver `.env.example`. Destacadas:

- `DATABASE_URL` + `DB_DRIVER=postgres` en producción.
- `STORAGE_DRIVER=local|s3`, `STORAGE_LOCAL_DIR`, `S3_*`,
  `STORAGE_SIGNED_URL_TTL_SECONDS`, `PUBLIC_APP_URL`, `FILE_SIGNING_SECRET`.
- En producción Playwright requiere los binarios de Chromium
  (`npx playwright install chromium` o imagen con ellos).

## Pendientes conocidos

- Migraciones TypeORM para Postgres (hoy `synchronize` solo en dev).
- Envío real de correos/WhatsApp (outbox los registra, no los envía).
- Recuperación de contraseña (endpoints placeholder, UI oculta).
- El BFF `adminfx` aún concentra algunas lecturas/formatos del panel;
  migrar por dominio lo que falte.
