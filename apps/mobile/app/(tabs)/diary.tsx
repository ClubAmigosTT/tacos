import { useCallback } from 'react';
import { FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useIsFocused, usePathname } from 'expo-router';
import { diaryEntries } from '@/data/fixtures';
import { diary as diaryRequest, isDemoMode } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useQuery } from '@tanstack/react-query';
import { colors, radii, shadows, spacing, typography } from '@/theme';
import { RatingBadge } from '@/components/RatingBadge';
import { SectionTitle } from '@/components/SectionTitle';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { MetricTile } from '@/components/DesignSystem';
import { CatalogImage } from '@/components/CatalogImage';

type DiaryEntry = { id: string; date: string; place: string; taco: string; rating: number; image?: string };

export default function DiaryScreen() {
  const { token, loading: authLoading } = useAuth();
  const isFocused = useIsFocused();
  const pathname = usePathname();
  const isVisible = isFocused || pathname === '/diary' || pathname.endsWith('/diary');
  const { data, isError, refetch } = useQuery({ queryKey: ['diary', token], queryFn: () => diaryRequest(token!), enabled: Boolean(token && !authLoading && isVisible) });
  const demoMode = isDemoMode();
  const entries: DiaryEntry[] = data ? data.entries.map((entry) => ({ id: entry.id, date: new Date(entry.visited_at).toLocaleDateString('es-MX', { day: '2-digit', month: 'short' }).toUpperCase(), place: entry.place_name, taco: entry.tacos, rating: Number(entry.rating), image: entry.image_url })) : token || !demoMode ? [] : diaryEntries;
  const diaryPeriod = data?.entries[0]?.visited_at
    ? new Intl.DateTimeFormat('es-MX', { month: 'long', year: 'numeric' }).format(new Date(data.entries[0].visited_at))
    : token || !demoMode ? `tu historia · ${new Date().getFullYear()}` : 'agosto 2026';
  const renderEntry = useCallback(({ item, index }: { item: DiaryEntry; index: number }) => <DiaryEntryCard entry={item} isLast={index === entries.length - 1} editable={Boolean(token)} />, [entries.length, token]);
  if (!isVisible) return <View style={styles.screen} />;
  if (authLoading) return <View style={styles.loading}><Text style={styles.loadingText}>Cargando tu historia…</Text></View>;
  if (token && isError) return <AsyncErrorState title="No pudimos cargar tu diario" detail="Tu información sigue guardada. Revisa la conexión e inténtalo de nuevo." onAction={() => void refetch()} />;
  const header = <View>
    <View style={styles.header}><View><Text style={styles.kicker}>TU HISTORIA</Text><Text style={styles.title}>Taco Diary</Text></View><Ionicons name="ellipsis-horizontal" size={22} color={colors.textSecondary} /></View>
    <View style={styles.stats}><MetricTile value={token ? entries.length : demoMode ? 17 : '—'} label="visitas" /><MetricTile value={token ? entries.reduce((sum, entry) => sum + (entry.taco ? entry.taco.split(',').length : 0), 0) : demoMode ? 48 : '—'} label="tacos" /><MetricTile value={token ? (entries.length ? (entries.reduce((sum, entry) => sum + entry.rating, 0) / entries.length).toFixed(2) : '—') : demoMode ? '4.21' : '—'} label="promedio" accent /></View>
    <Pressable style={styles.callout} onPress={() => router.push('/wrapped')}><View style={styles.calloutIcon}><Ionicons name="sparkles" color={colors.background} size={17} /></View><View style={{ flex: 1 }}><Text style={styles.calloutTitle}>Tu resumen anual</Text><Text style={styles.calloutText}>Mira tus tacos, zonas exploradas y el lugar que más defendiste.</Text></View><Ionicons name="chevron-forward" size={17} color={colors.textSecondary} /></Pressable>
    <SectionTitle eyebrow={diaryPeriod} title="Últimos tacos" action="Ver todo" />
  </View>;
  return <FlatList data={entries} keyExtractor={(entry) => entry.id} renderItem={renderEntry} style={styles.screen} contentContainerStyle={styles.content} ListHeaderComponent={header} showsVerticalScrollIndicator={false} />;
}

function DiaryEntryCard({ entry, isLast, editable }: { entry: DiaryEntry; isLast: boolean; editable: boolean }) {
  return <View style={styles.entry}><View style={styles.date}><Text style={styles.dateText}>{entry.date.split(' ')[0]}</Text><Text style={styles.dateMonth}>{entry.date.split(' ')[1]}</Text></View><View style={styles.lineWrap}><View style={styles.dot} />{!isLast ? <View style={styles.line} /> : null}</View><Pressable style={styles.entryCard} disabled={!editable} onPress={() => router.push({ pathname: '/visit-edit', params: { id: entry.id } })}><CatalogImage uri={entry.image} accessibilityLabel={`Imagen de ${entry.place}`} style={styles.entryImage} /><View style={styles.entryCopy}><Text style={styles.entryPlace}>{entry.place}</Text><Text style={styles.entryTaco}>{entry.taco}</Text><View style={styles.entryBottom}><RatingBadge rating={entry.rating} /><View style={styles.entryAction}>{editable ? <><Text style={styles.entryHint}>editar</Text><Ionicons name="chevron-forward" size={14} color={colors.textTertiary} /></> : <Text style={styles.entryHint}>registrado</Text>}</View></View></View></Pressable></View>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  loadingText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular },
  content: { paddingHorizontal: spacing.lg, paddingTop: 66, paddingBottom: 115 },
  header: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.xl },
  kicker: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: typography.tracking.loose, marginBottom: 5 },
  title: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 34, fontWeight: typography.weight.bold, letterSpacing: typography.tracking.display },
  stats: { flexDirection: 'row', justifyContent: 'space-between', backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.lg, marginBottom: spacing.md, ...shadows.card },
  callout: { flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: colors.surfaceElevated, borderRadius: radii.lg, padding: spacing.md, marginBottom: spacing.xl, ...shadows.card },
  calloutIcon: { width: 34, height: 34, borderRadius: 17, backgroundColor: colors.tortilla, alignItems: 'center', justifyContent: 'center' },
  calloutTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 13, fontWeight: typography.weight.semibold },
  calloutText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 11, lineHeight: 16, marginTop: 3 },
  timeline: { marginTop: 2 },
  entry: { flexDirection: 'row', minHeight: 112 },
  date: { width: 42, paddingTop: 10 },
  dateText: { color: colors.textPrimary, fontFamily: typography.fontFamily.bold, fontSize: 17, fontWeight: typography.weight.bold },
  dateMonth: { color: colors.textSecondary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, fontWeight: typography.weight.semibold, letterSpacing: 1, marginTop: 2 },
  lineWrap: { width: 19, alignItems: 'center' },
  dot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.cilantro, marginTop: 16, zIndex: 1 },
  line: { position: 'absolute', top: 25, bottom: 0, width: 1, backgroundColor: colors.border },
  entryCard: { flex: 1, flexDirection: 'row', height: 92, backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden', marginBottom: spacing.md, ...shadows.card },
  entryImage: { width: 92, height: 92 },
  entryCopy: { flex: 1, padding: spacing.md, justifyContent: 'space-between' },
  entryPlace: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 14, fontWeight: typography.weight.semibold },
  entryTaco: { color: colors.salsa, fontFamily: typography.fontFamily.medium, fontSize: 12, fontWeight: typography.weight.medium },
  entryBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  entryAction: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  entryHint: { color: colors.textTertiary, fontFamily: typography.fontFamily.medium, fontSize: 10, fontWeight: typography.weight.medium }
});
