# Tacos

Aplicación mobile-first para descubrir, registrar y recordar tacos.

## Arranque local

Requiere Node.js y pnpm.

```bash
pnpm install
pnpm dev:api
pnpm dev:mobile
```

La app móvil funciona con fixtures si no existe `DATABASE_URL`. La API local queda en `http://localhost:4000`.

## Verificación

```bash
pnpm typecheck
pnpm build:api
pnpm --filter @tacos/mobile exec expo export --platform web
```

## Deploy

- Render lee `render.yaml` y despliega API, worker, cron y PostgreSQL.
- Configura `DATABASE_URL` y `STORAGE_BUCKET_URL` como secretos en Render.
- Configura `EXPO_PUBLIC_API_URL` y `GOOGLE_MAPS_API_KEY` en los perfiles de EAS.
- Los builds móviles se generan con `eas build --platform all`.
