import { Share, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import * as Linking from 'expo-linking';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { diary as diaryRequest } from '@/lib/api';
import { diaryEntries } from '@/data/fixtures';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';

export default function WrappedScreen() {
  const { token, loading: authLoading } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['diary', 'wrapped', token], queryFn: () => diaryRequest(token!), enabled: Boolean(token) });
  const entries = data?.entries ?? (token ? [] : diaryEntries.map((entry) => ({ id: entry.id, rating: entry.rating, place_name: entry.place, neighborhood: 'CDMX', tacos: entry.taco })));
  const tacos = entries.flatMap((entry) => entry.tacos.split(',').map((taco) => taco.trim()).filter(Boolean));
  const average = entries.length ? (entries.reduce((sum, entry) => sum + Number(entry.rating), 0) / entries.length).toFixed(2) : '—';
  const best = entries.reduce<typeof entries[number] | undefined>((winner, entry) => !winner || Number(entry.rating) > Number(winner.rating) ? entry : winner, undefined);
  const neighborhoods = new Set(entries.map((entry) => entry.neighborhood).filter(Boolean));
  const wrappedYear = new Date().getFullYear();

  async function share() {
    try { await Share.share({ message: `Mi año en tacos: ${tacos.length} tacos, ${entries.length} visitas y promedio ${average}. Mi favorito: ${best?.place_name ?? 'todavía por descubrir'}.\n${Linking.createURL('/wrapped')}` }); } catch { /* Sharing is optional on platforms without a native share sheet. */ }
  }

  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando tu resumen…</Text></View>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={20} color={colors.ink} /></Pressable><View><Text style={styles.eyebrow}>MEMORIA GASTRONÓMICA</Text><Text style={styles.title}>Tu año en tacos</Text></View></View>
      <View style={styles.hero}><Text style={styles.heroKicker}>TACOS WRAPPED · {wrappedYear}</Text><Text style={styles.heroTitle}>{isLoading ? 'Cargando…' : entries.length ? 'Una ciudad entera en tu memoria.' : 'Tu historia está por empezar.'}</Text><Text style={styles.heroCopy}>{entries.length ? 'Un resumen de los lugares, tacos y decisiones que definieron tu año.' : 'Registra tu primera visita y vuelve aquí para ver cómo evoluciona tu gusto.'}</Text><View style={styles.heroMark}><Ionicons name="flame" size={26} color={colors.background} /></View></View>
      <View style={styles.grid}><Metric label="TACOS" value={String(tacos.length)} icon="restaurant-outline" /><Metric label="VISITAS" value={String(entries.length)} icon="location-outline" /><Metric label="PROMEDIO" value={average} icon="star-outline" /><Metric label="ZONAS" value={String(neighborhoods.size)} icon="map-outline" /></View>
      <View style={styles.feature}><Text style={styles.featureEyebrow}>TU MOMENTO CUMBRE</Text><Text style={styles.featureTitle}>{best?.place_name ?? 'Todavía no hay un favorito'}</Text><Text style={styles.featureCopy}>{best ? `${best.tacos} · ${Number(best.rating).toFixed(2)} de rating` : 'Tu mejor taco aparecerá aquí después de registrarlo.'}</Text></View>
      <Pressable style={styles.share} onPress={() => void share()}><Ionicons name="share-outline" size={18} color={colors.background} /><Text style={styles.shareText}>Compartir mi resumen</Text></Pressable>
      {!entries.length && <Pressable style={styles.secondary} onPress={() => router.push('/register')}><Text style={styles.secondaryText}>Registrar mi primer taco</Text><Ionicons name="arrow-forward" size={17} color={colors.accent} /></Pressable>}
    </ScrollView>
  );
}

function Metric({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) {
  return <View style={styles.metric}><Ionicons name={icon} size={17} color={colors.accent} /><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  muted: { color: colors.muted, fontSize: 13 },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: spacing.xl },
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 27, fontWeight: '900', letterSpacing: -0.8, marginTop: 3 },
  hero: { backgroundColor: colors.accent, borderRadius: radii.lg, padding: spacing.lg, minHeight: 230, overflow: 'hidden', position: 'relative', marginBottom: spacing.lg },
  heroKicker: { color: colors.background, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  heroTitle: { color: colors.background, fontSize: 31, lineHeight: 33, fontWeight: '900', letterSpacing: -1.1, maxWidth: 280, marginTop: 20 },
  heroCopy: { color: colors.background, opacity: 0.72, fontSize: 13, lineHeight: 19, maxWidth: 280, marginTop: 13 },
  heroMark: { position: 'absolute', right: 20, bottom: 20, width: 58, height: 58, borderRadius: 29, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '12deg' }] },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  metric: { width: '48%', minHeight: 110, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  metricValue: { color: colors.ink, fontSize: 28, fontWeight: '900', marginTop: 17 },
  metricLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.2, marginTop: 3 },
  feature: { backgroundColor: colors.surfaceRaised, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.lg },
  featureEyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  featureTitle: { color: colors.ink, fontSize: 22, fontWeight: '900', marginTop: 14 },
  featureCopy: { color: colors.muted, fontSize: 12, marginTop: 5 },
  share: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: colors.accent, borderRadius: radii.md, minHeight: 53 },
  shareText: { color: colors.background, fontSize: 14, fontWeight: '900' },
  secondary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: spacing.md, minHeight: 48, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md },
  secondaryText: { color: colors.accent, fontSize: 13, fontWeight: '900' },
});
