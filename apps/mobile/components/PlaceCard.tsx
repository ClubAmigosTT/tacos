import { StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, spacing, typography } from '@/theme';
import { RatingBadge } from './RatingBadge';
import { TacoCard } from './DesignSystem';
import { CatalogImage } from './CatalogImage';
import type { Place } from '@/data/fixtures';

export function PlaceCard({ place, compact = false }: { place: Place; compact?: boolean }) {
  const ratingLabel = place.rating > 0 ? place.rating.toFixed(2) : 'sin calificación';
  const matchLabel = place.match != null ? `${place.match}% para ti` : 'Afinidad aún no disponible';
  return (
    <TacoCard accessibilityLabel={`Abrir ${place.name}, ${ratingLabel}, ${matchLabel}`} style={[styles.card, compact && styles.compact]} onPress={() => router.push(`/place/${place.id}`)}>
      <CatalogImage uri={place.image} accessibilityLabel={`Imagen de ${place.name}`} style={[styles.image, compact && styles.compactImage]} />
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{place.name}</Text>
          <RatingBadge rating={place.rating} />
        </View>
        <Text style={styles.meta}>{place.neighborhood} · {place.distance}</Text>
        <View style={styles.bottomRow}>
          <Text style={styles.style}>{place.style}</Text>
          <Text style={styles.match}>{matchLabel}</Text>
        </View>
      </View>
    </TacoCard>
  );
}

const styles = StyleSheet.create({
  card: { padding: 0, overflow: 'hidden', width: 285, marginRight: spacing.md },
  compact: { width: '100%', flexDirection: 'row', marginRight: 0, marginBottom: spacing.sm, height: 92 },
  image: { width: '100%', height: 148, backgroundColor: colors.surfaceRaised },
  compactImage: { width: 92, height: 92 },
  content: { padding: spacing.md, flex: 1, justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 17, fontWeight: typography.weight.semibold, flex: 1, letterSpacing: -0.3 },
  meta: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 12, marginTop: 5 },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 13 },
  style: { color: colors.salsa, fontFamily: typography.fontFamily.medium, fontSize: 12, fontWeight: typography.weight.medium },
  match: { color: colors.cilantroLight, fontFamily: typography.fontFamily.semibold, fontSize: 11, fontWeight: typography.weight.semibold }
});
