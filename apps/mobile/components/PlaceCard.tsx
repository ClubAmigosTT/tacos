import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { colors, radii, spacing } from '@/theme';
import { RatingBadge } from './RatingBadge';
import type { Place } from '@/data/fixtures';

export function PlaceCard({ place, compact = false }: { place: Place; compact?: boolean }) {
  return (
    <Pressable style={({ pressed }) => [styles.card, compact && styles.compact, pressed && styles.pressed]} onPress={() => router.push(`/place/${place.id}`)}>
      <Image source={{ uri: place.image }} style={[styles.image, compact && styles.compactImage]} />
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Text style={styles.title} numberOfLines={1}>{place.name}</Text>
          <RatingBadge rating={place.rating} />
        </View>
        <Text style={styles.meta}>{place.neighborhood} · {place.distance}</Text>
        <View style={styles.bottomRow}>
          <Text style={styles.style}>{place.style}</Text>
          <Text style={styles.match}>{place.match}% para ti</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: colors.surface, borderRadius: radii.md, overflow: 'hidden', width: 285, marginRight: spacing.md, borderWidth: 1, borderColor: colors.border },
  compact: { width: '100%', flexDirection: 'row', marginRight: 0, marginBottom: spacing.sm, height: 92 },
  pressed: { opacity: 0.82, transform: [{ scale: 0.985 }] },
  image: { width: '100%', height: 148, backgroundColor: colors.surfaceRaised },
  compactImage: { width: 92, height: 92 },
  content: { padding: spacing.md, flex: 1, justifyContent: 'space-between' },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  title: { color: colors.ink, fontSize: 17, fontWeight: '800', flex: 1, letterSpacing: -0.3 },
  meta: { color: colors.muted, fontSize: 12, marginTop: 5 },
  bottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 13 },
  style: { color: colors.warm, fontSize: 12, fontWeight: '700' },
  match: { color: colors.accent, fontSize: 11, fontWeight: '800' }
});
