import { Image, StyleSheet, Text, type ImageStyle, type ImageSourcePropType, type StyleProp, type ViewStyle, View } from 'react-native';
import { useEffect, useState } from 'react';
import { colors, radii, typography } from '@/theme';

const fallbackSource = require('../assets/taco-logo.png') as ImageSourcePropType;
const catalogDummySources: Record<string, ImageSourcePropType> = {
  'catalog-dummy://pastor': require('../assets/catalog-dummies/taco-pastor.jpg') as ImageSourcePropType,
  'catalog-dummy://suadero': require('../assets/catalog-dummies/taco-suadero.jpg') as ImageSourcePropType,
  'catalog-dummy://canasta': require('../assets/catalog-dummies/taco-canasta.jpg') as ImageSourcePropType,
  'catalog-dummy://birria': require('../assets/catalog-dummies/taco-birria.jpg') as ImageSourcePropType,
  'catalog-dummy://user-01': require('../assets/catalog-dummies/taco-user-01.jpg') as ImageSourcePropType,
  'catalog-dummy://user-02': require('../assets/catalog-dummies/taco-user-02.jpg') as ImageSourcePropType,
  'catalog-dummy://user-03': require('../assets/catalog-dummies/taco-user-03.jpg') as ImageSourcePropType,
  'catalog-dummy://user-04': require('../assets/catalog-dummies/taco-user-04.jpg') as ImageSourcePropType,
  'catalog-dummy://user-05': require('../assets/catalog-dummies/taco-user-05.jpg') as ImageSourcePropType,
  'catalog-dummy://user-06': require('../assets/catalog-dummies/taco-user-06.jpg') as ImageSourcePropType,
  'catalog-dummy://user-07': require('../assets/catalog-dummies/taco-user-07.jpg') as ImageSourcePropType,
  'catalog-dummy://user-08': require('../assets/catalog-dummies/taco-user-08.jpg') as ImageSourcePropType,
  'catalog-dummy://user-09': require('../assets/catalog-dummies/taco-user-09.jpg') as ImageSourcePropType,
  'catalog-dummy://user-10': require('../assets/catalog-dummies/taco-user-10.jpg') as ImageSourcePropType,
  'catalog-dummy://user-11': require('../assets/catalog-dummies/taco-user-11.jpg') as ImageSourcePropType,
  'catalog-dummy://user-12': require('../assets/catalog-dummies/taco-user-12.jpg') as ImageSourcePropType,
  'catalog-dummy://user-13': require('../assets/catalog-dummies/taco-user-13.jpg') as ImageSourcePropType,
  'catalog-dummy://user-14': require('../assets/catalog-dummies/taco-user-14.jpg') as ImageSourcePropType,
  'catalog-dummy://user-15': require('../assets/catalog-dummies/taco-user-15.jpg') as ImageSourcePropType,
  'catalog-dummy://user-16': require('../assets/catalog-dummies/taco-user-16.jpg') as ImageSourcePropType,
  'catalog-dummy://user-17': require('../assets/catalog-dummies/taco-user-17.jpg') as ImageSourcePropType,
  'catalog-dummy://user-18': require('../assets/catalog-dummies/taco-user-18.jpg') as ImageSourcePropType,
  'catalog-dummy://user-19': require('../assets/catalog-dummies/taco-user-19.jpg') as ImageSourcePropType,
  'catalog-dummy://user-20': require('../assets/catalog-dummies/taco-user-20.jpg') as ImageSourcePropType,
  'catalog-dummy://user-21': require('../assets/catalog-dummies/taco-user-21.jpg') as ImageSourcePropType,
  'catalog-dummy://user-22': require('../assets/catalog-dummies/taco-user-22.jpg') as ImageSourcePropType,
  'catalog-dummy://user-23': require('../assets/catalog-dummies/taco-user-23.jpg') as ImageSourcePropType
};

export function CatalogImage({
  uri,
  style,
  accessibilityLabel,
  resizeMode = 'cover',
  fallbackLabel = 'Imagen ilustrativa'
}: {
  uri?: string | null;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
  fallbackLabel?: string;
}) {
  const normalizedUri = typeof uri === 'string' && uri.trim() ? uri.trim() : undefined;
  const localSource = normalizedUri ? catalogDummySources[normalizedUri] : undefined;
  const [failedUri, setFailedUri] = useState<string>();
  const useFallback = !normalizedUri || failedUri === normalizedUri;

  useEffect(() => {
    setFailedUri(undefined);
  }, [normalizedUri]);

  if (useFallback) {
    return (
      <View accessible accessibilityLabel={accessibilityLabel} style={[styles.placeholder, style as StyleProp<ViewStyle>]}>
        <Image source={fallbackSource} resizeMode="contain" style={styles.placeholderImage} />
        <Text style={styles.placeholderLabel}>{fallbackLabel}</Text>
      </View>
    );
  }

  if (localSource) {
    return <Image accessibilityLabel={accessibilityLabel} source={localSource} resizeMode={resizeMode} style={style} />;
  }

  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      source={{ uri: normalizedUri }}
      onError={() => normalizedUri && setFailedUri(normalizedUri)}
      resizeMode={resizeMode}
      style={style}
    />
  );
}

const styles = StyleSheet.create({
  placeholder: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden', backgroundColor: colors.surfaceRaised, borderRadius: radii.md },
  placeholderImage: { width: '52%', height: '56%', opacity: 0.82 },
  placeholderLabel: { color: colors.textTertiary, fontFamily: typography.fontFamily.medium, fontSize: 10, textAlign: 'center', marginTop: 2 }
});
