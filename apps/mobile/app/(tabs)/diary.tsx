import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { diaryEntries } from '@/data/fixtures';
import { diary as diaryRequest } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@tanstack/react-query';
import { colors, radii, spacing } from '@/theme';
import { RatingBadge } from '@/components/RatingBadge';
import { SectionTitle } from '@/components/SectionTitle';
import { AsyncErrorState } from '@/components/AsyncErrorState';

export default function DiaryScreen() {
  const { token, loading } = useAuth();
  const { data, isError, refetch } = useQuery({ queryKey: ['diary', token], queryFn: () => diaryRequest(token!), enabled: Boolean(token) });
  if (loading) return <View style={styles.loading}><Text style={styles.loadingText}>Cargando tu historia…</Text></View>;
  if (token && isError) return <AsyncErrorState title="No pudimos cargar tu diario" detail="Tu información sigue guardada. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  const entries = data ? data.entries.map((entry) => ({ id: entry.id, date: new Date(entry.visited_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }).toUpperCase(), place: entry.place_name, taco: entry.tacos, rating: Number(entry.rating), image: entry.image_url })) : token ? [] : diaryEntries;
  const diaryPeriod = data?.entries[0]?.visited_at
    ? new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(new Date(data.entries[0].visited_at))
    : token ? `tu historia · ${new Date().getFullYear()}` : 'agosto 2026';
  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View style={styles.header}><View><Text style={styles.kicker}>TU HISTORIA</Text><Text style={styles.title}>Taco Diary</Text></View><Ionicons name="ellipsis-horizontal" size={22} color={colors.muted} /></View>
      <View style={styles.stats}><View><Text style={styles.statNumber}>{token ? entries.length : 17}</Text><Text style={styles.statLabel}>VISITAS</Text></View><View><Text style={styles.statNumber}>{token ? entries.reduce((sum, entry) => sum + (entry.taco ? entry.taco.split(',').length : 0), 0) : 48}</Text><Text style={styles.statLabel}>TACOS</Text></View><View><Text style={styles.statNumber}>{token ? (entries.length ? (entries.reduce((sum, entry) => sum + entry.rating, 0) / entries.length).toFixed(2) : '—') : '4.21'}</Text><Text style={styles.statLabel}>PROMEDIO</Text></View></View>
      <Pressable style={styles.callout} onPress={() => router.push('/wrapped')}><View style={styles.calloutIcon}><Ionicons name="sparkles" color={colors.background} size={17} /></View><View style={{ flex: 1 }}><Text style={styles.calloutTitle}>Tu resumen anual</Text><Text style={styles.calloutText}>Mira tus tacos, zonas exploradas y el lugar que más defendiste.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.muted} /></Pressable>
      <SectionTitle eyebrow={diaryPeriod} title="Tus registros" action="Ver todo" />
      <View style={styles.timeline}>{entries.map((entry, index) => <View key={entry.id} style={styles.entry}><View style={styles.date}><Text style={styles.dateText}>{entry.date.split(' ')[0]}</Text><Text style={styles.dateMonth}>{entry.date.split(' ')[1]}</Text></View><View style={styles.lineWrap}><View style={styles.dot} />{index < entries.length - 1 ? <View style={styles.line} /> : null}</View><Pressable style={styles.entryCard} disabled={!token} onPress={() => router.push({ pathname: '/visit-edit', params: { id: entry.id } })}><Image source={{ uri: entry.image }} style={styles.entryImage} /><View style={styles.entryCopy}><Text style={styles.entryPlace}>{entry.place}</Text><Text style={styles.entryTaco}>{entry.taco}</Text><View style={styles.entryBottom}><RatingBadge rating={entry.rating} /><View style={styles.entryAction}>{token ? <><Text style={styles.entryHint}>editar</Text><Ionicons name="chevron-forward" size={14} color={colors.dim} /></> : <Text style={styles.entryHint}>registrado</Text>}</View></View></View></Pressable></View>)}</View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.muted },
  content: { paddingHorizontal: spacing.lg, paddingTop: 66, paddingBottom: 115 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xl },
  kicker: { color: colors.accent, fontSize: 10, fontWeight: '900', letterSpacing: 1.5, marginBottom: 5 },
  title: { color: colors.ink, fontSize: 34, fontWeight: '900', letterSpacing: -1.3 },
  stats: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, padding: spacing.lg, marginBottom: spacing.md },
  statNumber: { color: colors.ink, fontSize: 26, fontWeight: '900', letterSpacing: -0.6 },
  statLabel: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1.1, marginTop: 4 },
  callout: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surfaceRaised, borderRadius: radii.md, padding: spacing.md, marginBottom: spacing.xl },
  calloutIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.accent, alignItems: 'center', justifyContent: 'center' },
  calloutTitle: { color: colors.ink, fontSize: 13, fontWeight: '900' },
  calloutText: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  timeline: { marginTop: 2 },
  entry: { flexDirection: 'row', minHeight: 112 },
  date: { width: 42, paddingTop: 10 },
  dateText: { color: colors.ink, fontSize: 17, fontWeight: '900' },
  dateMonth: { color: colors.muted, fontSize: 9, fontWeight: '900', letterSpacing: 1, marginTop: 2 },
  lineWrap: { width: 19, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.accent, marginTop: 16, zIndex: 1 },
  line: { position: 'absolute', top: 25, bottom: 0, width: 1, backgroundColor: colors.border },
  entryCard: { flex: 1, flexDirection: 'row', height: 92, backgroundColor: colors.surface, borderRadius: radii.md, borderWidth: 1, borderColor: colors.border, overflow: 'hidden', marginBottom: spacing.md },
  entryImage: { width: 92, height: 92 },
  entryCopy: { flex: 1, padding: spacing.md, justifyContent: 'space-between' },
  entryPlace: { color: colors.ink, fontSize: 14, fontWeight: '900' },
  entryTaco: { color: colors.warm, fontSize: 12, fontWeight: '700' },
  entryBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  entryAction: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  entryHint: { color: colors.dim, fontSize: 10, fontWeight: '700' }
});
