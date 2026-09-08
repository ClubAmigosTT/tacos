import { useMemo, useState } from 'react';
import { router } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { places } from '@/data/fixtures';
import { discover } from '@/lib/api';
import { colors, radii, spacing } from '@/theme';
import { RatingBadge } from '@/components/RatingBadge';
import { MapCanvas } from '@/components/MapCanvas';

const filters = ['Pastor', 'Abierto ahora', 'Barato', '92% para mí'];

function isOpenNow(openUntil: string) {
  const [hours, minutes] = openUntil.split(':').map(Number);
  const closing = hours * 60 + minutes;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  return closing < 6 * 60 ? current >= 18 * 60 || current <= closing : current <= closing;
}

export default function MapScreen() {
  const [active, setActive] = useState('Pastor');
  const [search, setSearch] = useState('');
  const { data = places } = useQuery({ queryKey: ['discover', 'map', search], queryFn: () => discover({ q: search }), placeholderData: places });
  const sorted = useMemo(() => {
    const source = [...data];
    if (active === 'Barato') return source.sort((a, b) => (Math.min(...a.tacos.map((taco) => taco.price), Infinity) - Math.min(...b.tacos.map((taco) => taco.price), Infinity)));
    if (active === '92% para mí') return source.sort((a, b) => b.match - a.match);
    if (active === 'Pastor') return source.sort((a, b) => (b.tacos.find((taco) => taco.name === 'Pastor')?.rating ?? b.rating) - (a.tacos.find((taco) => taco.name === 'Pastor')?.rating ?? a.rating));
    if (active === 'Abierto ahora') return source.filter((place) => isOpenNow(place.openUntil));
    return source;
  }, [active, data]);

  return (
    <View style={styles.screen}>
      <MapCanvas places={sorted} active={active} onSelect={(id) => router.push(`/place/${id}`)} />
      <View style={styles.topOverlay}><Pressable style={styles.backButton} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View style={styles.mapTitle}><Text style={styles.mapKicker}>EXPLORAR</Text><Text style={styles.mapHeading}>Tu mapa</Text></View><Pressable style={styles.locate}><Ionicons name="navigate" size={18} color={colors.ink} /></Pressable></View>
      <View style={styles.searchBar}><Ionicons name="search" size={17} color={colors.muted} /><TextInput value={search} onChangeText={setSearch} placeholder="Pastor, suadero, Roma…" placeholderTextColor={colors.muted} style={styles.searchInput} returnKeyType="search" /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filterContent}>{filters.map((filter) => <Pressable key={filter} onPress={() => setActive(filter)} style={[styles.filter, filter === active && styles.filterActive]}><Text style={[styles.filterText, filter === active && styles.filterTextActive]}>{filter}</Text></Pressable>)}</ScrollView>
      <View style={styles.sheet}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetEyebrow}>{sorted.length} LUGARES EN ESTA ZONA</Text><Text style={styles.sheetTitle}>{active === 'Pastor' ? 'Pastor que vale la pena' : active}</Text></View><Pressable><Text style={styles.listLink}>Lista ↗</Text></Pressable></View><ScrollView horizontal showsHorizontalScrollIndicator={false}>{sorted.map((place) => <Pressable key={place.id} style={styles.resultCard} onPress={() => router.push(`/place/${place.id}`)}><View style={styles.resultTop}><Text style={styles.resultName} numberOfLines={1}>{place.name}</Text><RatingBadge rating={active === 'Pastor' ? place.tacos.find((taco) => taco.name === 'Pastor')?.rating ?? place.rating : place.rating} /></View><Text style={styles.resultMeta}>{place.neighborhood} · {place.distance}</Text><Text style={styles.resultStyle}>{place.style}</Text></Pressable>)}</ScrollView></View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  topOverlay: { position: 'absolute', top: 62, left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 42, height: 42, borderRadius: 22, backgroundColor: 'rgba(11,13,12,0.86)', alignItems: 'center', justifyContent: 'center' },
  mapTitle: { alignItems: 'center' },
  mapKicker: { color: colors.accent, fontSize: 9, letterSpacing: 1.6, fontWeight: '900' },
  mapHeading: { color: colors.ink, fontSize: 20, fontWeight: '900', marginTop: 2 },
  locate: { width: 42, height: 42, borderRadius: 22, backgroundColor: 'rgba(11,13,12,0.86)', alignItems: 'center', justifyContent: 'center' },
  searchBar: { position: 'absolute', top: 116, left: spacing.lg, right: spacing.lg, height: 44, borderRadius: radii.md, backgroundColor: 'rgba(20,24,22,0.94)', borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 9 },
  searchInput: { flex: 1, color: colors.ink, fontSize: 13, paddingVertical: 0 },
  filters: { position: 'absolute', top: 169, left: 0, right: 0, maxHeight: 43 },
  filterContent: { paddingHorizontal: spacing.lg, gap: 8 },
  filter: { backgroundColor: 'rgba(20,24,22,0.92)', borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.border },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  filterTextActive: { color: colors.background },
  pin: { minWidth: 44, height: 32, borderRadius: 18, paddingHorizontal: 8, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  pinAccent: { backgroundColor: colors.accent, borderColor: colors.background },
  pinText: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 230, backgroundColor: 'rgba(11,13,12,0.96)', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: 102 },
  sheetHandle: { width: 34, height: 4, borderRadius: 4, backgroundColor: colors.dim, alignSelf: 'center', marginBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: spacing.md },
  sheetEyebrow: { color: colors.accent, fontSize: 9, letterSpacing: 1.4, fontWeight: '900', marginBottom: 5 },
  sheetTitle: { color: colors.ink, fontSize: 23, fontWeight: '900', letterSpacing: -0.6 },
  listLink: { color: colors.muted, fontWeight: '800', fontSize: 12 },
  resultCard: { width: 230, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginRight: spacing.sm },
  resultTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  resultName: { color: colors.ink, fontSize: 15, fontWeight: '900', flex: 1 },
  resultMeta: { color: colors.muted, fontSize: 11, marginTop: 7 },
  resultStyle: { color: colors.warm, fontSize: 11, fontWeight: '800', marginTop: 13 }
});
