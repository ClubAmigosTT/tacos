# Catálogo con fuentes y licencia

`branches.json` no se versiona con datos personales o fotos sin permiso. Copia
`branches.json.example` y rellénalo desde una fuente autorizada (por ejemplo,
un proveedor con licencia comercial o un dataset de OpenStreetMap más una
fotografía con licencia explícita). Cada registro debe incluir los siete días,
dirección, coordenadas, precios y al menos una foto con `license`, `attribution`
y `sourceUrl`.

Importa en PostgreSQL/PostGIS con:

```bash
CATALOG_FILE=catalog/branches.json \
CATALOG_SOURCE_NAME=osm-cdmx \
CATALOG_SOURCE_URL=https://www.openstreetmap.org \
CATALOG_SOURCE_LICENSE="ODbL 1.0" \
CATALOG_REPLACE_DEMO=true \
pnpm catalog:import
```

En Render puedes usar el mismo formato como feed HTTPS configurando
`CATALOG_FEED_URL`; cuando existe, tiene prioridad sobre `CATALOG_FILE` y se
puede ejecutar desde un cron sin guardar el JSON en el repositorio. El servicio
de la API no importa automáticamente al arrancar: primero valida el feed y
después ejecuta esta orden desde un job operativo.

El importador hace upsert por el identificador de la fuente, calcula una clave
de duplicado por nombre/coordenadas, marca conflictos como `needs_review`,
archiva las filas demo sólo cuando se solicita explícitamente y conserva la
traza de cada ejecución en `catalog_imports`. `CATALOG_RECONCILE=true` sólo
debe usarse cuando el feed sea un snapshot completo: en ese caso archiva las
sucursales de esa misma fuente que ya no vienen en la respuesta. Si una fila
falla validación o hay duplicados, no reconcilia ni da de baja registros; lo
mismo aplica a `CATALOG_REPLACE_DEMO=true`, que sólo archiva los datos demo
después de una importación completamente válida.

Las personas pueden proponer una sucursal, un taco o una corrección desde la
app. Todo queda en `catalog_proposals` como `pending`; una cuenta con rol
`admin` debe aprobarlo desde Moderación antes de publicarlo. La propuesta no
reemplaza la fuente verificada: se publica con calidad `community` hasta que
una nueva importación la confirme.

## Descubrimiento de IDs de OpenStreetMap

Para construir una lista inicial de candidatos de toda Ciudad de México y todo
el Estado de México, usando sus límites administrativos y sin guardar contenido
de Google Maps, ejecuta:

```bash
pnpm catalog:discover:ids
```

El proceso consulta por separado los límites `MX-CMX` y `MX-MEX`, y guarda o
actualiza los resultados en lotes transaccionales de 60. Mantiene `taqueria_ids.sqlite` y
exporta copias legibles en `taqueria_ids.txt` y `taqueria_ids.csv`, todos en la
raíz del proyecto. Los registros con `confidence=candidate` son restaurantes
mexicanos que deben revisarse antes de publicarse como taquerías.

Se puede usar `OVERPASS_URL` para indicar una instancia propia o contratada y
`TACO_DISCOVERY_USER_AGENT` para identificar el proceso. El endpoint público
de Overpass debe reservarse para pruebas y ejecuciones ocasionales, no como
infraestructura de producción.

Para enriquecer los IDs ya descubiertos con los datos disponibles en
OpenStreetMap, ejecuta:

```bash
pnpm catalog:enrich:ids
```

El enriquecedor toma como máximo 60 IDs por solicitud, guarda cada lote en la
misma base SQLite y puede reanudarse sin repetir los registros terminados.
Exporta `taquerias_enriquecidas.csv` y `taquerias_enriquecidas.json` en la raíz
del proyecto. Los campos pueden quedar vacíos cuando OpenStreetMap no tenga
dirección, horario, teléfono o sitio web para ese establecimiento.

Para crear un feed publicable con los registros de alta confianza que tienen
nombre y están dentro de los límites administrativos de CDMX o Edomex:

```bash
pnpm catalog:build:osm
```

El comando guarda `catalog/osm-cdmx-edomex.json` y conserva los límites de
ambas entidades en `catalog/osm-boundaries.json` para no descargarlos en cada
ejecución. El feed no inventa fotografías, menús, horarios ni direcciones: los
campos ausentes quedan vacíos y la app muestra la información como no
disponible. La selección se marca con calidad `catalog`, no como reseña o
verificación editorial. Este feed OSM sí se puede versionar porque incluye su
licencia y atribución; los límites descargados se mantienen fuera del control
de versiones.

Para importar ese feed a PostgreSQL, después de aplicar las migraciones:

```bash
CATALOG_FILE=catalog/osm-cdmx-edomex.json \
CATALOG_SOURCE_NAME=osm-cdmx-edomex \
CATALOG_SOURCE_URL=https://www.openstreetmap.org \
CATALOG_SOURCE_LICENSE="ODbL 1.0" \
CATALOG_ALLOW_PARTIAL=true \
CATALOG_REPLACE_DEMO=true \
pnpm catalog:import
```

En Render, después de que el servicio tenga desplegadas las migraciones, la
misma importación se puede ejecutar desde el Shell del servicio con:

```bash
CATALOG_REPLACE_DEMO=true pnpm catalog:import:osm
```

La variable `DATABASE_URL` no se copia ni se imprime: Render la inyecta desde
su configuración secreta. La importación es idempotente y el mismo comando se
puede repetir para actualizar el catálogo.

Las correcciones de la comunidad se manejan desde el flujo de Moderación y
quedan marcadas como `community` hasta que una fuente las confirme. Si una
reimportación posterior actualiza el mismo registro desde OSM, la corrección
debe revisarse nuevamente.
