import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing } from '@/theme';

export type TasteSignatureProfile = {
  intensity: number;
  spicy: number;
  traditional: number;
  texture: number;
  value: number;
};

const dimensions = [
  { key: 'intensity', label: 'Intensidad' },
  { key: 'spicy', label: 'Picante' },
  { key: 'traditional', label: 'Tradición' },
  { key: 'texture', label: 'Textura' },
  { key: 'value', label: 'Valor' }
] as const;

export function TasteSignature({ profile }: { profile?: TasteSignatureProfile }) {
  const values = profile ?? { intensity: 86, spicy: 72, traditional: 94, texture: 88, value: 78 };
  return <View accessibilityLabel="Firma de sabor" style={styles.signature}>
    {dimensions.map(({ key, label }) => {
      const value = Math.max(0, Math.min(100, Math.round(values[key] ?? 0)));
      return <View key={key} style={styles.dimension}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${value}%` as any }]} /></View>
        <Text style={styles.value}>{value}</Text>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  signature: { marginTop: spacing.lg, gap: 9 },
  dimension: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: colors.muted, fontSize: 9, fontWeight: '800', width: 68 },
  track: { flex: 1, height: 6, backgroundColor: colors.surface, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', backgroundColor: colors.accent, borderRadius: 4 },
  value: { color: colors.ink, width: 24, textAlign: 'right', fontSize: 10, fontWeight: '900' }
});
