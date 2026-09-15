# Publicar Tacos en TestFlight desde GitHub Actions

El workflow `.github/workflows/ios-testflight.yml` compila Tacos directamente
en un runner macOS de GitHub usando `expo prebuild`, `xcodebuild` y CocoaPods;
después sube el IPA con `apple-actions/upload-testflight-build`. No usa EAS
Build cloud ni necesita `EXPO_TOKEN`.

El workflow es manual: se ejecuta desde **Actions > Tacos iOS TestFlight > Run
workflow**. No se ejecuta con cada push.

## Configuración única en GitHub

En **Settings > Secrets and variables > Actions** configura:

### Repository variable

- `EXPO_PUBLIC_API_URL`: URL HTTPS real del API de producción en Render.

### Repository secrets

- `APPLE_TEAM_ID`
- `APPSTORE_ISSUER_ID`
- `APPSTORE_API_KEY_ID`
- `APPSTORE_API_PRIVATE_KEY`
- `APPLE_DISTRIBUTION_P12`
- `APPLE_DISTRIBUTION_P12_PASSWORD`
- `APPLE_PROVISIONING_PROFILE`

Los valores de firma y App Store Connect se guardan cifrados en GitHub; nunca
se agregan al repositorio. El workflow valida todos los secretos antes de
compilar.

## Orden de ejecución

1. Ubuntu instala dependencias y ejecuta typecheck, configuración, entradas,
   catálogo, fotos y exportación web.
2. macOS valida Xcode/iOS 26, genera el proyecto nativo con Expo y ejecuta
   `pod install`.
3. Se prepara un llavero temporal, se archiva con firma manual y se exporta el
   IPA usando el bundle ID `com.clubamigostt.tacos`.
4. El IPA se envía a App Store Connect y se valida que Apple haya recibido la
   app.

Sí consume minutos de GitHub Actions. El disparador manual evita gastarlos en
cada push y la compilación no consume la cuota de EAS Build cloud.
