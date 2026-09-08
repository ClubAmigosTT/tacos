import type { ExpoConfig } from 'expo/config';

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
      'react-native-maps',
      {
        androidGoogleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY ?? ''
      }
    ]
  ],
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000'
  }
};

export default config;
