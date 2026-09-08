# Tacos

Aplicación mobile-first para descubrir, registrar y recordar tacos.

El repositorio ya contiene un MVP ejecutable para iOS, Android y web: mapa contextual, fichas de taquerías, registro de visitas, cuenta de usuario y diario persistente. La API está preparada para ejecutarse en Render; la app no necesita que esta computadora esté encendida una vez que `EXPO_PUBLIC_API_URL` apunte al servicio publicado.

## Estructura

- `apps/mobile`: Expo Router + React Native (iOS/Android/web), con un sistema visual compartido.
- `services/api`: Fastify + TypeScript, autenticación JWT, búsqueda y visitas.
- `database/migrations`: PostgreSQL + PostGIS, con datos iniciales y usuarios.
- `render.yaml`: Blueprint de API web, worker, cron, Redis y PostgreSQL.

## Arranque local

Requiere Node.js y pnpm.

```bash
pnpm install
copy .env.example .env
pnpm dev:api
pnpm dev:mobile
```

La app móvil funciona con fixtures si no existe `DATABASE_URL`. La API local queda en `http://localhost:4000`. Para probar cuentas localmente no hace falta una base de datos: se usa un repositorio en memoria. En un entorno compartido configura al menos `JWT_SECRET` y `DATABASE_URL`. `ADMIN_EMAILS` acepta una lista separada por comas para bootstrap controlado del primer administrador; para promover usuarios existentes usa una migración/SQL de administración.

Para abrir la app en un dispositivo físico, sustituye `EXPO_PUBLIC_API_URL` por la IP LAN de la computadora que ejecuta la API (por ejemplo `http://192.168.1.70:4000`). En producción debe ser la URL HTTPS de Render.

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

## Verificación

```bash
pnpm typecheck
pnpm build:api
pnpm --filter @tacos/mobile exec expo export --platform web
pnpm smoke:api # requiere la API activa en http://127.0.0.1:4000
```

Cada push y pull request a `main` o `master` ejecuta los mismos tres checks en GitHub Actions (`.github/workflows/ci.yml`). Render sólo debería desplegar commits que pasen esta verificación.

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

Desde `apps/mobile` inicia sesión en Expo y crea el proyecto EAS una sola vez:

```bash
npx eas-cli@latest login
npx eas-cli@latest init
npx eas-cli@latest env:set --name EXPO_PUBLIC_API_URL --value https://<tu-api>.onrender.com --environment production --visibility plaintext
npx eas-cli@latest env:set --name GOOGLE_MAPS_API_KEY --value <tu-clave> --environment production --visibility sensitive
npx eas-cli@latest build --platform all --profile production
npx eas-cli@latest submit --platform ios --profile production
npx eas-cli@latest submit --platform android --profile production
```

Los builds ocurren en EAS, no en esta computadora. Para actualizaciones JavaScript posteriores puedes usar `eas update --channel production`.
