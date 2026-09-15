# Publicar Tacos en TestFlight desde GitHub Actions

El workflow `.github/workflows/ios-testflight.yml` compila Tacos en un runner
macOS con `eas build --local` y sube el IPA directamente a TestFlight. No usa
la cuota de compilación cloud de EAS.

El workflow es manual: se ejecuta desde GitHub en **Actions > Tacos iOS
TestFlight > Run workflow**. No se ejecuta con cada push.

## Configuración única en GitHub

En **Settings > Secrets and variables > Actions** agrega:

### Repository variable

- `EXPO_PUBLIC_API_URL`: URL HTTPS real del API de producción en Render.

### Repository secrets

- `EXPO_TOKEN`: token de Expo con acceso de Developer al proyecto `tacos`.
- `APPSTORE_ISSUER_ID`: Issuer ID de App Store Connect.
- `APPSTORE_API_KEY_ID`: Key ID de la clave de App Store Connect.
- `APPSTORE_API_PRIVATE_KEY`: contenido completo del archivo `.p8`.

Nunca guardes el `.p8`, contraseñas o tokens en el repositorio. El workflow
detiene la ejecución antes de usar macOS si falta algún valor.

## Orden de ejecución

1. Ubuntu instala dependencias y ejecuta typecheck, configuración, entradas,
   catálogo, fotos y exportación web.
2. Solo si todo pasa, macOS genera el IPA con las credenciales remotas ya
   existentes en Expo.
3. El IPA se sube directamente a TestFlight con la API de App Store Connect.

Si la subida a Apple falla después de generar el IPA, se debe corregir el paso
de subida y reutilizar el mismo artefacto; no se debe iniciar otra compilación
sin revisar los logs.
