# Credenciales a rotar (opcional - medida de precaución)

## Buenas noticias

Las credenciales **nunca fueron subidas al repositorio git** (`.env` siempre estuvo en `.gitignore`). No hay exposición en el historial de commits.

Sin embargo, como medida de precaución (buenas prácticas de seguridad), puedes rotar las siguientes credenciales que estaban en tu `.env` local:

## 1. Neon Database (PostgreSQL)

**Credenciales actuales:**
- Usuario: `neondb_owner`
- Password: `npg_SjOrkUXz2x1P`
- Host: `ep-icy-darkness-bdzcygze-pooler.c-8.us-east-2.aws.neon.tech`

**Cómo rotar:**
1. Ve al panel de Neon → Project → Branch → Reset password
2. Genera un nuevo password
3. Actualiza `.env.local` con el nuevo DATABASE_URL
4. Si tienes un `.env` en el servidor, actualízalo también

## 2. Cloudflare R2 (S3-compatible Storage)

**Credenciales actuales:**
- Access Key ID: `a3473bc1a3653a0007819a3411c5c73a`
- Secret Access Key: `8001ec00d3813571b8d41e2a31ba769857c4c71546a64a4bded65b5f7353664c`
- Endpoint: `https://1726f2ba1996cbbba74bd058f6820eae.r2.cloudflarestorage.com`
- Bucket: `bucket-tour-cliente`

**Cómo rotar:**
1. Ve al panel de Cloudflare → R2 → Manage R2 API Tokens
2. Crea un nuevo token o edita el existente
3. Actualiza `.env.local` con las nuevas credenciales
4. Si tienes un `.env` en el servidor, actualízalo también

## 3. Otros secrets (si los hay en producción)

Revisa si tienes estos secrets configurados en producción y genera nuevos si es necesario:
- `JWT_SECRET` - Generar con: `openssl rand -base64 32`
- `DATA_ENCRYPTION_KEY` - Generar con: `openssl rand -base64 32`
- `DATA_INDEX_HMAC_KEY` - Generar con: `openssl rand -hex 32`
- `FILE_SIGNING_SECRET` - Generar con: `openssl rand -base64 32`

## Resumen de cambios realizados

- ✅ `.env` eliminado (tenía credenciales reales)
- ✅ `.env.local` creado (con las mismas credenciales, no versionado)
- ✅ `.env.example` creado (solo plantilla, sin valores reales)
- ✅ `.gitignore` actualizado para ignorar `.env.local`
- ✅ SECRETS.md creado con documentación de GitHub Secrets

## Próximos pasos

1. Rotar las credenciales de Neon y R2 si deseas (opcional pero recomendado)
2. Configurar los GitHub Secrets según SECRETS.md
3. Actualizar el workflow `cd-backend.yml` para inyectar los secrets
4. Actualizar el archivo `.env` en el servidor si es necesario
