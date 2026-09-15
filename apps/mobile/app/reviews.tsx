import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { diary as diaryRequest, isDemoMode } from '@/lib/api';
import { diaryEntries } from '@/data/fixtures';
import { useAuth } from '@/lib/auth';
import { RatingBadge } from '@/components/RatingBadge';
import { colors, radii, spacing, typography } from '@/theme';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { CatalogImage } from '@/components/CatalogImage';

type ReviewEntry = { id: string; visited_at?: string; rating: number; note?: string; place_name: string; neighborhood: string; tacos: string; image_url: string };

export default function ReviewsScreen() {
  const { token, loading: authLoading } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['diary', 'reviews', token], queryFn: () => diaryRequest(token!), enabled: Boolean(token && !authLoading) });
  const entries: ReviewEntry[] = data?.entries ?? (token || !isDemoMode() ? [] : diaryEntries.map((entry) => ({ id: entry.id, rating: entry.rating, note: entry.rating >= 4.8 ? 'Volvería por otro; gran textura y salsa.' : 'Buena información para mi futuro yo.', place_name: entry.place, neighborhood: 'CDMX', tacos: entry.taco, image_url: entry.image })));
  const average = entries.length ? (entries.reduce((sum, entry) => sum + Number(entry.rating), 0) / entries.length).toFixed(2) : '—';
  const renderReview = useCallback(({ item }: { item: ReviewEntry }) => <ReviewCard entry={item} editable={Boolean(token)} />, [token]);

  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando tus reviews…</Text></View>;
  if (token && isError) return <AsyncErrorState title="No pudimos cargar tus reviews" detail="Tus ratings siguen guardados. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  const header = <View>
    <View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={20} color={colors.textPrimary} /></Pressable><View><Text style={styles.eyebrow}>TU VOZ</Text><Text style={styles.title}>Reviews</Text></View><Ionicons name="chatbubble-ellipses-outline" size={21} color={colors.tortilla} /></View>
    <View style={styles.intro}><View style={styles.introIcon}><Ionicons name="star" size={18} color={colors.background} /></View><View style={styles.introCopy}><Text style={styles.introTitle}>{isLoading ? 'Calculando…' : `${entries.length} reseña${entries.length === 1 ? '' : 's'} en tu diario`}</Text><Text style={styles.introText}>{entries.length ? `Tu promedio actual es ${average}. Cada nota ayuda a construir tu criterio.` : 'Registra una visita para dejar la primera señal de tu gusto.'}</Text></View></View>
  </View>;
  return <FlatList data={entries} keyExtractor={(entry) => entry.id} renderItem={renderReview} style={styles.screen} contentContainerStyle={styles.content} ListHeaderComponent={header} ListEmptyComponent={<EmptyReviews token={Boolean(token)} />} showsVerticalScrollIndicator={false} />;
}

function ReviewCard({ entry, editable }: { entry: ReviewEntry; editable: boolean }) {
  return <Pressable style={styles.review} disabled={!editable} onPress={() => router.push({ pathname: '/visit-edit', params: { id: entry.id } })}><CatalogImage uri={entry.image_url} accessibilityLabel={`Imagen de ${entry.place_name}`} style={styles.image} /><View style={styles.reviewCopy}><View style={styles.reviewTop}><RatingBadge rating={Number(entry.rating)} accent /><Text style={styles.date}>{formatDate(entry.visited_at)}</Text></View><Text style={styles.place}>{entry.place_name}</Text><Text style={styles.tacos}>{entry.tacos}</Text>{entry.note ? <Text style={styles.note}>“{entry.note}”</Text> : null}{editable ? <View style={styles.editHint}><Text style={styles.editText}>Editar review</Text><Ionicons name="chevron-forward" size={13} color={colors.textTertiary} /></View> : null}</View></Pressable>;
}

function EmptyReviews({ token }: { token: boolean }) {
  return <View style={styles.empty}><Ionicons name="chatbubble-outline" size={28} color={colors.textTertiary} /><Text style={styles.emptyTitle}>Todavía no hay reviews</Text><Text style={styles.muted}>Registra una visita y escribe una nota para tu futuro yo.</Text><Pressable style={styles.cta} onPress={() => router.push(token ? '/register' : '/auth')}><Text style={styles.ctaText}>{token ? 'Registrar mi primer taco' : 'Entra para empezar'}</Text><Ionicons name="arrow-forward" size={18} color={colors.background} /></Pressable></View>;
}

function formatDate(value?: string) {
  if (!value) return 'DEMO';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }).replace('.', '').toUpperCase() : '—';
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  muted: { color: colors.textSecondary, fontSize: 13, fontFamily: typography.fontFamily.regular, lineHeight: 19 },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: spacing.xl },
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  eyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.5 },
  title: { color: colors.textPrimary, fontSize: 28, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: -0.8, marginTop: 3 },
  intro: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.xl },
  introIcon: { width: 36, height: 36, borderRadius: 18, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center' },
  introCopy: { flex: 1 },
  introTitle: { color: colors.textPrimary, fontSize: 14, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  introText: { color: colors.textSecondary, fontSize: 11, fontFamily: typography.fontFamily.regular, lineHeight: 16, marginTop: 3 },
  list: { gap: spacing.md },
  review: { flexDirection: 'row', minHeight: 138, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  image: { width: 112, height: '100%', backgroundColor: colors.surfaceRaised },
  reviewCopy: { flex: 1, padding: spacing.md },
  reviewTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  date: { color: colors.textTertiary, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 0.7 },
  place: { color: colors.textPrimary, fontSize: 15, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: 12 },
  tacos: { color: colors.salsa, fontSize: 11, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold, marginTop: 3 },
  note: { color: colors.textSecondary, fontSize: 11, fontFamily: typography.fontFamily.regular, lineHeight: 16, marginTop: 10 },
  editHint: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 9 },
  editText: { color: colors.textTertiary, fontSize: 9, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold },
  empty: { alignItems: 'center', backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.xl, gap: 9 },
  emptyTitle: { color: colors.textPrimary, fontSize: 15, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  cta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.tortilla, borderRadius: radii.md, padding: spacing.lg, marginTop: spacing.lg },
  ctaText: { color: colors.background, fontSize: 14, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
});
