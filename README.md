# Tacos

Aplicación mobile-first para descubrir, registrar y recordar tacos.

El repositorio ya contiene un MVP ejecutable para iOS, Android y web: mapa contextual, fichas de taquerías, registro de visitas, cuenta de usuario y diario persistente. La API está preparada para ejecutarse en Render; la app no necesita que esta computadora esté encendida una vez que `EXPO_PUBLIC_API_URL` apunte al servicio publicado.

## Estructura

- `apps/mobile`: Expo Router + React Native (iOS/Android/web), con un sistema visual compartido.
- `services/api`: Fastify + TypeScript, autenticación JWT, búsqueda y visitas.
- `database/migrations`: PostgreSQL + PostGIS, con datos iniciales y usuarios.
- `render.yaml`: Blueprint de API web, worker, cron, Redis y PostgreSQL.

## Arranque local

Requiere Node.js 22 o superior y pnpm.

```bash
pnpm install
copy .env.example .env
pnpm dev:api
pnpm dev:mobile
pnpm dev:local # levanta API y preview web juntos
```

La app móvil funciona con fixtures si no existe `DATABASE_URL`. La API local queda en `http://localhost:4000` y carga automáticamente las variables del `.env` raíz. Para probar cuentas localmente no hace falta una base de datos: se usa un repositorio en memoria. En un entorno compartido configura al menos `JWT_SECRET` y `DATABASE_URL`. `ADMIN_EMAILS` acepta una lista separada por comas para bootstrap controlado del primer administrador; para promover usuarios existentes usa una migración/SQL de administración.

Para abrir la app en un dispositivo físico, sustituye `EXPO_PUBLIC_API_URL` por la IP LAN de la computadora que ejecuta la API (por ejemplo `http://192.168.1.70:4000`). En producción debe ser la URL HTTPS de Render.

En el emulador Android usa `http://10.0.2.2:4000`; el emulador redirige esa dirección hacia el host local. El simulador iOS y el preview web pueden usar `http://localhost:4000`.

## Flujo implementado

1. Inicio y mapa con filtros visuales (`Pastor`, `Abierto ahora`, `Barato`, `Para mí`).
2. Ficha de taquería con rating global, rating por taco y perfil de sabor.
3. Registro de visita: lugar, tacos y puntuación.
4. Registro/login con contraseña cifrada y token JWT.
5. Diario que lee las visitas del usuario desde `/v1/diary`.
6. Fallback de fixtures para poder diseñar y revisar la UI sin backend.
7. Recomendaciones personalizadas desde el historial (`/v1/recommendations`).
8. Listas públicas/privadas, guardado de lugares y progreso visitado.
9. Grafo social mínimo: búsqueda de personas, seguir/dejar de seguir y feed de actividad.
10. Permiso de ubicación en iOS/Android y distancias PostGIS cuando el dispositivo comparte coordenadas.
11. Taco Passport: progreso por colonias desbloqueadas a partir de las visitas del diario.
12. Reputación bayesiana en consultas PostgreSQL: prior conservador para sucursal y taco, evitando que pocas reseñas perfectas dominen el ranking.
13. Contexto de visita: precio, nota, foto opcional y coordenadas, más resumen anual compartible.
14. Fotos opcionales desde cámara/galería: se validan por firma y se suben por `/v1/media/images` a un bucket S3-compatible; nunca se escriben en el disco de Render.
15. Perfil de sabor por sucursal (intensidad, picante, tradicional, textura y valor) servido desde PostgreSQL y renderizado dinámicamente en la ficha.
16. Taste ID personalizado desde `/v1/me/taste`, calculado a partir de las sucursales visitadas y sus perfiles de sabor.
17. Recomendaciones con señal social: ratings y visitas de personas seguidas se combinan con el gusto propio y la calidad global.
18. Registro contextual: detecta ubicación, prioriza los tres lugares más cercanos y guarda coordenadas de la visita.
19. Radar de tacos: controles de distancia, precio y antojo que reordenan el mapa en tiempo real.
20. Recomendaciones por perfil de sabor: compara el historial del usuario con la firma de cada sucursal y expone `tasteMatch` junto al score combinado.
21. Detalle de listas públicas/privadas: una lista se puede abrir, ver sus lugares, notas y progreso; su contenido se valida en API según visibilidad y propietario.
22. Moderación inicial: reportes únicos por usuario/visita y estado de visibilidad preparado para que un futuro panel de revisión pueda ocultar contenido del feed.
23. Modelo normalizado `taquería → sucursal → taco`: migración, endpoint y pantalla de taquería con sus sucursales.
24. Gestión de listas: el propietario puede quitar lugares desde el detalle; la API valida la propiedad y actualiza el progreso.
25. Integridad de visitas: se rechazan tacos de otra sucursal, selecciones duplicadas y ratings de tacos no seleccionados.
26. Perfiles públicos: el grafo social abre un perfil con Taste ID, estadísticas y listas públicas sin exponer el correo fuera de la búsqueda.
27. Estado social persistente: la búsqueda indica quién ya te sigue para mantener los controles correctos después de recargar la pantalla.
28. Feed contextual: las notas de una visita viajan con la actividad social para conservar la voz y el criterio de cada registro.
29. Navegación social: el avatar y nombre del feed abren directamente el perfil público del autor.
30. Radar personal: cada sucursal puede marcarse como “Quiero ir”; la selección persiste en PostgreSQL y se refleja como “En mi radar”.
31. Radar navegable: Perfil abre todos los lugares pendientes con sus fichas y conserva el fallback offline.
32. Migración tolerante: `011_backfill_taquerias.sql` conserva sucursales existentes aunque no pertenezcan al seed inicial.
33. Reputación moderable: visitas ocultas ya no afectan score global, Taste ID, recomendaciones ni estadísticas públicas; el autor conserva su diario.
34. Validación normalizada: títulos, nombres, notas y correos se recortan y validan antes de escribir en la base.
35. Operación Render: `/health` comprueba PostgreSQL, el esquema migrado y PostGIS; el API cierra conexiones limpiamente durante reinicios y producción falla rápido si falta `JWT_SECRET`.
36. Mapa responsive: la ubicación concedida después del montaje recentra el mapa nativo con una transición corta.
37. Health con timeout: las comprobaciones de PostgreSQL fallan rápido para que Render pueda reemplazar una instancia degradada.
38. Cliente resiliente: las peticiones móviles cancelan solicitudes colgadas después de 15 segundos y activan los fallbacks existentes.
39. Listas editables: el propietario puede cambiar título, descripción y visibilidad desde una pantalla móvil dedicada; la API mantiene autorización y consistencia del progreso.
40. Diario editable: una visita propia permite corregir rating, precio y nota desde una pantalla dedicada; los cambios invalidan diario, feed y recomendaciones.
41. Listas como rutas: el detalle muestra un mapa compacto con sus lugares y cada pin abre la ficha correspondiente.
42. Privacidad accionable: cada usuario puede ocultar o volver a compartir su actividad en el feed desde una pantalla dedicada, sin borrar su diario.
43. Conversaciones por visita: el feed muestra el contador de comentarios y cada registro abre una conversación donde se puede comentar y borrar el comentario propio.
44. Moderación de comentarios: el panel admin lista comentarios visibles/ocultos y permite ocultarlos o restaurarlos sin borrar evidencia.
45. Listas colaborativas: el propietario puede invitar editores o lectores; los editores gestionan lugares, mientras que el propietario conserva la edición editorial y el control de acceso.
46. Analítica de producto sin PII: eventos acotados para aperturas, búsquedas, filtros, aperturas de fichas, registros y colaboración; fallar analítica nunca bloquea una acción.
47. Control del diario: el autor puede eliminar una visita propia con confirmación; la API la retira también de recomendaciones, estadísticas y conversaciones asociadas.
48. Identidad editable: el usuario puede cambiar su nombre público desde Ajustes y la sesión se actualiza sin volver a iniciar sesión.
49. Registro asistido por cámara: después de tomar una foto, la app propone la taquería más cercana por ubicación y exige confirmación manual antes de cambiar el registro.
50. Búsqueda universal: la barra de inicio acepta el antojo y abre el mapa con la consulta ya aplicada, mientras que el módulo social del inicio lee actividad real del feed autenticado.
51. Migración segura de catálogo: los padres de taquería se crean antes de la llave foránea, incluso para sucursales importadas fuera del catálogo de ejemplo.
52. Audiencia anónima: la app conserva un identificador aleatorio local para medir recurrencia sin enviar correo, ubicación ni texto de búsqueda.
53. Operación activa: el worker y el cron de Render ejecutan mantenimiento acotado, `ANALYZE` del catálogo/visitas y retención de eventos analíticos de 180 días sin borrar contenido de usuarios.
54. Integridad de listas: sucursales inexistentes se rechazan con 404 y las visitas ocultas no inflan el progreso visitado.
55. Privacidad del directorio: buscar personas requiere sesión y los eventos autenticados no mezclan un identificador anónimo con el usuario.
56. Persistencia transaccional: visitas y moderaciones usan una conexión dedicada del pool para garantizar `BEGIN/COMMIT/ROLLBACK` atómicos en Render.
57. Reputación robusta: el score combina prior bayesiano, recencia con vida media de 180 días, dispersión y un límite de influencia por revisor; la ficha muestra el volumen de reseñas visibles.
58. Índices de reputación: las consultas por sucursal y taco tienen índices parciales sobre visitas visibles y ratings de menú para sostener el crecimiento del diario en PostgreSQL.
59. Migraciones seguras en Render: el pre-deploy usa un cliente dedicado y un lock advisory para impedir carreras entre deploys y garantizar transacciones reales por archivo.
60. Deploy protegido: los servicios de Render esperan los checks de GitHub Actions antes de auto-desplegar (`autoDeployTrigger: checksPass`).
61. Releases móviles reproducibles: cada perfil EAS fija su entorno y las actualizaciones OTA apuntan explícitamente a `production`.
62. Paridad de fallback: sin `DATABASE_URL`, las visitas visibles también recalculan reputación, recencia, dispersión y volumen de reseñas para mantener el mismo comportamiento del MVP.
63. Deep links compartibles: fichas, listas y Wrapped generan URLs `tacos://...` para abrir directamente el contenido compartido en la app.
64. Diario temporal: el periodo del Diario y el año de Wrapped se calculan desde datos reales o el año actual, sin fechas hardcodeadas.
65. Búsqueda eficiente: el mapa espera 250 ms después de la última tecla antes de consultar el API y permite confirmar la búsqueda con Enter.
66. Buscar en esta zona: al mover el mapa nativo aparece una acción explícita que consulta el nuevo centro sin perder la ubicación del usuario.
67. Desarrollo local: `pnpm dev:local` levanta el API y el preview web en paralelo para probar el producto con un solo comando.
68. Horarios confiables: el filtro “Abierto ahora” distingue negocios diurnos de cierres de madrugada y rechaza horas malformadas.
69. Estados vacíos accionables: el mapa explica cuando una combinación no tiene resultados y permite limpiar la búsqueda y los filtros en un toque.
70. Perfil vivo: las colonias exploradas se calculan desde el Diario del usuario y no desde un número fijo.
71. Privacidad completa: ocultar actividad también retira esa señal de las recomendaciones sociales, tanto en PostgreSQL como en el fallback local.
72. Privacidad inmediata: el cliente invalida feed y recomendaciones al cambiar el ajuste, y la pantalla describe el alcance real del cambio.
73. Seguimiento desde perfil: los perfiles públicos muestran y actualizan el estado Seguir/Siguiendo, con cachés sociales invalidadas después de cada cambio.
74. Mapa por taco: una búsqueda como “suadero” detecta el taco del menú, ordena por su reputación y muestra ese rating en pins y tarjetas, en lugar del promedio global.
75. Paridad de búsqueda: PostgreSQL también encuentra sucursales por nombre de taco mediante `EXISTS` e índice trigram, igual que el fallback local.
76. Decisión en la ficha: el detalle calcula precio promedio del menú y estado de apertura con la misma regla nocturna del mapa.
77. Sesión sin parpadeos: Diario, Perfil y Registro esperan la restauración de SecureStore/localStorage antes de mostrar fixtures o estados de autenticación.

## Verificación

```bash
pnpm typecheck
pnpm build:api
pnpm smoke:hours
pnpm --filter @tacos/mobile exec expo export --platform web
pnpm smoke:api # requiere la API activa en http://127.0.0.1:4000
pnpm smoke:admin # requiere la API activa con ADMIN_EMAILS=admin-smoke@example.com
```

Cada push y pull request a `main` o `master` ejecuta estos checks en GitHub Actions (`.github/workflows/ci.yml`). Render sólo debería desplegar commits que pasen esta verificación.

## Deploy

### API en Render

1. Sube este repositorio a GitHub.
2. En Render elige **New → Blueprint**, selecciona el repositorio y confirma `render.yaml`.
3. Render creará `tacos-api`, `tacos-worker`, `tacos-nightly`, `tacos-keyvalue` y `tacos-postgres`.
4. El `JWT_SECRET` se genera automáticamente; configura `STORAGE_BUCKET_URL`, `S3_BUCKET`, `S3_ACCESS_KEY_ID` y `S3_SECRET_ACCESS_KEY` para activar las fotos. `S3_ENDPOINT` permite usar R2, MinIO u otro proveedor compatible.
5. Comprueba `https://<tu-api>.onrender.com/health`.

Después de aplicar la migración `009_admin_roles.sql`, puedes promover una cuenta existente desde la consola SQL de Render con `UPDATE users SET role = 'admin' WHERE email_lower = 'tu-correo@example.com';`. Para el primer registro también puedes definir `ADMIN_EMAILS` antes de crear la cuenta.

El servicio ejecuta las migraciones antes de cada deploy mediante `preDeployCommand`; no hay que conectarse a esta computadora para mantenerlo activo.

### Builds iOS y Android

Desde `apps/mobile` inicia sesión en Expo y crea el proyecto EAS una sola vez. Los perfiles de `eas.json` fijan explícitamente los entornos `development`, `preview` y `production` para que la URL de Render no se mezcle entre builds:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest env:set --name EXPO_PUBLIC_API_URL --value https://<tu-api>.onrender.com --environment production --visibility plaintext
npx eas-cli@latest env:set --name GOOGLE_MAPS_API_KEY --value <tu-clave> --environment production --visibility sensitive
npx eas-cli@latest build --platform all --profile production
npx eas-cli@latest submit --platform ios --profile production
npx eas-cli@latest submit --platform android --profile production
```

Los builds ocurren en EAS, no en esta computadora. El perfil `production` falla de forma explícita si `EXPO_PUBLIC_API_URL` no es HTTPS o si falta `GOOGLE_MAPS_API_KEY`, evitando publicar una app que dependa de `localhost`. Para actualizaciones JavaScript posteriores usa `eas update --channel production --environment production`.
