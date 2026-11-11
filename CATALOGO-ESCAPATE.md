# Catálogo Escapate Tours

Carga del catálogo de **Escapate Tours** (transcrito del chat de WhatsApp del
06/11/2026) en el sistema de reservas.

## Archivos

| Archivo | Qué es |
| --- | --- |
| `catalogo-escapate.json` | **Fuente de verdad**. Catálogo completo con tours, fechas, precios, inclusiones, políticas, términos y anomalías detectadas. |
| `src/database/importar-escapate.ts` | Importador idempotente que carga el JSON en la base de datos. |

## Uso

```bash
cd backend
npm run importar:escapate -- --dry-run     # simula: no escribe nada
npm run importar:escapate                  # importa
npm run importar:escapate -- --archivar-demo          # además archiva los tours demo
npm run importar:escapate -- --actualizar-precios      # sobrescribe tarifas existentes
npm run importar:escapate -- --file=mi-catalogo.json     # otro catálogo
```

El importador es **idempotente**: se puede reejecutar sin duplicar nada.

- Tour → se identifica por `nombre`.
- Fecha → por (`tour_id`, `fecha_salida`).
- Tarifa → por (`fecha_tour_id`, `categoria`).

Al terminar imprime el informe de lo creado/actualizado y las **anomalías del
chat** que requieren revisión.

## Qué se carga

- **38 tours** (los planes con inclusiones distintas van como tours separados,
  según la RF-1.3 del PRD: duplicar tour para crear variantes).
- **102 fechas** publicadas con sus 4 tarifas (adulto, niño, tercera edad,
  infante).
- **2 políticas** de cancelación (full day y hospedaje/multi-día).
- **1 plantilla de términos** publicada (las *Condiciones Generales del
  Servicio* del chat).
- **9 puntos de salida** en el catálogo global (`punto_salida`), que es el
  que usan el formulario público y el voucher.
- **Un formulario publicado por tour**: punto de abordaje, selección de
  almuerzo (si el tour incluye comidas), alergias y comentarios.

Efectos colaterales del importador:

- Activa `comidas_deshabilitadas = false` para que el cliente pueda elegir su
  almuerzo (necesario para el reporte de cocina).
- Desactiva los puntos de salida que no están en el catálogo (los genéricos de
  la semilla demo), para que el cliente no vea duplicados.
- Con `--archivar-demo` archiva los 4 tours de la semilla demo (no los borra:
  se pueden reactivar desde el panel).

## Reglas de mapeo

1. **`REF n` = USD por persona.** El sistema sólo maneja USD.
2. **Planes distintos = tours distintos.** Higuerote tiene *Plan Full* (40) y
   *Plan Básico sin comidas* (30); Mérida 2n/3d tiene *Plan Básico* (160) y
   *Plan Full* (230); Choroní tiene *Plan Básico* (115) y *Plan con comidas*
   (160); Posada Villa Paraíso tiene sus 4 opciones.
3. **Precio por pareja → precio unitario.** Se carga el precio por persona y
   la diferencia se aplica como **ajuste manual** desde la reserva (la
   alternativa automática sería un eje de precio nuevo en el motor, que es la
   fase 2 pendiente).
4. **Categorías por edad.** El chat no da precios por edad: niño y tercera
   edad quedan al precio del adulto y el infante (0-2) en 0.00. Los casos
   especiales (3-4 años al 50 % en Mérida, niños de 3 años gratis en Mérida
   4d/3n) se resuelven con ajuste manual.
5. **Cupos.** El chat no los publica: 40 por salida en full day y 24 en
   hospedaje/multi-día. Si dos planes salen en el mismo bus, hay que repartir
   el cupo total entre ellos.
6. **Fecha de salida = día en que sale el bus.** En los 18 tours con «salida
   la noche anterior» la fecha guardada es la de la salida (ej. el viaje del
   sábado 5 de diciembre sale el viernes 4 a las 9 p. m.). Así el corte de
   venta, el hold y el voucher son coherentes. El día de actividad queda
   anotado en las notas del tour.
7. **Hora de salida = primer punto de abordaje** del tour. La hora exacta de
   cada punto (Guatire, Guarenas, Caracas) queda en los puntos de abordaje del
   tour y en su itinerario.
8. **Formulario publicado por tour.** Sin formulario publicado el tour no se
   puede activar; el importador lo publica siempre (v1).

## Anomalías del chat

El JSON trae un bloque `anomalias` con 12 casos detectados al transcribir.
Los más relevantes:

| Tema | Detalle |
| --- | --- |
| Día de la semana | Colonia Tovar: el chat dice «DOMINGO 28 DE NOVIEMBRE», pero el 28/11/2026 es sábado (el mismo chat escribe «SÁBADO 28 DE NOVIEMBRE» para otros tours). Se cargó la fecha del calendario. |
| Fecha transcurrida | Cayo Azul: «SÁBADO 31 DE OCTUBRE» ya pasó → omitida. |
| Errata | Sucre Mochima 3d/2n: «Saliendo el viernes 09/10/2026» → la salida real es el viernes 27/11/2026. |
| Sin fechas | Mérida 2n/3d: «septiembre todos los fines de semana», ya transcurrido → omitido. |
| Fechas generadas | Choroní: «todos los fines de semana» → se generaron las 10 salidas de viernes del 13/11/2026 al 15/01/2027. **Confirmar antes de vender.** |
| Moneda | Mérida Inicio de Año: reserva de «50 €» → 50 USD. |
| Horario | Playa Caribe (Chuspa) y Mérida 4d/3n no tienen hora en el chat → 6:00 a. m. y 6:00 p. m. como referencia. |

## En producción (Postgres)

El catálogo se carga contra la base de producción con el mismo script, apuntando
a `DATABASE_URL`:

```bash
cd backend
DB_DRIVER=postgres DATABASE_URL=... npm run importar:escapate -- --dry-run
DB_DRIVER=postgres DATABASE_URL=... npm run importar:escapate
```

En el contenedor de Koyeb el catálogo se copia con la imagen (`Dockerfile`) y
el importador se ejecuta con `node dist/database/importar-escapate.js`.

## Actualizar el catálogo

1. Editar `catalogo-escapate.json` (los `fechas` son **días de salida**).
2. `npm run importar:escapate -- --dry-run` y revisar el informe.
3. `npm run importar:escapate -- --actualizar-precios` si cambiaron precios.

## Pendiente conocido (fase 2)

- **Precio por opción automático**: hoy un `select` del formulario no cobra por
  sí solo (el motor de precios sólo lee `tarifa` por categoría y las líneas
  extra que fija la agencia). Para que «con/sin comida» o «por persona/por
  pareja» se cobren automáticamente hace falta un eje de precio en
  `tarifa` (variante) o un motor que promueva las opciones con precio a línea
  de precio.
- **Reserva por producto**: el chat fija reservas de 20 / 50 / 75 / 100 según
  el viaje; el sistema sólo tiene `abono_minimo_pct` global (50 %).
- **Punto de abordaje por tour en el formulario público**: el formulario toma
  las opciones del catálogo global (una hora por punto); la hora exacta de
  cada tour está en los puntos de abordaje del tour y en el itinerario.
