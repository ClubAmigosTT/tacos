import { Image, StyleSheet, Text, type ImageStyle, type ImageSourcePropType, type StyleProp, type ViewStyle, View } from 'react-native';
import { useEffect, useState } from 'react';
import { colors, radii, typography } from '@/theme';

const fallbackSource = require('../assets/taco-logo.png') as ImageSourcePropType;

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
