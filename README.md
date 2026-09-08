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

La app móvil funciona con fixtures si no existe `DATABASE_URL`. La API local queda en `http://localhost:4000`. Para probar cuentas localmente no hace falta una base de datos: se usa un repositorio en memoria. En un entorno compartido configura al menos `JWT_SECRET` y `DATABASE_URL`.

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

## Verificación

```bash
pnpm typecheck
pnpm build:api
pnpm --filter @tacos/mobile exec expo export --platform web
```

## Deploy

### API en Render

1. Sube este repositorio a GitHub.
2. En Render elige **New → Blueprint**, selecciona el repositorio y confirma `render.yaml`.
3. Render creará `tacos-api`, `tacos-worker`, `tacos-nightly`, `tacos-keyvalue` y `tacos-postgres`.
4. El `JWT_SECRET` se genera automáticamente; agrega `STORAGE_BUCKET_URL` cuando conectes el proveedor de imágenes.
5. Comprueba `https://<tu-api>.onrender.com/health`.

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
