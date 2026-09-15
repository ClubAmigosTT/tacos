import type { ExpoConfig } from 'expo/config';

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() || 'http://localhost:4000';
const demoMode = process.env.EXPO_PUBLIC_DEMO_MODE?.trim().toLowerCase() === 'true';
const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || '';
const easProfile = process.env.EAS_BUILD_PROFILE?.trim();
const easPlatform = process.env.EAS_BUILD_PLATFORM?.trim();
const iosBuildNumber = process.env.IOS_BUILD_NUMBER?.trim() || '1';

if (easProfile === 'production') {
  if (!apiUrl.startsWith('https://')) throw new Error('EXPO_PUBLIC_API_URL must be an HTTPS Render URL for production builds');
  // iOS uses Apple Maps through react-native-maps. EAS exposes the target
  // platform while resolving the config, so only Android needs a Google key.
  // Keep the no-platform case strict for local/"all" evaluations.
  if ((!easPlatform || easPlatform === 'android') && !mapsApiKey) throw new Error('GOOGLE_MAPS_API_KEY is required for Android production builds');
}

const config: ExpoConfig = {
  name: 'Tacos',
  slug: 'tacos',
  owner: 'clubamigostt',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'tacos',
  userInterfaceStyle: 'automatic',
  icon: './assets/icon.png',
  updates: {
    url: 'https://u.expo.dev/155a5800-f93e-4680-9cc4-02450eb830b6'
  },
  runtimeVersion: {
    policy: 'appVersion'
  },
  ios: {
    // The first release is intentionally iPhone-first. Enabling iPad here
    // would advertise a layout that has not yet completed tablet QA.
    supportsTablet: false,
    bundleIdentifier: 'com.clubamigostt.tacos',
    buildNumber: iosBuildNumber,
    config: {
      usesNonExemptEncryption: false
    },
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Tu ubicación permite mostrar taquerías cercanas y calcular distancias. Solo se usa mientras tienes Tacos abierta.',
      NSCameraUsageDescription:
        'La cámara permite añadir una foto opcional a tu visita.',
      NSPhotoLibraryUsageDescription:
        'Tus fotos permiten añadir una imagen opcional a tu diario de tacos.'
    }
  },
  android: {
    package: 'com.tacos.app',
    adaptiveIcon: {
      foregroundImage: './assets/taco-logo.png',
      backgroundColor: '#F2D99B'
    },
    // The app never records audio; keep Expo's broad development permissions
    // from leaking into native production builds.
    blockedPermissions: ['android.permission.RECORD_AUDIO']
  },
  plugins: [
    'expo-router',
    [
      'expo-location',
      {
        locationWhenInUsePermission:
          'Usamos tu ubicación para mostrar taquerías cercanas y personalizar el mapa.'
      }
    ],
    [
      'expo-image-picker',
      {
        photosPermission: 'Tus fotos permiten añadir una imagen opcional a tu diario de tacos.',
        cameraPermission: 'La cámara permite añadir una foto opcional a tu visita.'
      }
    ],
    [
      'react-native-maps',
      {
        androidGoogleMapsApiKey: mapsApiKey
      }
    ]
  ],
  extra: {
    apiUrl,
    demoMode,
    eas: {
      projectId: '155a5800-f93e-4680-9cc4-02450eb830b6'
    }
  }
};

export default config;
