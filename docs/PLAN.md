# Plan de trabajo — Tacos

Este documento convierte la visión de producto en una secuencia ejecutable para iOS, Android y una API que corre en Render. La regla de arquitectura es empezar con un monolito modular y separar servicios sólo cuando haya una métrica de escala que lo justifique.

## 1. Decisiones base

- **Mobile:** Expo + React Native + Expo Router. Una sola base de código para iOS, Android y una exportación web de revisión.
- **API:** Fastify + TypeScript. Módulos separados por dominio: auth, discovery, visits, lists, social, recommendations, moderation y media.
- **Datos:** PostgreSQL con PostGIS en Render. La unidad de reputación es `taquería → sucursal → taco`; la experiencia se registra como `Usuario → Visita → Calificación → Contexto`.
- **Media:** bucket S3-compatible. Render no debe guardar fotografías en disco local.
- **Jobs:** mantenimiento desacoplado del API; el MVP Free lo ejecuta manualmente o desde GitHub Actions. Worker y cron se incorporan sólo cuando el volumen justifique el costo.
- **Entrega:** GitHub Actions valida cada push; EAS compila iOS/Android; Render mantiene la API y la base de datos sin depender de esta computadora.
- **Configuración local:** los procesos Node leen el `.env` raíz mediante la opción nativa `--env-file-if-exists`; Render continúa usando sus variables inyectadas.

## 2. Fases y criterios de aceptación

### Fase 0 — Producto y riesgos (1–2 días)

1. Definir la ciudad inicial, fuentes de sucursales y política de contenido.
2. Fijar métricas de MVP: registro de visita completado, retención a 7 días, búsquedas con resultado y porcentaje de recomendaciones abiertas.
3. Decidir qué datos son públicos (listas, perfiles, visitas) y qué datos son privados (correo, listas privadas).

**Aceptación:** existe un documento de decisiones, un conjunto de datos inicial y una lista de eventos de analítica sin PII.

### Fase 1 — Fundación visual y repositorio (2–3 días)

1. Mantener los tokens de color, tipografía, espaciado, radios y estados en `apps/mobile/theme.ts`.
2. Construir componentes reutilizables: `PlaceCard`, `RatingBadge`, `MapPin`, `BottomSheet`, `TasteMatch` y tarjetas de actividad.
3. Etiquetar acciones, estados y controles interactivos desde el primer render para VoiceOver, TalkBack y navegación por teclado web.
4. Mantener rutas Expo pequeñas y orientadas a una sola tarea.

**Aceptación:** `pnpm typecheck` pasa y `expo export --platform web` produce un bundle navegable.

### Fase 2 — Modelo de datos y migraciones (2–4 días)

1. Aplicar las migraciones numeradas en orden: usuarios, sucursales, menús, visitas, ratings, sabor, listas, moderación, taquerías, lugares guardados y backfill de padres.
2. Crear índices PostGIS para ubicación, trigramas para búsqueda y claves únicas para follows, reportes y guardados.
3. Sembrar datos de ejemplo sólo como datos iniciales idempotentes.
4. Probar las migraciones en una base PostgreSQL limpia antes del primer deploy.
5. Backfillear padres de taquería antes de aplicar la llave foránea para no romper catálogos existentes.

**Aceptación:** `pnpm --filter @tacos/api migrate` termina sin errores y una consulta de sucursal devuelve su taquería padre, tacos y perfil de sabor.

### Fase 3 — API y cuenta (3–5 días)

1. Mantener JWT corto y contraseñas con bcrypt.
2. Validar payloads con Zod en cada endpoint.
3. Aplicar autorización por propietario para listas, visitas y contenido privado.
4. Exponer una preferencia de actividad para que cada usuario decida si sus visitas alimentan el feed social.
5. Mantener el repositorio en memoria sólo como fallback de diseño local; producción siempre usa `DATABASE_URL`.
6. Permitir editar el nombre público desde Ajustes y reflejar el cambio inmediatamente en la sesión autenticada.
7. Ejecutar escrituras multi-entidad con clientes dedicados del pool para conservar atomicidad en producción.

**Aceptación:** registro, login, `/v1/me`, 401/403, listas privadas, preferencia de actividad y aislamiento entre usuarios están cubiertos por `scripts/smoke-api.mjs`.

### Fase 4 — Descubrimiento y mapa (3–5 días)

1. Consultar `/v1/discover` con texto, latitud, longitud y límite.
2. Calcular distancia con PostGIS en producción y Haversine en fallback.
3. Ordenar pins por el criterio activo: taco, apertura, precio, afinidad o calidad.
4. Mantener Mapbox/Google Maps como infraestructura visual; el ranking y los pins son propiedad de Tacos.
5. Conectar la búsqueda universal del inicio con el mapa contextual, conservando la consulta al navegar.
6. Servir un score de reputación conservador: prior bayesiano, recencia, penalización por dispersión y límite por revisor distinto; devolver también el volumen de reseñas visibles.
7. Aplicar debounce de 250 ms a la búsqueda del mapa para evitar consultas por cada tecla y conservar confirmación explícita con Enter.
8. Mostrar “Buscar en esta zona” al desplazar el mapa nativo y actualizar el centro sólo cuando el usuario confirma.
9. Interpretar cierres de madrugada y cierres diurnos con una regla compartida, para que “Abierto ahora” no marque abiertos los lugares después de medianoche.
10. Mostrar un estado vacío útil cuando no hay resultados y permitir restablecer búsqueda, filtros y centro del mapa sin recargar la app.
11. Derivar las estadísticas de identidad del Perfil desde las visitas reales, conservando fixtures sólo para el modo anónimo de demostración.
12. Aplicar `share_activity` también al cálculo de señales sociales de recomendaciones y cubrirlo en el smoke test.
13. Invalidar las cachés de feed y recomendaciones cuando cambia la preferencia de actividad y reflejar que afecta visitas existentes.
14. Permitir seguir/dejar de seguir desde un perfil público y devolver el estado para que la UI sobreviva a una recarga.
15. Hacer que la búsqueda de un taco cambie el rating visible de pins y tarjetas al score de ese taco, manteniendo el promedio global para consultas generales.
16. Buscar nombres de tacos activos dentro de PostgreSQL además de los campos de sucursal, con índice trigram y cobertura en el smoke test.
17. Priorizar en la ficha el precio promedio calculado, distancia y estado de apertura, reutilizando la regla de horarios compartida.
18. Evitar que la restauración de sesión muestre datos demo o un bloqueo de cuenta transitorio en Diario, Perfil y Registro.
19. Cerrar el registro con una ruta explícita al mapa e invalidar las consultas derivadas para que la visita recién guardada sea visible al regresar.
20. Mantener el contexto de taco en el hero de Inicio y hacer navegables las sucursales mostradas en Actividad.
21. Proteger deep links personales (Radar, Passport, Wrapped, Privacidad, edición y comentarios) durante la restauración de sesión, conservando el destino cuando una acción social exige autenticarse.
22. Sincronizar el estado de Ajustes tras restaurar el usuario y bloquear consultas privadas hasta contar con un token válido.
23. Mantener el catálogo seed alineado con el fallback móvil mediante migraciones idempotentes.
24. Mantener permisos nativos mínimos y no solicitar audio para una app que sólo usa ubicación, cámara y galería.
25. Mostrar una salida de navegación útil para enlaces compartidos que ya no existan.
26. Hacer explícito en cada pin qué taco determina el rating contextual del mapa.
27. Excluir del filtro de un taco las sucursales que no ofrecen ese taco.
28. No ignorar silenciosamente combinaciones imposibles del Radar; conservar fallback sólo cuando no existe distancia numérica.
29. Mantener la posición geográfica de los pins también en la revisión web, independientemente del orden de resultados.
30. Diferenciar carga y error en fichas compartidas, con una salida útil si la sucursal ya no existe.
31. Reintentar únicamente fallos transitorios de API y resolver rápido los estados 4xx.
32. No consultar el directorio social sin sesión y explicar el requisito directamente en la interfaz.
33. Ejecutar en CI un smoke del guard production de Expo antes de cualquier build móvil.
34. Dar prioridad a la búsqueda universal sobre el filtro visual por defecto: una colonia o sucursal muestra todas sus coincidencias y sólo un taco detectado cambia la reputación contextual.
35. Hacer que el mapa web de revisión también se pueda arrastrar y emita un centro geográfico al soltar para probar “Buscar en esta zona” sin un dispositivo nativo.
36. No sustituir por fixtures los resultados autenticados de Descubrimiento, ni siquiera durante la carga; Mapa y Registro deben mostrar un estado de consulta y un reintento recuperable, conservando únicamente una sucursal explícita de un deep link.
**Aceptación:** “Pastor”, “Abierto ahora”, “Barato” y “Para mí” producen resultados ordenados; negar ubicación no rompe el catálogo.

### Fase 5 — Visitas, diario y media (3–5 días)

1. Registrar sucursal, uno o más tacos, rating general, ratings por taco, precio, nota y coordenadas opcionales.
2. Rechazar tacos de otra sucursal, duplicados y ratings no seleccionados.
3. Subir fotos validadas por firma y tamaño a S3-compatible; guardar sólo la URL en PostgreSQL.
4. Mostrar diario, Taste ID, Passport y Wrapped; compartir el resumen mediante la hoja nativa.
5. Permitir que el propietario corrija rating, precio y nota sin alterar la sucursal ni los tacos registrados.
6. Mostrar las listas como rutas: mapa compacto, progreso visitado y navegación a cada sucursal.
7. Añadir conversaciones por visita con comentarios visibles, borrado por autor y límites de longitud.
8. Moderar comentarios desde una cola admin con ocultar/restaurar y preservación de evidencia.
9. Compartir listas con colaboradores editor/lector y permitir que los editores gestionen lugares sin apropiarse de la curaduría.
10. Rechazar sucursales inexistentes y excluir visitas ocultas del progreso mostrado en listas.
11. Registrar eventos de producto anónimos y acotados para medir descubrimiento, conversión a visita y uso social sin almacenar búsquedas ni PII; usar un identificador aleatorio persistido localmente para medir recurrencia.
12. Permitir eliminar una visita propia con confirmación y limpiar sus señales derivadas sin afectar entradas ajenas.
13. Proponer la sucursal y el taco mejor valorado más cercanos después de usar la cámara, manteniendo la selección explícita del usuario hasta confirmar.
14. Mantener la sucursal elegida al entrar al registro desde una ficha, aunque la consulta de cercanía se actualice después.
15. Diferenciar una falla temporal del API de un diario vacío en Diario, Reviews, Estadísticas, Passport y Wrapped, con reintento explícito.
16. Resolver la sucursal explícita desde el API al abrir Registro cuando el enlace proviene de una sucursal que no está en el catálogo demo local.
17. Invalidar las cachés derivadas de Mapa, Ficha, Listas y Taste ID después de guardar, editar o eliminar una visita.
18. Conservar el ID de una sucursal remota en el CTA de autenticación del registro para completar el deep link después del acceso.
19. Persistir un perfil mínimo junto al token y conservarlo durante fallas transitorias del API; limpiar ambos sólo ante una sesión rechazada.
20. Validar el precio opcional en cliente con formato MXN y límites idénticos al API antes de guardar o editar una visita.
21. Tratar la subida de foto como best-effort: si el bucket no está disponible, conservar la visita y sus ratings sin imagen y comunicar la degradación.
22. Cargar “Quiero ir” de forma parcial: distinguir sucursales eliminadas de fallas transitorias, mantener los guardados válidos y ofrecer actualización explícita.

**Aceptación:** una visita aparece en diario, feed y estadísticas; una foto inválida no se persiste; una falla de media permite guardar sin foto; una edición propia persiste y una edición ajena responde 404.

### Fase 6 — Grafo social y recomendaciones (4–7 días)

1. Buscar personas, seguir/dejar de seguir y persistir el estado del botón.
2. Requerir autenticación para consultar el directorio social y no exponer correos a visitantes anónimos.
3. Abrir perfiles públicos con Taste ID, estadísticas y listas públicas; no exponer correo en esa vista.
4. Calcular reputación robusta (prior bayesiano, recencia, dispersión y límite por revisor) y afinidad de sabor; combinarla con señales de personas seguidas.
5. Mostrar notas de visitas en el feed y llevar al perfil desde avatar/nombre.
6. Exponer desde el Perfil una lectura de estadísticas basada en visitas reales: tacos recurrentes, zonas, gasto, promedio y ritmo mensual.
7. Separar en el Perfil las reviews (rating, taco y nota) del timeline del Diario, manteniendo edición sólo para el propietario.
8. Ofrecer navegación rápida entre Diario, Reviews, Listas, Mapa y Estadísticas desde el Perfil.
9. Mantener estados de error y reintento en Actividad, Personas y Quiero ir para no presentar fallas de API como listas vacías.
10. Normalizar acentos en la búsqueda de sucursales y tacos para mantener el mismo resultado en fallback local y PostgreSQL.
11. Usar la reputación de catálogo como media del prior bayesiano para que la primera visita no desplace artificialmente un lugar establecido.
12. Mantener el Perfil autenticado consistente cuando fallan en conjunto sus consultas de Diario, Listas o Taste ID, con un reintento coordinado.
13. Evitar que Inicio sustituya recomendaciones autenticadas por fixtures cuando el API falla; mostrar un estado de error recuperable y conservar el fallback local sólo para visitantes anónimos.
14. Diferenciar en Inicio un feed autenticado vacío de una falla temporal y ofrecer reintento en la tarjeta de Actividad.
15. Alimentar la tarjeta editorial de Inicio desde listas públicas reales, sin filtrar listas privadas ni reemplazar una falla autenticada por contenido demo.
16. Invalidar feed, recomendaciones y perfil al cambiar un seguimiento desde Personas, manteniendo el estado del botón y comunicando errores de la mutación.
17. Limitar la respuesta pública de listas al conteo de colaboradores y reservar el roster para el propietario o un colaborador autorizado, manteniendo visible el progreso compartido.
18. Convertir el Taste ID del Perfil en una firma visual compacta, con barras de intensidad, picante, tradición, textura y valor calculadas desde el perfil real.
19. Reutilizar la firma visual del Taste ID en perfiles públicos para mantener la misma lectura de gusto en todo el grafo social.
20. Esperar la restauración de sesión antes de consultar Perfil y Listas, diferenciando el catálogo público del estado privado autenticado.
21. Compartir el componente visual de `MapPin` entre las implementaciones nativa y web para mantener consistente el rating contextual.
22. Comunicar fallos de seguimiento en el perfil público con estado accesible y reintento directo.
23. Bloquear consultas privadas hasta completar la restauración de sesión en las rutas de Diario, Social, Passport, Wrapped, Radar, Privacidad, Comentarios y edición.
24. Normalizar acentos en la detección y filtrado contextual del Radar, con una prueba que confirme la exclusión de sucursales sin el taco solicitado.
25. Mantener el motor del Radar ejecutable en Node para que CI pruebe la misma implementación que consume Expo.

**Aceptación:** el smoke test confirma follow, unfollow, feed con nota, perfil público, exclusión de listas privadas y edición autorizada de listas.

### Fase 7 — Moderación y operación (2–4 días)

1. Permitir reportar una visita una sola vez por usuario.
2. Ocultar contenido desde el panel admin sin borrar la evidencia.
3. Arrancar el primer admin con `ADMIN_EMAILS` o SQL controlado en Render.
4. Añadir límites de tamaño, logs estructurados, manejo de errores sin filtrar secretos y fallo explícito si producción no tiene `JWT_SECRET`.
5. Configurar health checks que validen PostgreSQL, el esquema migrado y PostGIS, además de cierre graceful para que Render pueda reemplazar instancias sin conexiones huérfanas.
6. Ejecutar mantenimiento periódico mediante GitHub Actions o una tarea manual:
   analizar tablas operativas y aplicar retención explícita sólo a eventos de
   producto. Añadir worker/cron de Render únicamente al superar el MVP Free.
7. Mantener índices parciales para las agregaciones de reputación sobre visitas visibles y ratings de tacos.
8. Ejecutar el migrador con un cliente dedicado y un lock advisory para que los reemplazos de Render no apliquen el mismo archivo en paralelo.
9. Mantener el API con `autoDeployTrigger: checksPass`; cualquier job externo
   de mantenimiento debe reutilizar el mismo build y pasar por CI.
10. Mantener el fallback local alineado con PostgreSQL para poder validar el flujo de reputación sin depender de una base local.
11. Compartir fichas, listas y Wrapped con deep links del esquema `tacos://`, manteniendo una ruta web equivalente en Expo Router.
12. Derivar periodos y resúmenes del Diario desde las fechas reales para que el producto no dependa de un año fijo.
13. Mantener la pantalla de Listas alineada con el resto de rutas privadas: esperar la sesión, diferenciar error de API de estado vacío y ofrecer reintento.
14. Traducir errores de parser de Fastify a respuestas 400/413 para que clientes y observabilidad distingan entradas inválidas de fallos internos.
15. Ofrecer reintento visible en la búsqueda de colaboradores cuando la consulta social no está disponible.
16. Ofrecer reintento visible al cargar comentarios de una visita para no confundir una caída temporal con una conversación vacía.
17. Mantener reintento visible también en Privacidad, Moderación y Comentarios administrativos cuando el API no esté disponible.
18. Mantener la recomendación contextual dentro del conjunto filtrado del Radar, incluyendo un estado sin resultados sin fallback silencioso.
19. Fallar explícitamente si la API o el migrador se ejecutan en producción sin `DATABASE_URL`, conservando el repositorio en memoria sólo para desarrollo y smoke local.
20. Limitar email y contraseña en los esquemas de autenticación antes de ejecutar bcrypt, con una regresión en el smoke del API.
21. Separar 404 de fallas transitorias en detalle de listas, perfiles, taquerías y edición, usando un reintento explícito sólo cuando la red o el API fallan.
22. Aplicar `share_activity` también a agregados y Taste ID del perfil público, manteniendo el diario completo para su propietario y cubriendo ambos casos en el smoke.
23. Mantener la analítica del panel admin desacoplada de la cola de moderación, con estado de error y reintento propio.
24. Conectar las variables visuales del Radar (distancia, precio, antojo y hambre) al conjunto y al orden de recomendaciones.
25. Mantener el motor de filtros y ranking del Radar fuera de las rutas visuales para reutilizarlo y probarlo de forma aislada.
26. Propagar la sesión a Descubrimiento para que “Para mí” use afinidad real y conserve contexto geográfico, con regresión en el smoke autenticado.
27. Etiquetar las acciones iconográficas de compartir y gestión de listas para que las rutas sociales sean operables sin depender del aspecto visual.
28. Comunicar fallos de mutaciones sociales y de guardado con feedback accesible o nativo, evitando acciones que fallen en silencio y conservando el contexto para reintentar.
29. Hacer recuperables las mutaciones del panel de moderación (reportes y comentarios), manteniendo la cola y el filtro actuales tras un error.
30. Compartir la normalización de nombres de taco entre Radar y pins web/nativos para que la búsqueda contextual tenga la misma lectura en todas las plataformas.
31. Tokenizar la búsqueda universal para resolver consultas como “gringa Narvarte” en el catálogo local y en PostGIS, con regresión en el smoke del API.
32. Mantener vacía una búsqueda sin términos alfanuméricos, con regresión en el smoke para no confundir entrada inválida con “todos los lugares”.
33. Conservar el token en memoria durante una falla transitoria al restaurar sesión, dejando que las rutas privadas ofrezcan reintento y reservando el cierre para `401/403`.
34. Evitar que el filtro visual “Pastor” contamine búsquedas de colonia o sucursal; sólo el contexto de taco resuelto por el buscador debe cambiar el rating de los pins.
35. Convertir acciones visuales de títulos de sección en controles accesibles y conectar Inicio → “Ver mapa” con la ruta real.

**Aceptación:** un reporte aparece en `/v1/admin/reports`, un admin puede ocultarlo, el feed deja de mostrarlo, el perfil público no lo cuenta y `pnpm smoke:admin` confirma que no contamina recomendaciones.

### Fase 8 — CI, Render y releases móviles (2–3 días de configuración)

1. Subir el repositorio a GitHub y proteger `main`/`master` con `.github/workflows/ci.yml`.
2. Crear el Blueprint gratuito de Render con `render.yaml`: frontend estático,
   API web y PostgreSQL en plan Free. Worker, cron y Key Value quedan fuera del
   MVP para no introducir cargos.
3. Configurar secretos en Render: `JWT_SECRET`, `DATABASE_URL`, `ADMIN_EMAILS` y credenciales S3.
4. Verificar `/health`, ejecutar migraciones idempotentes al arrancar el API
   (el `preDeployCommand` requiere un servicio pagado) y revisar logs del primer
   deploy.
5. En EAS: `eas init`, definir `EXPO_PUBLIC_API_URL` HTTPS y `GOOGLE_MAPS_API_KEY`, compilar el perfil production y enviar a TestFlight/Google Play.
6. Fijar el entorno EAS en cada perfil y, para cambios JavaScript posteriores, usar `eas update --channel production --environment production`; para cambios nativos generar un nuevo build.
7. Hacer que el perfil EAS `production` falle si la URL de API no es HTTPS o si Android no tiene `GOOGLE_MAPS_API_KEY`.
8. Validar `render.yaml` con sintaxis local en cada CI y, cuando existan credenciales de workspace, ejecutar el Render CLI fijado para detectar referencias antes de sincronizar el Blueprint.
9. Levantar PostgreSQL + PostGIS en CI, aplicar migraciones y correr el smoke autenticado contra la ruta de persistencia que usará Render.
10. Mantener la CLI oficial de Render fijada a una versión vigente y verificar que el Blueprint también pase su validador local antes del primer deploy.
11. Cubrir en CI por separado los dos fallos de configuración de una build production: URL de API no HTTPS y ausencia de la clave de Google Maps.
12. Aplicar la exigencia de Google Maps sólo al perfil Android y verificar que la configuración iOS pueda compilar con Apple Maps sin esa clave.
13. Exponer reseñas públicas por sucursal a partir de visitas visibles, respetando `share_activity` y sin filtrar correo u otros campos privados.
14. Aplicar `021_auth_security.sql`: sesiones de 7 días revocables, verificación y recuperación por token de un solo uso, exportación/eliminación y rate limiting persistido.
15. Aplicar `022_catalog_sources.sql` e importar `catalog/branches.json` desde una fuente autorizada; rechazar fotos sin licencia/atribución y marcar duplicados para revisión.
16. Configurar Resend y R2 antes de activar tráfico de producción. El Blueprint
    enlaza automáticamente `PUBLIC_API_URL`, `APP_WEB_URL`, `CORS_ORIGINS` y
    `EXPO_PUBLIC_API_URL` con las URLs HTTPS del frontend y la API. Mientras
    tanto, el MVP mantiene fotos opcionales, pero no debe abrirse el registro
    público sin proveedor de correo.

17. Recordar que el PostgreSQL Free expira a los 30 días, está limitado a 1 GB
    y no tiene backups. Programar exportaciones y migrar a almacenamiento
    persistente antes de usarlo como producción.

18. Mientras no exista un proveedor de correo, usar únicamente
    `render.free-demo.yaml` para una demo aislada: permite el catálogo semilla y
    desactiva temporalmente la verificación. El Blueprint de producción sigue
    siendo `render.yaml` con `REQUIRE_EMAIL_VERIFICATION=true`.

**Aceptación:** la API responde desde `https://…onrender.com`, la app se conecta sin esta computadora encendida y el smoke test corre en CI.

## 3. Comandos de trabajo

```bash
pnpm install
copy .env.example .env
pnpm dev:api
pnpm dev:mobile
pnpm dev:expo       # Expo Go / QR
pnpm dev:ios        # simulador iOS
pnpm dev:android    # emulador Android
pnpm dev:local
pnpm typecheck
pnpm build:api
pnpm smoke:inputs
pnpm smoke:config
pnpm smoke:production
pnpm smoke:api
pnpm --filter @tacos/mobile exec expo export --platform web
```

## 4. Variables por entorno

| Variable | Local | Render/EAS |
|---|---|---|
| `DATABASE_URL` | opcional para fallback | conexión interna de PostgreSQL |
| `JWT_SECRET` | secreto largo local | `generateValue: true` en Render |
| `EXPO_PUBLIC_API_URL` | `http://localhost:4000` | URL HTTPS de `tacos-api` |
| `GOOGLE_MAPS_API_KEY` | opcional | secreto de EAS para Android |
| `S3_*` / `STORAGE_BUCKET_URL` | opcional | credenciales del bucket |
| `STORAGE_REQUIRED` / `ALLOW_DEMO_CATALOG` | `false` / `true` | `false` / `false` en el MVP Free; cambiar `STORAGE_REQUIRED` a `true` al configurar R2/S3 |
| `ADMIN_EMAILS` | opcional | lista controlada de bootstrap |
| `PUBLIC_API_URL` / `APP_WEB_URL` | `http://localhost:4000` / `http://localhost:8081` | URLs HTTPS de Render y del cliente web |
| `CORS_ORIGINS` | `http://localhost:8081` | dominios web permitidos, separados por coma |
| `RESEND_API_KEY` / `EMAIL_FROM` | opcional | correo transaccional de verificación y recuperación |
| `REQUIRE_EMAIL_VERIFICATION` | `false` | `true` en Render antes de entregar sesiones |
| `CATALOG_FEED_URL` / `CATALOG_SOURCE_*` | opcional | feed HTTPS, procedencia y licencia del catálogo |

## 5. Estado actual y siguiente paso externo

El repositorio ya contiene el MVP funcional de las fases 1–7, más la base de seguridad de cuentas y el importador auditable de catálogo: mapa contextual, detalle normalizado, registro, fotos, diario, Taste ID, Radar, listas públicas/privadas, guardados, grafo social, perfiles, recomendaciones, feed, moderación y CI.

Para desarrollo local, `pnpm dev:local` levanta API y preview web en paralelo; la app queda disponible en `http://localhost:8081/` y el health check en `http://localhost:4000/health`.

La infraestructura de producción ya funciona fuera de esta computadora con
Render Free, Neon PostgreSQL/PostGIS, Resend y EAS. Siguen siendo insumos del
propietario el catálogo de sucursales y fotos con licencia, el almacenamiento
R2 para cargas reales y el certificado Apple de distribución.

### 5.1 Estado de ejecución — 9 de septiembre de 2026

- **Render demo gratuita:** Blueprint `tacos-free-demo` creado y servicio
  `tacos-api-free` en `https://tacos-api-free.onrender.com`. `/health` responde
  `200` con PostgreSQL y `/v1/discover` devuelve las tres sucursales semilla.
- **Producción gratuita:** Blueprint `tacos-production` creado. La API vive en
  `https://tacos-api.onrender.com`, la web en
  `https://tacos-web.onrender.com` y ambas responden correctamente por HTTPS.
- **Base de datos persistente:** Neon `tacos-production` está enlazado al API,
  PostGIS está habilitado y las migraciones se ejecutan idempotentemente al
  arrancar el servicio.
- **Correo:** `clubamigostt.com` está verificado en Resend mediante DKIM, SPF y
  MX administrados en Cloudflare. Render conserva la clave de envío como
  secreto y usa `Tacos <hola@clubamigostt.com>`.
- **EAS:** `EXPO_PUBLIC_API_URL` de producción apunta a la API HTTPS y
  `GOOGLE_MAPS_API_KEY` está guardada como secreto para Android. La build de
  simulador iOS
  `f21afbed-d7ca-4e3e-8b3b-2122f9f6eee3` terminó correctamente y su artefacto
  está disponible desde la página de EAS. La build Android de producción
  `8639e295-ade8-45db-8ee6-a58cf9401607` fue enviada a EAS.
- **Pendiente de contenido y tiendas:** importar un catálogo real con fuente y
  fotos licenciadas, crear R2 antes de habilitar cargas persistentes y validar
  las credenciales Apple de distribución para generar la build de TestFlight.
  Producción oculta deliberadamente las tres sucursales demo.
- **Límite del plan gratuito:** Render puede dormir el API por inactividad y
  provocar un primer request lento. Neon sustituye al PostgreSQL temporal de
  Render, por lo que los datos de producción no expiran a los 30 días.

## 6. Evolución después del MVP

- Medir latencia y volumen antes de separar recomendaciones, búsqueda o media en microservicios.
- Añadir pruebas de carga y backups/restores de PostgreSQL; los eventos de producto, comentarios moderados, listas colaborativas y sugerencia asistida por cámara ya están incluidos en el MVP.
- Mantener el score bayesiano como guardrail aunque se añadan embeddings o collaborative filtering.
