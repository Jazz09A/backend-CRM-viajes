# GitHub Secrets para Producción

Estos secrets deben configurarse en el repositorio GitHub (Settings → Secrets and variables → Actions).

El workflow `cd-backend.yml` los inyecta automáticamente en el servidor al hacer deploy.

## Secrets requeridos

### Base de datos
- `DATABASE_URL` - URL de conexión a Neon (postgresql://usuario:password@ep-xxx.neon.tech:5432/neondb?sslmode=require)

### JWT
- `JWT_SECRET` - Secret para firmar tokens JWT (generar con `openssl rand -base64 32`)

### Cifrado de datos
- `DATA_ENCRYPTION_KEY` - Clave AES-256-GCM en base64 (generar con `openssl rand -base64 32`)
- `DATA_INDEX_HMAC_KEY` - Clave HMAC en hex (generar con `openssl rand -hex 32`)

### Storage (S3/R2)
- `S3_ENDPOINT` - Endpoint de S3-compatible (ej: https://<account-id>.r2.cloudflarestorage.com)
- `S3_REGION` - Región (ej: us-east-1)
- `S3_BUCKET` - Nombre del bucket
- `S3_ACCESS_KEY_ID` - Access key del bucket
- `S3_SECRET_ACCESS_KEY` - Secret key del bucket

### URLs públicas
- `PUBLIC_APP_URL` - URL del frontend (https://admin.escapatetour.app)
- `PUBLIC_API_URL` - URL del API (https://api.escapatetour.app)

### Otros
- `FILE_SIGNING_SECRET` - Secret para firmar URLs temporales (generar con `openssl rand -base64 32`)

## Secrets ya existentes

- `DEPLOY_SSH_KEY` - Clave SSH para acceder al servidor (ya configurado)

## Cómo el workflow inyecta los secrets

El workflow `cd-backend.yml`:
1. Se conecta al servidor via SSH
2. Crea `/opt/escapatetour/backend/.env` con los valores de los secrets
3. Hace `docker compose up -d` que usa ese `.env`

No es necesario mantener un `.env` manual en el servidor.

