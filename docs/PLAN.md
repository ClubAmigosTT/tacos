# Plan de trabajo — Tacos

Este documento convierte la visión de producto en una secuencia ejecutable para iOS, Android y una API que corre en Render. La regla de arquitectura es empezar con un monolito modular y separar servicios sólo cuando haya una métrica de escala que lo justifique.

## 1. Decisiones base

- **Mobile:** Expo + React Native + Expo Router. Una sola base de código para iOS, Android y una exportación web de revisión.
- **API:** Fastify + TypeScript. Módulos separados por dominio: auth, discovery, visits, lists, social, recommendations, moderation y media.
- **Datos:** PostgreSQL con PostGIS en Render. La unidad de reputación es `taquería → sucursal → taco`; la experiencia se registra como `Usuario → Visita → Calificación → Contexto`.
- **Media:** bucket S3-compatible. Render no debe guardar fotografías en disco local.
- **Jobs:** worker y cron preparados en Render para recalcular señales, limpiar tareas y actualizar agregados.
- **Entrega:** GitHub Actions valida cada push; EAS compila iOS/Android; Render mantiene la API y la base de datos sin depender de esta computadora.

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

**Aceptación:** `pnpm --filter @tacos/api migrate` termina sin errores y una consulta de sucursal devuelve su taquería padre, tacos y perfil de sabor.

### Fase 3 — API y cuenta (3–5 días)

1. Mantener JWT corto y contraseñas con bcrypt.
2. Validar payloads con Zod en cada endpoint.
3. Aplicar autorización por propietario para listas, visitas y contenido privado.
4. Exponer una preferencia de actividad para que cada usuario decida si sus visitas alimentan el feed social.
5. Mantener el repositorio en memoria sólo como fallback de diseño local; producción siempre usa `DATABASE_URL`.

**Aceptación:** registro, login, `/v1/me`, 401/403, listas privadas, preferencia de actividad y aislamiento entre usuarios están cubiertos por `scripts/smoke-api.mjs`.

### Fase 4 — Descubrimiento y mapa (3–5 días)

1. Consultar `/v1/discover` con texto, latitud, longitud y límite.
2. Calcular distancia con PostGIS en producción y Haversine en fallback.
3. Ordenar pins por el criterio activo: taco, apertura, precio, afinidad o calidad.
4. Mantener Mapbox/Google Maps como infraestructura visual; el ranking y los pins son propiedad de Tacos.

**Aceptación:** “Pastor”, “Abierto ahora”, “Barato” y “Para mí” producen resultados ordenados; negar ubicación no rompe el catálogo.

### Fase 5 — Visitas, diario y media (3–5 días)

1. Registrar sucursal, uno o más tacos, rating general, ratings por taco, precio, nota y coordenadas opcionales.
2. Rechazar tacos de otra sucursal, duplicados y ratings no seleccionados.
3. Subir fotos validadas por firma y tamaño a S3-compatible; guardar sólo la URL en PostgreSQL.
4. Mostrar diario, Taste ID, Passport y Wrapped; compartir el resumen mediante la hoja nativa.
5. Permitir que el propietario corrija rating, precio y nota sin alterar la sucursal ni los tacos registrados.
6. Mostrar las listas como rutas: mapa compacto, progreso visitado y navegación a cada sucursal.

**Aceptación:** una visita aparece en diario, feed y estadísticas; una foto inválida no se persiste; una falla de media permite guardar sin foto; una edición propia persiste y una edición ajena responde 404.

### Fase 6 — Grafo social y recomendaciones (4–7 días)

1. Buscar personas, seguir/dejar de seguir y persistir el estado del botón.
2. Abrir perfiles públicos con Taste ID, estadísticas y listas públicas; no exponer correo en esa vista.
3. Calcular reputación bayesiana y afinidad de sabor; combinarla con señales de personas seguidas.
4. Mostrar notas de visitas en el feed y llevar al perfil desde avatar/nombre.

**Aceptación:** el smoke test confirma follow, unfollow, feed con nota, perfil público, exclusión de listas privadas y edición autorizada de listas.

### Fase 7 — Moderación y operación (2–4 días)

1. Permitir reportar una visita una sola vez por usuario.
2. Ocultar contenido desde el panel admin sin borrar la evidencia.
3. Arrancar el primer admin con `ADMIN_EMAILS` o SQL controlado en Render.
4. Añadir límites de tamaño, logs estructurados y manejo de errores sin filtrar secretos.
5. Configurar health checks y cierre graceful para que Render pueda reemplazar instancias sin conexiones huérfanas.

**Aceptación:** un reporte aparece en `/v1/admin/reports`, un admin puede ocultarlo, el feed deja de mostrarlo, el perfil público no lo cuenta y `pnpm smoke:admin` confirma que no contamina recomendaciones.

### Fase 8 — CI, Render y releases móviles (2–3 días de configuración)

1. Subir el repositorio a GitHub y proteger `main`/`master` con `.github/workflows/ci.yml`.
2. Crear el Blueprint de Render con `render.yaml`: API web, worker, cron, Key Value y PostgreSQL.
3. Configurar secretos en Render: `JWT_SECRET`, `DATABASE_URL`, `ADMIN_EMAILS` y credenciales S3.
4. Verificar `/health`, aplicar migraciones con `preDeployCommand` y revisar logs del primer deploy.
5. En EAS: `eas init`, definir `EXPO_PUBLIC_API_URL` HTTPS y `GOOGLE_MAPS_API_KEY`, compilar el perfil production y enviar a TestFlight/Google Play.
6. Para cambios JavaScript posteriores usar `eas update --channel production`; para cambios nativos generar un nuevo build.

**Aceptación:** la API responde desde `https://…onrender.com`, la app se conecta sin esta computadora encendida y el smoke test corre en CI.

## 3. Comandos de trabajo

```bash
pnpm install
copy .env.example .env
pnpm dev:api
pnpm dev:mobile
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

Lo único que no puede completarse desde este entorno es la conexión de cuentas externas: crear el repositorio remoto, autorizar Render/EAS, pegar las claves S3/Maps y ejecutar el primer deploy. Una vez configuradas esas credenciales, la secuencia de la Fase 8 deja la app operando sin depender de esta computadora.

## 6. Evolución después del MVP

- Medir latencia y volumen antes de separar recomendaciones, búsqueda o media en microservicios.
- Añadir eventos de analítica anónimos, pruebas de carga y backups/restores de PostgreSQL.
- Incorporar comentarios moderados, listas colaborativas y detección asistida por cámara sólo después de validar el hábito de registro; la edición de visitas ya está incluida en el MVP.
- Mantener el score bayesiano como guardrail aunque se añadan embeddings o collaborative filtering.
