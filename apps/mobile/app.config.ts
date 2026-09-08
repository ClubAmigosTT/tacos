import type { ExpoConfig } from 'expo/config';

const apiUrl = process.env.EXPO_PUBLIC_API_URL?.trim() || 'http://localhost:4000';
const mapsApiKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || '';
const easProfile = process.env.EAS_BUILD_PROFILE?.trim();

if (easProfile === 'production') {
  if (!apiUrl.startsWith('https://')) throw new Error('EXPO_PUBLIC_API_URL must be an HTTPS Render URL for production builds');
  if (!mapsApiKey) throw new Error('GOOGLE_MAPS_API_KEY is required for Android production builds');
}

const config: ExpoConfig = {
  name: 'Tacos',
  slug: 'tacos',
  version: '0.1.0',
  orientation: 'portrait',
  scheme: 'tacos',
  userInterfaceStyle: 'automatic',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.tacos.app',
    infoPlist: {
      NSLocationWhenInUseUsageDescription:
        'Usamos tu ubicación para mostrar taquerías cercanas y personalizar el mapa.'
    }
  },
  android: {
    package: 'com.tacos.app',
    adaptiveIcon: {
      backgroundColor: '#0B0D0C'
    }
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
        photosPermission: 'Usamos tus fotos para guardar recuerdos de tus visitas.',
        cameraPermission: 'Usamos la cámara para fotografiar tus tacos.'
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
    apiUrl
  }
};

export default config;
