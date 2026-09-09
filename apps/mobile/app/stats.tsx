import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { diary as diaryRequest } from '@/lib/api';
import { diaryEntries } from '@/data/fixtures';
import { useAuth } from '@/lib/auth';
import { colors, radii, spacing } from '@/theme';

type StatsEntry = { visited_at?: string; rating: number; price?: number | null; place_name: string; neighborhood: string; tacos: string };

const monthFormatter = new Intl.DateTimeFormat('es-MX', { month: 'short' });

export default function StatsScreen() {
  const { token, loading: authLoading } = useAuth();
  const { data, isLoading } = useQuery({ queryKey: ['diary', 'stats', token], queryFn: () => diaryRequest(token!), enabled: Boolean(token) });
  const sourceEntries: StatsEntry[] = data?.entries ?? (token ? [] : diaryEntries.map((entry) => ({ rating: entry.rating, place_name: entry.place, neighborhood: 'CDMX', tacos: entry.taco, price: null })));
  const entries = sourceEntries;
  const tacoNames = entries.flatMap((entry) => entry.tacos.split(',').map((taco) => taco.trim()).filter(Boolean));
  const average = entries.length ? (entries.reduce((sum, entry) => sum + Number(entry.rating), 0) / entries.length).toFixed(2) : '—';
  const spent = entries.reduce((sum, entry) => sum + (Number.isFinite(Number(entry.price)) ? Number(entry.price) : 0), 0);
  const pricedVisits = entries.filter((entry) => Number.isFinite(Number(entry.price)) && entry.price != null).length;
  const neighborhoods = new Map<string, number>();
  const tacos = new Map<string, number>();
  for (const entry of entries) {
    if (entry.neighborhood) neighborhoods.set(entry.neighborhood, (neighborhoods.get(entry.neighborhood) ?? 0) + 1);
    for (const taco of entry.tacos.split(',').map((item) => item.trim()).filter(Boolean)) tacos.set(taco, (tacos.get(taco) ?? 0) + 1);
  }
  const topNeighborhood = [...neighborhoods.entries()].sort((a, b) => b[1] - a[1])[0];
  const topTacos = [...tacos.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 4);
  const now = new Date();
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - (5 - index), 1);
    const count = entries.filter((entry) => {
      if (!entry.visited_at) return index === 5;
      const visitedAt = new Date(entry.visited_at);
      return Number.isFinite(visitedAt.getTime()) && visitedAt.getFullYear() === date.getFullYear() && visitedAt.getMonth() === date.getMonth();
    }).length;
    return { label: monthFormatter.format(date).replace('.', '').toUpperCase(), count };
  });
  const maxMonth = Math.max(...months.map((month) => month.count), 1);

  if (authLoading) return <View style={styles.center}><Text style={styles.muted}>Cargando tus estadísticas…</Text></View>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}><Pressable style={styles.back} onPress={() => router.back()}><Ionicons name="arrow-back" size={20} color={colors.ink} /></Pressable><View><Text style={styles.eyebrow}>TU GUSTO</Text><Text style={styles.title}>Estadísticas</Text></View><Ionicons name="stats-chart-outline" size={21} color={colors.accent} /></View>
      <View style={styles.hero}><View style={styles.heroMark}><Ionicons name="sparkles-outline" size={20} color={colors.background} /></View><Text style={styles.heroEyebrow}>TU FIRMA HASTA AHORA</Text><Text style={styles.heroTitle}>{isLoading ? 'Calculando…' : entries.length ? `${tacoNames.length} tacos que ya cuentan una historia.` : 'Tu historia está por empezar.'}</Text><Text style={styles.heroCopy}>{entries.length ? 'Tus decisiones de mesa, convertidas en una lectura rápida de cómo comes la ciudad.' : 'Registra una visita para empezar a construir tus patrones.'}</Text></View>

      <View style={styles.grid}><Metric label="VISITAS" value={String(entries.length)} icon="location-outline" /><Metric label="TACOS" value={String(tacoNames.length)} icon="restaurant-outline" /><Metric label="PROMEDIO" value={average} icon="star-outline" /><Metric label="ZONAS" value={String(neighborhoods.size)} icon="map-outline" /></View>

      <SectionTitle title="Tu ritmo" eyebrow="ÚLTIMOS 6 MESES" />
      <View style={styles.chart}><View style={styles.bars}>{months.map((month) => <View key={month.label} style={styles.barColumn}><Text style={styles.barValue}>{month.count || ''}</Text><View style={styles.barTrack}><View style={[styles.barFill, { height: `${Math.max(8, Math.round((month.count / maxMonth) * 100))}%` }]} /></View><Text style={styles.barLabel}>{month.label}</Text></View>)}</View><Text style={styles.chartHint}>{entries.length ? 'Cada barra representa visitas registradas en ese mes.' : 'Cuando registres visitas, aquí verás tu ritmo de exploración.'}</Text></View>

      <SectionTitle title="Lo que más pides" eyebrow="TUS TACOS RECURRENTES" />
      <View style={styles.card}>{topTacos.length ? topTacos.map(([name, count], index) => <View key={name} style={[styles.row, index < topTacos.length - 1 && styles.rowBorder]}><View style={styles.rank}><Text style={styles.rankText}>{String(index + 1).padStart(2, '0')}</Text></View><Text style={styles.rowName}>{name}</Text><Text style={styles.rowValue}>{count} {count === 1 ? 'vez' : 'veces'}</Text></View>) : <Text style={styles.muted}>Todavía no hay suficientes registros para encontrar un patrón.</Text>}</View>

      <SectionTitle title="Tus señales" eyebrow="LECTURA RÁPIDA" />
      <View style={styles.signalGrid}><View style={styles.signal}><Text style={styles.signalLabel}>ZONA DE CULTO</Text><Text style={styles.signalValue}>{topNeighborhood?.[0] ?? '—'}</Text><Text style={styles.signalCopy}>{topNeighborhood ? `${topNeighborhood[1]} visita${topNeighborhood[1] === 1 ? '' : 's'}` : 'Aún por descubrir'}</Text></View><View style={styles.signal}><Text style={styles.signalLabel}>GASTO REGISTRADO</Text><Text style={styles.signalValue}>{pricedVisits ? `$${spent.toFixed(0)}` : '—'}</Text><Text style={styles.signalCopy}>{pricedVisits ? `${pricedVisits} visita${pricedVisits === 1 ? '' : 's'} con precio` : 'Añade precios al registrar'}</Text></View></View>

      {!entries.length && <Pressable style={styles.cta} onPress={() => router.push('/register')}><Text style={styles.ctaTitle}>{token ? 'Registrar mi primer taco' : 'Entra para guardar tu gusto'}</Text><Text style={styles.ctaCopy}>{token ? 'Tu próxima visita aparecerá aquí.' : 'Crea tu identidad y conserva tus estadísticas.'}</Text><Ionicons name="arrow-forward" size={19} color={colors.background} /></Pressable>}
    </ScrollView>
  );
}

function SectionTitle({ eyebrow, title }: { eyebrow: string; title: string }) {
  return <View style={styles.sectionHeader}><Text style={styles.sectionEyebrow}>{eyebrow}</Text><Text style={styles.sectionTitle}>{title}</Text></View>;
}

function Metric({ label, value, icon }: { label: string; value: string; icon: keyof typeof Ionicons.glyphMap }) {
  return <View style={styles.metric}><Ionicons name={icon} size={16} color={colors.accent} /><Text style={styles.metricValue}>{value}</Text><Text style={styles.metricLabel}>{label}</Text></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  muted: { color: colors.muted, fontSize: 13, lineHeight: 19 },
  content: { padding: spacing.lg, paddingTop: 58, paddingBottom: 110 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: spacing.xl },
  back: { width: 38, height: 38, borderRadius: 19, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.border },
  eyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  title: { color: colors.ink, fontSize: 28, fontWeight: '900', letterSpacing: -0.8, marginTop: 3 },
  hero: { backgroundColor: colors.accent, borderRadius: radii.lg, padding: spacing.lg, minHeight: 205, position: 'relative', overflow: 'hidden', marginBottom: spacing.lg },
  heroMark: { position: 'absolute', top: 18, right: 18, width: 40, height: 40, borderRadius: 20, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', transform: [{ rotate: '10deg' }] },
  heroEyebrow: { color: colors.background, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  heroTitle: { color: colors.background, fontSize: 27, lineHeight: 30, fontWeight: '900', letterSpacing: -0.8, maxWidth: 285, marginTop: 22 },
  heroCopy: { color: colors.background, opacity: 0.72, fontSize: 12, lineHeight: 18, maxWidth: 285, marginTop: 12 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.xl },
  metric: { width: '48%', minHeight: 95, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md },
  metricValue: { color: colors.ink, fontSize: 25, fontWeight: '900', marginTop: 13 },
  metricLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.1, marginTop: 3 },
  sectionHeader: { marginBottom: spacing.md, marginTop: spacing.sm },
  sectionEyebrow: { color: colors.accent, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  sectionTitle: { color: colors.ink, fontSize: 21, fontWeight: '900', letterSpacing: -0.4, marginTop: 4 },
  chart: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.md, marginBottom: spacing.xl },
  bars: { height: 145, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8 },
  barColumn: { flex: 1, height: '100%', alignItems: 'center', justifyContent: 'flex-end', gap: 6 },
  barValue: { color: colors.accent, fontSize: 10, fontWeight: '900', height: 13 },
  barTrack: { width: '100%', height: 102, backgroundColor: colors.surfaceRaised, borderRadius: 7, justifyContent: 'flex-end', overflow: 'hidden' },
  barFill: { width: '100%', backgroundColor: colors.accent, borderRadius: 7 },
  barLabel: { color: colors.muted, fontSize: 9, fontWeight: '900' },
  chartHint: { color: colors.dim, fontSize: 10, marginTop: 15 },
  card: { backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, paddingHorizontal: spacing.md, marginBottom: spacing.xl },
  row: { minHeight: 58, flexDirection: 'row', alignItems: 'center', gap: 11 },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rank: { width: 30, height: 30, borderRadius: 9, backgroundColor: colors.surfaceRaised, alignItems: 'center', justifyContent: 'center' },
  rankText: { color: colors.accent, fontSize: 10, fontWeight: '900' },
  rowName: { color: colors.ink, fontSize: 14, fontWeight: '900', flex: 1 },
  rowValue: { color: colors.muted, fontSize: 11, fontWeight: '700' },
  signalGrid: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xl },
  signal: { flex: 1, minHeight: 112, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md },
  signalLabel: { color: colors.accent, fontSize: 8, fontWeight: '900', letterSpacing: 1.1 },
  signalValue: { color: colors.ink, fontSize: 20, fontWeight: '900', marginTop: 18 },
  signalCopy: { color: colors.muted, fontSize: 10, marginTop: 4 },
  cta: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.accent, borderRadius: radii.md, padding: spacing.lg },
  ctaTitle: { color: colors.background, fontSize: 14, fontWeight: '900', flex: 1 },
  ctaCopy: { position: 'absolute', left: spacing.lg, bottom: 10, color: colors.background, opacity: 0.72, fontSize: 10 },
});
