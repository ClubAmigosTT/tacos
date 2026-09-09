# Plan de trabajo — Tacos

Este documento convierte la visión de producto en una secuencia ejecutable para iOS, Android y una API que corre en Render. La regla de arquitectura es empezar con un monolito modular y separar servicios sólo cuando haya una métrica de escala que lo justifique.

## 1. Decisiones base

- **Mobile:** Expo + React Native + Expo Router. Una sola base de código para iOS, Android y una exportación web de revisión.
- **API:** Fastify + TypeScript. Módulos separados por dominio: auth, discovery, visits, lists, social, recommendations, moderation y media.
- **Datos:** PostgreSQL con PostGIS en Render. La unidad de reputación es `taquería → sucursal → taco`; la experiencia se registra como `Usuario → Visita → Calificación → Contexto`.
- **Media:** bucket S3-compatible. Render no debe guardar fotografías en disco local.
- **Jobs:** worker y cron preparados en Render para recalcular señales, limpiar tareas y actualizar agregados.
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
3. Mantener rutas Expo pequeñas y orientadas a una sola tarea.

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
21. Proteger deep links personales (Radar, Passport, Wrapped, Privacidad, edición y comentarios) durante la restauración de sesión.
22. Sincronizar el estado de Ajustes tras restaurar el usuario y bloquear consultas privadas hasta contar con un token válido.
23. Mantener el catálogo seed alineado con el fallback móvil mediante migraciones idempotentes.
24. Mantener permisos nativos mínimos y no solicitar audio para una app que sólo usa ubicación, cámara y galería.
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
13. Proponer la sucursal más cercana después de usar la cámara, manteniendo la selección explícita del usuario hasta confirmar.

**Aceptación:** una visita aparece en diario, feed y estadísticas; una foto inválida no se persiste; una falla de media permite guardar sin foto; una edición propia persiste y una edición ajena responde 404.

### Fase 6 — Grafo social y recomendaciones (4–7 días)

1. Buscar personas, seguir/dejar de seguir y persistir el estado del botón.
2. Requerir autenticación para consultar el directorio social y no exponer correos a visitantes anónimos.
3. Abrir perfiles públicos con Taste ID, estadísticas y listas públicas; no exponer correo en esa vista.
4. Calcular reputación robusta (prior bayesiano, recencia, dispersión y límite por revisor) y afinidad de sabor; combinarla con señales de personas seguidas.
5. Mostrar notas de visitas en el feed y llevar al perfil desde avatar/nombre.

**Aceptación:** el smoke test confirma follow, unfollow, feed con nota, perfil público, exclusión de listas privadas y edición autorizada de listas.

### Fase 7 — Moderación y operación (2–4 días)

1. Permitir reportar una visita una sola vez por usuario.
2. Ocultar contenido desde el panel admin sin borrar la evidencia.
3. Arrancar el primer admin con `ADMIN_EMAILS` o SQL controlado en Render.
4. Añadir límites de tamaño, logs estructurados, manejo de errores sin filtrar secretos y fallo explícito si producción no tiene `JWT_SECRET`.
5. Configurar health checks que validen PostgreSQL, el esquema migrado y PostGIS, además de cierre graceful para que Render pueda reemplazar instancias sin conexiones huérfanas.
6. Ejecutar mantenimiento periódico desde worker/cron: analizar tablas operativas y aplicar retención explícita sólo a eventos de producto.
7. Mantener índices parciales para las agregaciones de reputación sobre visitas visibles y ratings de tacos.
8. Ejecutar el migrador con un cliente dedicado y un lock advisory para que los reemplazos de Render no apliquen el mismo archivo en paralelo.
9. Hacer que web, worker y cron sólo auto-desplieguen después de que pase el workflow de CI.
10. Mantener el fallback local alineado con PostgreSQL para poder validar el flujo de reputación sin depender de una base local.
11. Compartir fichas, listas y Wrapped con deep links del esquema `tacos://`, manteniendo una ruta web equivalente en Expo Router.
12. Derivar periodos y resúmenes del Diario desde las fechas reales para que el producto no dependa de un año fijo.

**Aceptación:** un reporte aparece en `/v1/admin/reports`, un admin puede ocultarlo, el feed deja de mostrarlo, el perfil público no lo cuenta y `pnpm smoke:admin` confirma que no contamina recomendaciones.

### Fase 8 — CI, Render y releases móviles (2–3 días de configuración)

1. Subir el repositorio a GitHub y proteger `main`/`master` con `.github/workflows/ci.yml`.
2. Crear el Blueprint de Render con `render.yaml`: API web, worker, cron, Key Value y PostgreSQL.
3. Configurar secretos en Render: `JWT_SECRET`, `DATABASE_URL`, `ADMIN_EMAILS` y credenciales S3.
4. Verificar `/health`, aplicar migraciones con `preDeployCommand` y revisar logs del primer deploy.
5. En EAS: `eas init`, definir `EXPO_PUBLIC_API_URL` HTTPS y `GOOGLE_MAPS_API_KEY`, compilar el perfil production y enviar a TestFlight/Google Play.
6. Fijar el entorno EAS en cada perfil y, para cambios JavaScript posteriores, usar `eas update --channel production --environment production`; para cambios nativos generar un nuevo build.
7. Hacer que el perfil EAS `production` falle si la URL de API no es HTTPS o si Android no tiene `GOOGLE_MAPS_API_KEY`.

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
| `ADMIN_EMAILS` | opcional | lista controlada de bootstrap |

## 5. Estado actual y siguiente paso externo

El repositorio ya contiene el MVP funcional de las fases 1–7: mapa contextual, detalle normalizado, registro, fotos, diario, Taste ID, Radar, listas públicas/privadas, guardados, grafo social, perfiles, recomendaciones, feed, moderación y CI.

Para desarrollo local, `pnpm dev:local` levanta API y preview web en paralelo; la app queda disponible en `http://localhost:8081/` y el health check en `http://localhost:4000/health`.

Lo único que no puede completarse desde este entorno es la conexión de cuentas externas: crear el repositorio remoto, autorizar Render/EAS, pegar las claves S3/Maps y ejecutar el primer deploy. Una vez configuradas esas credenciales, la secuencia de la Fase 8 deja la app operando sin depender de esta computadora.

## 6. Evolución después del MVP

- Medir latencia y volumen antes de separar recomendaciones, búsqueda o media en microservicios.
- Añadir pruebas de carga y backups/restores de PostgreSQL; los eventos de producto, comentarios moderados, listas colaborativas y sugerencia asistida por cámara ya están incluidos en el MVP.
- Mantener el score bayesiano como guardrail aunque se añadan embeddings o collaborative filtering.
