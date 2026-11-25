# Configuración del Servidor de Producción

## Ubicación de archivos

Estructura en el servidor:
```
/opt/escapatetour/backend/
├── docker-compose.yml      # Configuración de Docker Compose
├── .env                    # Variables de entorno (generado por CD)
└── data/                   # Volumen para archivos locales (si STORAGE_DRIVER=local)
```

## Docker Compose

El archivo `docker-compose.yml` está en `/opt/escapatetour/backend/docker-compose.yml` y usa `.env` del mismo directorio.

## Variables de entorno

El archivo `.env` **se genera automáticamente** por el workflow `cd-backend.yml` a partir de GitHub Secrets. No debe editarse manualmente en el servidor.

Si necesitas cambiar una variable:
1. Actualiza el secret correspondiente en GitHub (Settings → Secrets and variables → Actions)
2. Haz push a main para que el CD regenere el `.env` y haga deploy

## Deploy manual (solo emergencias)

Si necesitas hacer deploy manual sin pasar por GitHub Actions:

```bash
ssh -p 2222 alvaro@62.171.175.92
cd /opt/escapatetour/backend
docker compose pull
docker compose up -d
```

## Logs

Ver logs del contenedor:
```bash
ssh -p 2222 alvaro@62.171.175.92
docker logs -f agencia-viajes-api
```

## Restart

Reiniciar el contenedor:
```bash
ssh -p 2222 alvaro@62.171.175.92
cd /opt/escapatetour/backend
docker compose restart
```
