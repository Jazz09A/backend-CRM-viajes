# ──────────────────────────────────────────────────────────────────────────
# Ruta Clara — API NestJS (backend)
#
# Multi-etapa: compila TS + nativos (better-sqlite3) en `builder`, y en
# `runner` sólo el runtime + Chromium de Playwright (generación de vouchers
# PDF en el worker).
#
# Arranque: migraciones → seed idempotente (solo admin/config en
# NODE_ENV=production) → catálogo Escapate (idempotente; archiva los tours
# de la semilla demo) → API. Los workers (JobsService, outbox, tick 60 s)
# corren dentro del proceso del API.
# ──────────────────────────────────────────────────────────────────────────

# ── Etapa 1: dependencias + compilación ───────────────────────────────────
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# Herramientas por si algún nativo hay que compilar (prebuilds cubren linux-x64).
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# pnpm vía corepack (la versión viene de `packageManager` en package.json).
RUN corepack enable

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
# Catálogo de Escapate Tours (fuente de verdad del importador).
COPY catalogo-escapate.json ./
RUN pnpm build && pnpm prune --prod

# ── Etapa 2: runtime ──────────────────────────────────────────────────────
FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# node_modules del builder (deps de producción, nativos ya construidos).
COPY --from=builder /app/node_modules ./node_modules

# Chromium + libs del sistema para renderizar los vouchers a PDF.
# OJO: sin --no-shell: chromium.launch(headless) usa chrome-headless-shell.
# playwright es dependencia de producción; se invoca por su bin directo
# (sin npx/npm para no depender del gestor de paquetes).
RUN node node_modules/playwright/cli.js install --with-deps chromium \
  && chown -R node:node /ms-playwright

COPY --from=builder /app/dist ./dist
COPY package.json ./
# Catálogo de Escapate: también en el runner (lo consume importar-escapate
# en el CMD de arranque; sólo existía en la etapa builder y el contenedor
# final fallaba con «No existe el archivo de catálogo»).
COPY --from=builder /app/catalogo-escapate.json ./

# Volumen de archivos locales (comprobantes, firmas, vouchers).
RUN mkdir -p /app/data && chown -R node:node /app/data

USER node
# Koyeb inyecta PORT (8000 por defecto); la app lo lee en loadConfig().
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8000)+'/api/v1/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["sh", "-c", "node dist/database/migrate.js && node dist/database/seed.js && node dist/database/importar-escapate.js --archivar-demo && node dist/main.js"]
