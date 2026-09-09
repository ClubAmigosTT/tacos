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
puede ejecutar desde un cron sin guardar el JSON en el repositorio.

El importador hace upsert por el identificador de la fuente, calcula una clave
de duplicado por nombre/coordenadas, marca conflictos como `needs_review`,
archiva las filas demo sólo cuando se solicita explícitamente y conserva la
traza de cada ejecución en `catalog_imports`. Programa la misma orden como un
cron de Render cuando tengas un feed actualizado.
