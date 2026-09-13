import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, typography } from '@/theme';

type Props = {
  value: number;
  onChange?: (value: number) => void;
  size?: number;
  readOnly?: boolean;
  showValue?: boolean;
  accessibilityLabel?: string;
};

export function StarRating({ value, onChange, size = 30, readOnly = false, showValue = true, accessibilityLabel = 'Calificación' }: Props) {
  const normalized = Number.isFinite(value) ? Math.max(0, Math.min(5, Math.round(value * 2) / 2)) : 0;
  const valueLabel = normalized === 0 ? 'Sin calificación' : `${normalized.toFixed(1)} de 5`;

  return <View style={styles.wrapper} accessibilityLabel={`${accessibilityLabel}: ${valueLabel}`}>
    <View style={styles.row}>
      {!readOnly ? <Pressable accessibilityRole="button" accessibilityLabel={`${accessibilityLabel}: 0 de 5, limpiar`} accessibilityState={{ selected: normalized === 0 }} onPress={() => onChange?.(0)} style={[styles.zero, normalized === 0 && styles.zeroActive]}><Text style={[styles.zeroText, normalized === 0 && styles.zeroTextActive]}>0</Text></Pressable> : null}
      {Array.from({ length: 5 }, (_, index) => {
        const star = index + 1;
        const iconName = normalized >= star ? 'star' : normalized >= star - 0.5 ? 'star-half' : 'star-outline';
        return <View key={star} style={[styles.star, { width: size + 8, height: size + 10 }]}>
          <Ionicons name={iconName} size={size} color={normalized >= star - 0.5 ? colors.tortilla : colors.textTertiary} />
          {!readOnly ? <>
            <Pressable accessibilityRole="button" accessibilityLabel={`${accessibilityLabel}: ${(star - 0.5).toFixed(1)} de 5`} onPress={() => onChange?.(star - 0.5)} style={styles.leftHalf} />
            <Pressable accessibilityRole="button" accessibilityLabel={`${accessibilityLabel}: ${star.toFixed(1)} de 5`} onPress={() => onChange?.(star)} style={styles.rightHalf} />
          </> : null}
        </View>;
      })}
    </View>
    {showValue ? <Text style={styles.value}>{valueLabel}</Text> : null}
  </View>;
}

const styles = StyleSheet.create({
  wrapper: { alignItems: 'flex-start' },
  row: { flexDirection: 'row', alignItems: 'center' },
  star: { alignItems: 'center', justifyContent: 'center', position: 'relative' },
  leftHalf: { position: 'absolute', left: 0, top: 0, bottom: 0, width: '50%' },
  rightHalf: { position: 'absolute', right: 0, top: 0, bottom: 0, width: '50%' },
  zero: { minWidth: 28, height: 28, borderRadius: 14, borderWidth: 1, borderColor: colors.border, alignItems: 'center', justifyContent: 'center', marginRight: 4 },
  zeroActive: { backgroundColor: colors.surfaceElevated, borderColor: colors.tortilla },
  zeroText: { color: colors.textSecondary, fontFamily: typography.fontFamily.semibold, fontSize: 11, fontWeight: typography.weight.semibold },
  zeroTextActive: { color: colors.tortilla },
  value: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium, marginTop: 3 }
});
