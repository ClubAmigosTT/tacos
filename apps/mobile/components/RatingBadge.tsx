import { StyleSheet, Text, View } from 'react-native';
import { colors, radii, typography } from '@/theme';

export function RatingBadge({ rating, accent = false }: { rating: number; accent?: boolean }) {
  const label = Number.isFinite(rating) && rating > 0 ? rating.toFixed(2) : '—';
  return (
    <View style={[styles.badge, accent && styles.accentBadge]}>
      <Text style={[styles.text, accent && styles.accentText]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: colors.surfaceElevated, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 6 },
  accentBadge: { backgroundColor: colors.tortilla },
  text: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold, letterSpacing: -0.2 },
  accentText: { color: colors.meatDark }
});
