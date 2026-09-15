# Catálogo con fuentes y licencia

`branches.json` no se versiona con datos personales o fotos sin permiso. Copia
`branches.json.example` y rellénalo desde una fuente autorizada (por ejemplo,
un proveedor con licencia comercial o un dataset de OpenStreetMap más una
fotografía con licencia explícita). Cada registro debe incluir los siete días,
dirección, coordenadas, precios y al menos una foto con `license`, `attribution`
y `sourceUrl`.

## Fase 1: ampliar cobertura sin depender de Google

El objetivo de esta fase es maximizar la cobertura de CDMX y Estado de México
con fuentes reutilizables, conservar la procedencia de cada fila y evitar que
un restaurante genérico se publique automáticamente como taquería.

El flujo operativo es:

1. Descargar la edición vigente de DENUE desde INEGI para las entidades 09 y
   15.
2. Descubrir candidatos de OSM por grupos de señales (`taco`, `birria`,
   `carnitas`, `barbacoa`, `suadero`, `pastor`, `canasta`, `cabeza`, `trompo`,
   `quesabirria`, `guisado` y `antojitos`) y por cobertura territorial. La
   búsqueda revisa `cuisine` y también `name`, `brand`, `official_name`,
   `alt_name`, `operator`, `description`, `dish`, `menu` y `product` en
   negocios de alimentos. El proceso guarda IDs estables `osm:tipo:id` y
   realiza lotes locales de 60.
3. Enriquecer esos IDs con las etiquetas disponibles en OSM. Los campos
   ausentes permanecen vacíos; no se inventan fotos, horarios ni teléfonos.
4. Normalizar clasificación, municipio/alcaldía, fuente y calidad. El
   constructor usa las alcaldías y municipios presentes en DENUE para corregir
   valores genéricos como `Ciudad de México` o `Estado de México` cuando la
   etiqueta contextual de OSM permite identificar el territorio. Los
   candidatos quedan como `needs_review`; sólo las filas con señal suficiente
   pasan como `active`.
5. Combinar DENUE y OSM con deduplicación por fuente y por nombre/coordenadas.
   Las coincidencias sospechosas se reportan, no se eliminan silenciosamente.
6. Auditar antes de importar: cobertura por alcaldía/municipio, mezcla de
   fuentes, faltantes y candidatos de duplicado.

Comandos principales:

```bash
pnpm catalog:refresh
pnpm catalog:audit
pnpm smoke:catalog
```

`catalog:refresh` no importa automáticamente a producción. Eso es deliberado:
primero se revisan los reportes de `catalog/reports/` y después se ejecuta la
importación con el feed aprobado. Si Overpass está saturado, el descubridor
reintenta y divide la entidad en celdas de 0.25 grados; una corrida parcial
guarda lo conseguido pero nunca reconcilia ni archiva registros anteriores.

La ejecución local de septiembre de 2026 produjo 35,661 sucursales regionales:
34,413 de DENUE y 1,248 de OSM. Después de recalcular las señales históricas de
OSM, 25,165 están activas para publicación y 10,496 quedan en revisión. Esos
números son una fotografía de la edición DENUE 202605 y del snapshot OSM local;
deben recalcularse después de cada actualización.

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

Si Overpass está ocupado, la corrida se puede repartir por grupos y reanudar
sin perder lo ya guardado. Por ejemplo, `--query-offset 1 --max-queries 1`
ejecuta solamente el segundo grupo territorial; las corridas parciales nunca
reconcilian ni archivan IDs anteriores.

En una automatización equivalente se pueden usar
`CATALOG_DISCOVERY_OFFSET` y `CATALOG_DISCOVERY_MAX_QUERIES` para pasar esos
valores a `catalog:refresh`.

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

El constructor fusiona el JSON enriquecido con `taqueria_ids.csv`. Por eso un
ID recién descubierto puede aparecer de inmediato como `needs_review` aunque
todavía no tenga dirección u horario; al completar el enriquecimiento, los
datos detallados sustituyen al registro provisional por el mismo ID.

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

En Render, el arranque de producción ejecuta automáticamente un bootstrap
idempotente después de las migraciones. Importa el feed sólo si nunca se ha
importado o si el archivo versionado es más reciente; no corre cada vez que
una persona abre la app. Si el plan permite Shell, la misma importación también
se puede ejecutar manualmente con:

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

## Reconciliación de Google Place IDs (v2)

La búsqueda usa las fronteras regionales de OSM y una cuadrícula inicial de
0.12 grados. Incluye todas las partes de polígonos múltiples y las celdas que
intersectan franjas estrechas del límite. Primero recorre “tacos” y “taquería”,
después los términos específicos. Los resultados de Google no garantizan un
inventario completo ni equivalencia exacta con la aplicación Google Maps.

Cada consulta recibe hasta tres páginas de 20 resultados. Si llega a 60,
divide la celda en cuatro y encola sus consultas. La subdivisión termina cuando
cada hijo sería menor que 0.015 grados (aproximadamente 1.6 km); si continúa
saturada, aparece como saturated en el reporte. No se declara cobertura completa
al alcanzar un límite de solicitudes.

### Modos y consumo

El modo predeterminado es sólo IDs: pide exactamente places.id,nextPageToken.
Con esos campos no se puede determinar si un negocio falta en DENUE/OSM:
los nuevos IDs quedan como unverified. El área registrada en ese modo corresponde
al rectángulo consultado; no es una coordenada ni una pertenencia administrativa
verificada del lugar.

La opción --compare pide también displayName, formattedAddress y location:
corresponde a Text Search Pro y puede generar consumo facturable. Compara en
memoria contra TODO el catálogo, incluidos needs_review y archived; no guarda
esos campos de Google en la base ni publica negocios automáticamente.

Los límites predeterminados son 60 intentos HTTP por corrida y 300 acumulados
por plan. Ambos cuentan errores y se aplican también a las subdivisiones.
No hay un modo ilimitado. Estos límites son de solicitudes, no un presupuesto
monetario ni una garantía de gratuidad; otros procesos del proyecto pueden
consumir la misma cuota.

Ver [campos, límites y facturación de Text Search](https://developers.google.com/maps/documentation/places/web-service/text-search).

### Ejecución

Configurar GOOGLE_PLACES_API_KEY como secreto del entorno. No usar claves en
argumentos de consola, archivos versionados ni mensajes. Desde la raíz:

~~~powershell
# Planificar sin consultas ni cambios en SQLite
python scripts/discover-google-place-ids.py --compare --dry-run

# Descubrir únicamente IDs
python scripts/discover-google-place-ids.py --ids-only --max-requests 60

# Comparar con campos Pro, bajo límites explícitos
python scripts/discover-google-place-ids.py --compare --max-requests 60 --max-plan-requests 300

# Recalcular reportes locales sin consultar Google
python scripts/discover-google-place-ids.py --compare --report-only
~~~

Repetir el mismo comando continúa su plan. Guarda el token y número de página
después de cada respuesta. Si un token expira (400), reinicia esa celda en la
siguiente corrida y conserva los IDs; una repetición excepcional puede consumir
solicitudes. Una interrupción recupera la consulta running. Un bloqueo SQLite
impide ejecutar dos trabajadores sobre la misma base simultáneamente.

El plan se identifica por modo, región, términos, cuadrícula, tamaño mínimo y
huellas del catálogo/fronteras. Cambiar esos parámetros crea otro plan con su
propio límite. Los planes antiguos siguen guardados; no mezclamos sus consultas
pendientes con las del plan actual. Los 26 trabajos terminados del prototipo
no sustituyen una auditoría v2 porque no guardaban todos los datos de avance.

### Resultados e interpretación

- matched: coincidencia probable con un registro activo.
- matched_unpublished: coincidencia probable con un registro de la base que
  no está publicado; matchedCatalogStatus explica su estado.
- review: coincidencia ambigua, nombre débil o varios puestos cercanos.
- missing: candidato sin coincidencia confiable después de comparar toda la
  base; todavía requiere validación humana, no es una ausencia confirmada.
- unverified: sólo se obtuvo el ID, faltan campos para comparar o procede del
  prototipo pendiente de revisar.

La dirección por sí sola nunca confirma identidad. El emparejamiento requiere
nombre distintivo y cercanía; varios candidatos con puntuación parecida quedan
en revisión. La puntuación es una heurística, no una probabilidad calibrada.

SQLite y las exportaciones viven en catalog/:

- google-place-candidates.sqlite: IDs únicos y avance por plan.
- google-place-candidates.json y .csv: candidatos acumulados.
- google-place-ids-missing.txt: posibles faltantes evaluados con v2.
- google-place-ids-review.txt: casos ambiguos evaluados con v2.
- google-place-ids-unpublished.txt: coincidencias no publicadas.
- google-place-ids-unverified.txt: IDs pendientes de evaluar/revalidar.

El JSON incluye además el avance DEL PLAN SELECCIONADO por zona y término,
y los rectángulos completos con estados pending, running, error, completed,
split o saturated. Los totales de candidatos son acumulados de toda la base.
Los resultados del prototipo conservan su clasificación anterior como
previousMatchStatus, pero se exportan como unverified hasta volver a compararlos.
No podemos reconstruir sus nombres/coordenadas: sólo se conservaron sus IDs.

Importar a PostgreSQL requiere DATABASE_URL, aplicar las migraciones 027 y 028,
y ejecutar pnpm catalog:import:google. La importación conserva las relaciones con
branches; no cambia el catálogo de la app. Este cambio no requiere TestFlight.

Pruebas sin red:

~~~powershell
python -m unittest discover -s scripts -p test_google_discovery.py
~~~

## Candidatos manuales de búsqueda

Los CSV colocados en `Downloads/BAses tacos` se procesan como una fuente de
staging, no como un catálogo publicable. El importador normaliza nombres y
direcciones, elimina filas repetidas y compara los candidatos con todas las
sucursales regionales actuales. No exporta URLs de imágenes de Google, no
agrega filas a la app y no convierte un candidato en una taquería confirmada.

Ejecutar desde la raíz del proyecto:

```bash
pnpm catalog:import:manual
```

También se puede indicar otra carpeta:

```bash
python scripts/import_manual_taco_candidates.py --input-dir "C:\\ruta\\a\\csv"
```

Los reportes locales se guardan en `catalog/reports/manual-candidates/`:

- `manual-candidates-summary.json`: volumen, completitud, duplicados y estados.
- `manual-candidates.csv`: todos los candidatos deduplicados.
- `manual-candidates-review.csv`: faltantes potenciales y coincidencias dudosas.
- `manual-candidates-new.csv`: candidatos sin coincidencia confiable.
- `manual-candidates-matched.csv`: lugares que ya tienen coincidencia clara.

Para intentar obtener coordenadas de los candidatos con calle y número usando
OSM/Nominatim, ejecuta una sola corrida controlada:

```bash
pnpm catalog:geocode:manual
```

El proceso usa una sola secuencia, pausa al menos un segundo entre solicitudes,
guarda cada respuesta en `nominatim-cache.json` y puede reanudarse sin repetir
consultas. Produce `manual-candidates-geocoded-ready.csv` para coordenadas
fuertes, `manual-candidates-address-review.csv` para coordenadas obtenidas
por dirección y `manual-candidates-geocoded-review.csv` para los casos
ambiguos. Las filas `address_low_confidence` son puntos de calle aproximados,
no la ubicación confirmada del negocio.
Las coordenadas son candidatas: todavía no modifican el catálogo ni la app.
Para una operación quincenal se debe usar una instancia propia o un proveedor
con cuota apropiada; el servicio público de Nominatim no es un backend genérico
de geocodificación recurrente.

Para publicar únicamente la primera tanda de alta confianza en la app móvil:

```bash
pnpm catalog:publish:manual
pnpm catalog:build:mobile
```

La política de publicación exige `missing_candidate`, una señal fuerte de
tacos, coordenadas `geocoded` obtenidas con nombre y dirección, y ausencia de
duplicado espacial/nombre. No publica calificaciones, reseñas, fotos ni
horarios tomados de los CSV; esos campos quedan pendientes de enriquecimiento.
Los registros que sólo tienen un punto aproximado de calle permanecen en
`manual-candidates-publish-review.csv` para revisión antes de aparecer en el
mapa.

Los estados son `matched`, `review`, `missing_candidate` y `rejected`. Un
`missing_candidate` todavía requiere coordenadas y verificación independiente
con DENUE, OSM, el sitio del negocio o una propuesta de la comunidad. Sólo
después de esa revisión se debe crear una sucursal con fuente, licencia,
atribución y coordenadas válidas.

## DENUE: cobertura regional sin consultas de pago

La edición vigente descargada para este proyecto es DENUE mayo de 2026. La
descarga masiva oficial se obtiene desde [INEGI](https://inegi.org.mx/app/descarga/?t=11).
Para esta cobertura se necesitan los archivos de las entidades 09 (CDMX) y 15
(Estado de México); la entidad 15 viene dividida en dos partes. Los ZIP
originales se guardan localmente en `data/denue/202605/`, una ruta ignorada por
git, y nunca se empaquetan en la aplicación.

Después de descargar esos tres ZIP, el extractor selecciona la clase SCIAN
`722514` (servicio de preparación de tacos y tortas) y también los nombres que
dicen explícitamente `taco`, `taquería`, `barbacoa`, `carnitas`, `pastor`,
`birria`, `suadero` o `canasta` dentro de otras actividades de restaurantes
`7225`. Valida nombre y coordenadas, arma la dirección, conserva
el teléfono cuando existe y quita duplicados exactos. Ejecuta:

```bash
pnpm catalog:download:denue
pnpm catalog:build:denue
```

El primer comando descarga las tres partes actuales a `data/denue/latest/` y
detecta la edición desde los metadatos del ZIP. Si se trabaja con una edición
guardada en otra carpeta, se puede pasar `--input-dir` y `--release` al
segundo comando.

La salida es `catalog/denue-cdmx-edomex.json`. La ejecución comprobada con la
edición 202605 produjo 34,413 sucursales: 12,537 en CDMX y 21,876 en Edomex.
De ellas, 26,431 pertenecen a 722514 y 8,218 son negocios de otras actividades
de restaurantes 7225 que tienen una señal explícita de tacos en el nombre.
El DENUE aporta nombre, ubicación, actividad, dirección y, en algunos casos,
teléfono; no aporta fotografías, menús, horarios semanales ni calificaciones de
la comunidad.

Para generar un feed combinado para auditorías, exportaciones o una migración
manual, combina DENUE con los registros OSM candidatos y de alta confianza que
no se dupliquen:

```bash
pnpm catalog:build:osm
pnpm catalog:build:all
```

El feed combinado no sustituye las calificaciones ni las visitas: conserva los
IDs de sucursal ya existentes de OSM y añade IDs estables `denue-*` para los
registros de INEGI. Las coincidencias entre fuentes se mantienen una sola vez.
En producción el API importa el feed OSM y el feed DENUE por separado; una
coincidencia entre fuentes se trata como solapamiento normal y no oculta la
sucursal existente.

En Render, `catalog:ensure:osm` actualiza y reconcilia el subconjunto OSM de
alta confianza, y `catalog:ensure:denue` hace lo mismo con DENUE al arrancar el
API. Estos comandos son idempotentes y no dependen de que alguien abra la
aplicación. El catálogo DENUE se puede regenerar cuando INEGI publique una
nueva edición y distribuirse con la cadencia quincenal definida para el
producto.

El workflow `.github/workflows/refresh-denue.yml` repite esta descarga los días
1 y 15 de cada mes. Si INEGI no cambió la edición, no crea commit ni deploy;
cuando aparece una nueva edición, sólo actualiza el JSON regional y Render lo
importa en el siguiente arranque. También se puede ejecutar manualmente desde
GitHub Actions para comprobar una edición nueva.

INEGI permite copiar, adaptar, extraer y explotar comercialmente su información,
con la obligación de conservar metadatos, dar crédito y aclarar que cualquier
transformación es responsabilidad de la aplicación. La ficha de cada sucursal
conserva la fuente y la fecha de edición para que esa atribución no se pierda.
Revisa los [Términos de Libre Uso de INEGI](https://www.inegi.org.mx/inegi/terminos.html)
cuando cambie la edición.

## Catálogo local de la app

La app móvil incluye una copia estática de las filas activas del catálogo
regional combinado. Así Inicio y Mapa no quedan vacíos mientras la API despierta
o si el dispositivo pierde conexión. El servidor sigue siendo necesario para
calificaciones, visitas, cuentas y actividad social, pero la búsqueda básica de
taquerías también funciona con la información que ya viene almacenada en la
app. Los registros `needs_review` no se publican automáticamente.

Se regenera la copia al preparar cada versión de la app:

```bash
pnpm catalog:build:mobile
```

La salida se guarda en `apps/mobile/data/catalog.ts`. El constructor usa
`catalog/cdmx-edomex.json` cuando existe y, en un checkout limpio, combina los
feeds regionales versionados de DENUE y OSM. La app usa primero el API cuando
está disponible para conservar calificaciones, visitas y actividad de usuarios;
si falla, consulta esta copia local. Por eso una actualización quincenal se
distribuye al servidor mediante el catálogo y llega al almacenamiento local de
la app en la siguiente versión de iOS.
