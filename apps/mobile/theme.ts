import { Platform } from 'react-native';

/**
 * Tacos visual language.
 *
 * Keep visual decisions here so every mobile surface shares one point of
 * truth. Screens consume these semantic tokens instead of owning palette
 * decisions, which keeps the redesign consistent without touching product
 * behavior or navigation.
 */
export const colors = {
  background: '#100E0B',
  surface: '#191612',
  surfaceElevated: '#211D18',
  surfaceRaised: '#211D18',

  textPrimary: '#F5EFE4',
  textSecondary: '#9B958B',
  textTertiary: '#857D71',

  tortilla: '#F2D99B',
  meat: '#6E3D22',
  meatDark: '#3B2418',
  cilantro: '#648342',
  cilantroLight: '#88A95A',
  salsa: '#D47745',

  // Semantic colors preserve meaning across the product.
  success: '#648342',
  successLight: '#88A95A',
  danger: '#D96F5D',
  info: '#728BC1',

  // Low-contrast separators and map/overlay surfaces.
  border: 'rgba(242,217,155,0.15)',
  borderStrong: 'rgba(242,217,155,0.25)',
  overlay: 'rgba(16,14,11,0.84)',
  overlayStrong: 'rgba(16,14,11,0.96)',
  surfaceTranslucent: 'rgba(25,22,18,0.94)',
  salsaSoft: 'rgba(212,119,69,0.14)',
  salsaBorder: 'rgba(212,119,69,0.46)',
  cilantroSoft: 'rgba(100,131,66,0.34)',
  mapBase: '#141210',
  mapRoad: '#302820',
  mapLabel: '#9B958B',
  mapWater: '#11161A',

  // Small warm accents used for generated avatars and editorial details.
  avatarTerracotta: '#B96545',
  avatarBlue: '#728BC1',
  avatarOchre: '#C08A54'
} as const;

export const spacing = {
  xs: 6,
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 44
} as const;

export const radii = {
  xs: 12,
  sm: 16,
  md: 20,
  lg: 26,
  pill: 999
} as const;

export const typography = {
  fontFamily: {
    regular: 'Manrope_400Regular',
    medium: 'Manrope_500Medium',
    semibold: 'Manrope_600SemiBold',
    bold: 'Manrope_700Bold'
  },
  size: {
    micro: 9,
    caption: 11,
    body: 14,
    bodyLarge: 16,
    title: 22,
    display: 34
  },
  weight: {
    regular: '400' as const,
    medium: '500' as const,
    semibold: '600' as const,
    bold: '700' as const
  },
  lineHeight: {
    body: 20,
    bodyLarge: 24,
    title: 28,
    display: 38
  },
  tracking: {
    tight: -0.8,
    display: -1.2,
    label: 1.4,
    loose: 1.8
  }
} as const;

export const shadows = {
  // React Native Web deprecated the legacy shadow* props. Keep the native
  // shadows for iOS/Android and use the CSS equivalent on web to avoid a
  // warning and an extra style conversion on every card.
  card: Platform.select({
    web: { boxShadow: '0px 9px 18px rgba(0,0,0,0.22)' },
    default: { shadowColor: '#000000', shadowOpacity: 0.22, shadowRadius: 18, shadowOffset: { width: 0, height: 9 }, elevation: 5 }
  }),
  floating: Platform.select({
    web: { boxShadow: '0px 12px 24px rgba(0,0,0,0.32)' },
    default: { shadowColor: '#000000', shadowOpacity: 0.32, shadowRadius: 24, shadowOffset: { width: 0, height: 12 }, elevation: 8 }
  })
};
