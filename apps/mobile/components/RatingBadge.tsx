import { StyleSheet, Text, View } from 'react-native';
import { colors, radii } from '@/theme';

export function RatingBadge({ rating, accent = false }: { rating: number; accent?: boolean }) {
  return (
    <View style={[styles.badge, accent && styles.accentBadge]}>
      <Text style={[styles.text, accent && styles.accentText]}>{rating.toFixed(2)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: { backgroundColor: colors.surfaceRaised, borderRadius: radii.pill, paddingHorizontal: 9, paddingVertical: 5 },
  accentBadge: { backgroundColor: colors.accent },
  text: { color: colors.ink, fontSize: 12, fontWeight: '800', letterSpacing: -0.2 },
  accentText: { color: colors.background }
});
