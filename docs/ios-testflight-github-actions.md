# Publicar Tacos en TestFlight desde GitHub Actions

El workflow `.github/workflows/ios-testflight.yml` compila Tacos en un runner
macOS con `eas build --local` y usa `eas submit` para enviarlo a TestFlight. No
usa la cuota de compilación cloud de EAS.

El workflow es manual: se ejecuta desde GitHub en **Actions > Tacos iOS
TestFlight > Run workflow**. No se ejecuta con cada push.

## Configuración única en GitHub

En **Settings > Secrets and variables > Actions** agrega:

### Repository variable

- `EXPO_PUBLIC_API_URL`: URL HTTPS real del API de producción en Render.

### Repository secrets

- `EXPO_TOKEN`: token de Expo con acceso de Developer al proyecto `tacos`.

La API key de App Store Connect ya está configurada en el servicio de
credenciales de EAS para este proyecto. Nunca guardes contraseñas o tokens en
el repositorio. El workflow detiene la ejecución antes de usar macOS si falta
algún valor.

## Orden de ejecución

1. Ubuntu instala dependencias y ejecuta typecheck, configuración, entradas,
   catálogo, fotos y exportación web.
2. Solo si todo pasa, macOS genera el IPA con las credenciales remotas ya
   existentes en Expo.
3. El IPA se sube a TestFlight con EAS Submit usando la API key existente de
   App Store Connect.

Si la subida a Apple falla después de generar el IPA, se debe corregir el paso
de subida y reutilizar el mismo artefacto; no se debe iniciar otra compilación
sin revisar los logs.
