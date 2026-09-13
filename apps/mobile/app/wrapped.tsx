import { Share, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { diary as diaryRequest, isDemoMode } from '@/lib/api';
import { diaryEntries } from '@/data/fixtures';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing, typography } from '@/theme';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { MetricTile } from '@/components/DesignSystem';

type WrappedEntry = { id: string; rating: number; price?: number | null; place_name: string; neighborhood: string; tacos: string; visited_at?: string; latitude?: number | null; longitude?: number | null };

export default function WrappedScreen() {
  const { token, loading: authLoading } = useAuth();
  const { data, isLoading, isError, refetch } = useQuery({ queryKey: ['diary', 'wrapped', token], queryFn: () => diaryRequest(token!), enabled: Boolean(token && !authLoading) });
  const wrappedYear = new Date().getFullYear();
  const sourceEntries: WrappedEntry[] = data?.entries ?? (token || !isDemoMode() ? [] : diaryEntries.map((entry) => ({ id: entry.id, rating: entry.rating, place_name: entry.place, neighborhood: 'CDMX', tacos: entry.taco })));
  // Wrapped is an annual recap: use the visit's actual calendar year rather
  // than showing the complete lifetime diary under a current-year heading.
  const entries = data
    ? sourceEntries.filter((entry) => {
      const visitedAt = entry.visited_at ? Date.parse(entry.visited_at) : Number.NaN;
      return Number.isFinite(visitedAt) && new Date(visitedAt).getFullYear() === wrappedYear;
    })
    : sourceEntries;
  const tacos = entries.flatMap((entry) => entry.tacos.split(',').map((taco) => taco.trim()).filter(Boolean));
  const average = entries.length ? (entries.reduce((sum, entry) => sum + Number(entry.rating), 0) / entries.length).toFixed(2) : '—';
  const best = entries.reduce<WrappedEntry | undefined>((winner, entry) => !winner || Number(entry.rating) > Number(winner.rating) ? entry : winner, undefined);
  const neighborhoods = new Set(entries.map((entry) => entry.neighborhood).filter(Boolean));
  const spent = entries.reduce((sum, entry) => sum + (entry.price == null || !Number.isFinite(Number(entry.price)) ? 0 : Number(entry.price)), 0);
  const pricedVisits = entries.filter((entry) => entry.price != null && Number.isFinite(Number(entry.price))).length;
  const favoriteNeighborhood = [...entries.reduce((counts, entry) => counts.set(entry.neighborhood, (counts.get(entry.neighborhood) ?? 0) + 1), new Map<string, number>()).entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0];
  const favoriteHour = [...entries.reduce((counts, entry) => {
    const date = entry.visited_at ? new Date(entry.visited_at) : undefined;
    if (date && Number.isFinite(date.getTime())) counts.set(date.getHours(), (counts.get(date.getHours()) ?? 0) + 1);
    return counts;
  }, new Map<number, number>()).entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  const routePoints = entries.map((entry) => ({ latitude: Number(entry.latitude), longitude: Number(entry.longitude), at: entry.visited_at ? Date.parse(entry.visited_at) : Number.NaN })).filter((point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && Number.isFinite(point.at)).sort((a, b) => a.at - b.at);
  const kilometers = routePoints.slice(1).reduce((total, point, index) => total + distanceKm(routePoints[index], point), 0);

  async function share() {
    try { await Share.share({ message: `Mi año en tacos: ${tacos.length} tacos, ${entries.length} visitas, ${kilometers.toFixed(1)} km y promedio ${average}. Mi favorito: ${best?.place_name ?? 'todavía por descubrir'}.\n${Linking.createURL('/wrapped')}` }); } catch { /* Sharing is optional on platforms without a native share sheet. */ }
  }

  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando tu resumen…</Text></View>;
  if (token && isError) return <AsyncErrorState title="No pudimos armar tu resumen" detail="Tu diario sigue intacto. Comprueba la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={20} color={colors.textPrimary} /></Pressable><View><Text style={styles.eyebrow}>MEMORIA GASTRONÓMICA</Text><Text style={styles.title}>Tu año en tacos</Text></View></View>
      <View style={styles.hero}><Text style={styles.heroKicker}>TACOS WRAPPED · {wrappedYear}</Text><Text style={styles.heroTitle}>{isLoading ? 'Cargando…' : entries.length ? 'Una ciudad entera en tu memoria.' : 'Tu historia está por empezar.'}</Text><Text style={styles.heroCopy}>{entries.length ? 'Un resumen de los lugares, tacos y decisiones que definieron tu año.' : 'Registra tu primera visita y vuelve aquí para ver cómo evoluciona tu gusto.'}</Text><View style={styles.heroMark}><Ionicons name="flame" size={26} color={colors.background} /></View></View>
      <View style={styles.grid}><MetricTile label="tacos" value={String(tacos.length)} icon="restaurant-outline" style={styles.metric} /><MetricTile label="visitas" value={String(entries.length)} icon="location-outline" style={styles.metric} /><MetricTile label="promedio" value={average} icon="star-outline" style={styles.metric} /><MetricTile label="zonas" value={String(neighborhoods.size)} icon="map-outline" style={styles.metric} /></View>
      <View style={styles.feature}><Text style={styles.featureEyebrow}>TU MOMENTO CUMBRE</Text><Text style={styles.featureTitle}>{best?.place_name ?? 'Todavía no hay un favorito'}</Text><Text style={styles.featureCopy}>{best ? `${best.tacos} · ${Number(best.rating).toFixed(2)} de rating` : 'Tu mejor taco aparecerá aquí después de registrarlo.'}</Text></View>
      <View style={styles.signalGrid}><View style={styles.signal}><Text style={styles.signalLabel}>ZONA DE CULTO</Text><Text style={styles.signalValue}>{favoriteNeighborhood ?? '—'}</Text><Text style={styles.signalCopy}>{favoriteNeighborhood ? 'Tu colonia más visitada' : 'Aún por descubrir'}</Text></View><View style={styles.signal}><Text style={styles.signalLabel}>HORA FIRMA</Text><Text style={styles.signalValue}>{favoriteHour == null ? '—' : `${String(favoriteHour).padStart(2, '0')}:00`}</Text><Text style={styles.signalCopy}>{favoriteHour == null ? 'Registra más visitas' : 'Tu hora más frecuente'}</Text></View></View>
      <View style={styles.routeCard}><View style={styles.routeTop}><View><Text style={styles.featureEyebrow}>RUTA ACUMULADA</Text><Text style={styles.routeTitle}>{kilometers.toFixed(1)} km</Text></View><Ionicons name="navigate-outline" size={24} color={colors.tortilla} /></View><Text style={styles.routeCopy}>{pricedVisits ? `También registraste $${spent.toFixed(0)} MXN en ${pricedVisits} visita${pricedVisits === 1 ? '' : 's'}.` : 'Añade precios al registrar para estimar tu gasto.'}</Text></View>
      <Pressable accessibilityRole="button" accessibilityLabel="Compartir mi resumen anual" style={styles.share} onPress={() => void share()}><Ionicons name="share-outline" size={18} color={colors.background} /><Text style={styles.shareText}>Compartir mi resumen</Text></Pressable>
      {!entries.length && <Pressable style={styles.secondary} onPress={() => router.push('/register')}><Text style={styles.secondaryText}>Registrar mi primer taco</Text><Ionicons name="arrow-forward" size={17} color={colors.tortilla} /></Pressable>}
    </ScrollView>
  );
}

function distanceKm(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const radius = 6371;
  const latitudeDelta = (to.latitude - from.latitude) * Math.PI / 180;
  const longitudeDelta = (to.longitude - from.longitude) * Math.PI / 180;
  const latitudeA = from.latitude * Math.PI / 180;
  const latitudeB = to.latitude * Math.PI / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  muted: { color: colors.textSecondary, fontSize: 13 },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: spacing.xl },
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  eyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.5 },
  title: { color: colors.textPrimary, fontSize: 27, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: -0.8, marginTop: 3 },
  hero: { backgroundColor: colors.tortilla, borderRadius: radii.lg, padding: spacing.lg, minHeight: 230, overflow: 'hidden', position: 'relative', marginBottom: spacing.lg },
  heroKicker: { color: colors.background, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.5 },
  heroTitle: { color: colors.background, fontSize: 31, fontFamily: typography.fontFamily.bold, lineHeight: 33, fontWeight: typography.weight.bold, letterSpacing: -1.1, maxWidth: 280, marginTop: 20 },
  heroCopy: { color: colors.background, opacity: 0.72, fontSize: 13, fontFamily: typography.fontFamily.regular, lineHeight: 19, maxWidth: 280, marginTop: 13 },
  heroMark: { position: 'absolute', right: 20, bottom: 20, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '12deg' }] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  metric: { width: '48%', minHeight: 110, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  feature: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  featureEyebrow: { color: colors.tortilla, fontSize: 9, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.4 },
  featureTitle: { color: colors.textPrimary, fontSize: 22, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: 14 },
  featureCopy: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.fontFamily.regular, marginTop: 5 },
  signalGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  signal: { flex: 1, minHeight: 112, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md },
  signalLabel: { color: colors.tortilla, fontSize: 8, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, letterSpacing: 1.1 },
  signalValue: { color: colors.textPrimary, fontSize: 20, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: 18 },
  signalCopy: { color: colors.textSecondary, fontSize: 10, fontFamily: typography.fontFamily.regular, marginTop: 4 },
  routeCard: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  routeTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  routeTitle: { color: colors.textPrimary, fontSize: 27, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold, marginTop: 8 },
  routeCopy: { color: colors.textSecondary, fontSize: 12, fontFamily: typography.fontFamily.regular, lineHeight: 18, marginTop: 13 },
  share: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.tortilla, borderRadius: radii.md, minHeight: 53 },
  shareText: { color: colors.background, fontSize: 14, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
  secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.md, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md },
  secondaryText: { color: colors.tortilla, fontSize: 13, fontFamily: typography.fontFamily.bold, fontWeight: typography.weight.bold },
});
