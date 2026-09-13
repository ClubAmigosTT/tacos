import { Image, type ImageStyle, type ImageSourcePropType, type StyleProp } from 'react-native';
import { useEffect, useState } from 'react';

const fallbackSource = require('../assets/taco-logo.png') as ImageSourcePropType;

export function CatalogImage({
  uri,
  style,
  accessibilityLabel,
  resizeMode = 'cover'
}: {
  uri?: string | null;
  style?: StyleProp<ImageStyle>;
  accessibilityLabel?: string;
  resizeMode?: 'cover' | 'contain' | 'stretch' | 'repeat' | 'center';
}) {
  const normalizedUri = typeof uri === 'string' && uri.trim() ? uri.trim() : undefined;
  const [failedUri, setFailedUri] = useState<string>();
  const useFallback = !normalizedUri || failedUri === normalizedUri;

  useEffect(() => {
    setFailedUri(undefined);
  }, [normalizedUri]);

  return (
    <Image
      accessibilityLabel={accessibilityLabel}
      source={useFallback ? fallbackSource : { uri: normalizedUri }}
      onError={() => normalizedUri && setFailedUri(normalizedUri)}
      resizeMode={resizeMode}
      style={style}
    />
  );
}
