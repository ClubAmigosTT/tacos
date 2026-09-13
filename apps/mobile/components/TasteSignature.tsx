import { StyleSheet, Text, View } from 'react-native';
import { colors, spacing, typography } from '@/theme';

export type TasteSignatureProfile = {
  intensity: number;
  spicy: number;
  traditional: number;
  texture: number;
  value: number;
};

const dimensions = [
  { key: 'intensity', label: 'Intensidad', color: colors.tortilla },
  { key: 'spicy', label: 'Picante', color: colors.salsa },
  { key: 'traditional', label: 'Tradición', color: colors.cilantroLight },
  { key: 'texture', label: 'Textura', color: colors.tortilla },
  { key: 'value', label: 'Valor', color: colors.tortilla }
] as const;

export function TasteSignature({ profile }: { profile?: TasteSignatureProfile }) {
  return <View accessibilityLabel="Firma de sabor" style={styles.signature}>
    {dimensions.map(({ key, label }) => {
      const value = profile ? Math.max(0, Math.min(100, Math.round(profile[key] ?? 0))) : undefined;
      return <View key={key} style={styles.dimension}>
        <Text style={styles.label}>{label}</Text>
        <View style={styles.track}><View style={[styles.fill, { width: `${value ?? 0}%` as any, backgroundColor: dimensions.find((dimension) => dimension.key === key)?.color }]} /></View>
        <Text style={styles.value}>{value == null ? '—' : value}</Text>
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  signature: { marginTop: spacing.lg, gap: 9 },
  dimension: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  label: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: typography.size.micro, fontWeight: typography.weight.medium, width: 68 },
  track: { flex: 1, height: 7, backgroundColor: colors.surface, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  value: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, width: 28, textAlign: 'right', fontSize: typography.size.micro, fontWeight: typography.weight.semibold }
});
