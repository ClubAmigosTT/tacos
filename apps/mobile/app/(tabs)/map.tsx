import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { places } from '@/data/fixtures';
import { discover, trackEvent } from '@/lib/api';
import { colors, radii, spacing } from '@/theme';
import { RatingBadge } from '@/components/RatingBadge';
import { MapCanvas } from '@/components/MapCanvas';
import { useAuth } from '@/lib/auth';

const filters = ['Pastor', 'Abierto ahora', 'Barato', '92% para mí'];
const radarDistances = ['Cerca', 'En la zona', 'Toda la ciudad'] as const;
const radarPrices = ['Barato', 'Medio', 'Cualquier precio'] as const;
const radarMoods = ['Clásico', 'Aventura', 'Alta calidad'] as const;

function isOpenNow(openUntil: string) {
  const [hours, minutes] = openUntil.split(':').map(Number);
  const closing = hours * 60 + minutes;
  const now = new Date();
  const current = now.getHours() * 60 + now.getMinutes();
  return closing < 6 * 60 ? current >= 18 * 60 || current <= closing : current <= closing;
}

function distanceKm(distance: string) {
  const value = Number.parseFloat(distance.replace(',', '.'));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function lowestPrice(place: (typeof places)[number]) {
  return Math.min(...place.tacos.map((taco) => taco.price), Number.POSITIVE_INFINITY);
}

export default function MapScreen() {
  const { token } = useAuth();
  const { q: initialQuery } = useLocalSearchParams<{ q?: string }>();
  const [active, setActive] = useState('Pastor');
  const [search, setSearch] = useState(initialQuery ?? '');
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }>();
  const [locationDenied, setLocationDenied] = useState(false);
  const [radarOpen, setRadarOpen] = useState(false);
  const [radarDistance, setRadarDistance] = useState<(typeof radarDistances)[number]>('En la zona');
  const [radarPrice, setRadarPrice] = useState<(typeof radarPrices)[number]>('Cualquier precio');
  const [radarMood, setRadarMood] = useState<(typeof radarMoods)[number]>('Alta calidad');
  useEffect(() => { if (initialQuery != null) setSearch(initialQuery); }, [initialQuery]);
  async function loadLocation() {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== Location.PermissionStatus.GRANTED) { setLocationDenied(true); return; }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoordinates({ latitude: current.coords.latitude, longitude: current.coords.longitude });
    } catch { setLocationDenied(true); }
  }
  useEffect(() => { if (Platform.OS !== 'web') void loadLocation(); }, []);
  const { data = places } = useQuery({ queryKey: ['discover', 'map', search, coordinates?.latitude, coordinates?.longitude], queryFn: () => discover({ q: search, lat: coordinates?.latitude, lng: coordinates?.longitude }), placeholderData: places });
  const sorted = useMemo(() => {
    const source = [...data];
    const distanceLimit = radarDistance === 'Cerca' ? 2 : radarDistance === 'En la zona' ? 5 : Number.POSITIVE_INFINITY;
    const radarFiltered = source.filter((place) => {
      if (distanceKm(place.distance) > distanceLimit) return false;
      if (radarPrice === 'Barato' && lowestPrice(place) > 24) return false;
      if (radarPrice === 'Medio' && (lowestPrice(place) < 24 || lowestPrice(place) > 32)) return false;
      return true;
    });
    const radarSource = radarFiltered.length > 0 ? radarFiltered : source;
    if (active === 'Barato') return radarSource.sort((a, b) => (Math.min(...a.tacos.map((taco) => taco.price), Infinity) - Math.min(...b.tacos.map((taco) => taco.price), Infinity)));
    if (active === '92% para mí') return radarSource.sort((a, b) => b.match - a.match);
    if (active === 'Pastor') return radarSource.sort((a, b) => (b.tacos.find((taco) => taco.name === 'Pastor')?.rating ?? b.rating) - (a.tacos.find((taco) => taco.name === 'Pastor')?.rating ?? a.rating));
    if (active === 'Abierto ahora') return radarSource.filter((place) => isOpenNow(place.openUntil));
    if (radarMood === 'Clásico') return radarSource.sort((a, b) => b.flavorProfile.traditional - a.flavorProfile.traditional);
    if (radarMood === 'Aventura') return radarSource.sort((a, b) => (b.flavorProfile.intensity + (100 - b.flavorProfile.traditional)) - (a.flavorProfile.intensity + (100 - a.flavorProfile.traditional)));
    return radarSource.sort((a, b) => b.rating - a.rating);
  }, [active, data, radarDistance, radarMood, radarPrice]);
  const suggestion = sorted[0] ?? data[0];

  return (
    <View style={styles.screen}>
      <MapCanvas places={sorted} active={active} onSelect={(id) => router.push(`/place/${id}`)} userCoordinates={coordinates} />
      <View style={styles.topOverlay}><Pressable style={styles.backButton} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View style={styles.mapTitle}><Text style={styles.mapKicker}>EXPLORAR</Text><Text style={styles.mapHeading}>Tu mapa</Text></View><Pressable style={[styles.locate, coordinates && styles.locateActive]} onPress={() => void loadLocation()}><Ionicons name="navigate" size={18} color={coordinates ? colors.background : colors.ink} /></Pressable></View>
      <View style={styles.searchBar}><Ionicons name="search" size={17} color={colors.muted} /><TextInput value={search} onChangeText={setSearch} onSubmitEditing={() => void trackEvent('map_search', { query_length: search.trim().length }, token)} placeholder="Pastor, suadero, Roma…" placeholderTextColor={colors.muted} style={styles.searchInput} returnKeyType="search" /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filterContent}>{filters.map((filter) => <Pressable key={filter} onPress={() => { setActive(filter); void trackEvent('map_filter', { filter }, token); }} style={[styles.filter, filter === active && styles.filterActive]}><Text style={[styles.filterText, filter === active && styles.filterTextActive]}>{filter}</Text></Pressable>)}<Pressable onPress={() => { setRadarOpen((value) => !value); void trackEvent('radar_filter', { filter: 'open' }, token); }} style={[styles.filter, radarOpen && styles.filterActive]}><Ionicons name="options-outline" size={13} color={radarOpen ? colors.background : colors.ink} /><Text style={[styles.filterText, radarOpen && styles.filterTextActive]}>Radar</Text></Pressable></ScrollView>
      {radarOpen ? <View style={styles.radarPanel}><View style={styles.radarHeader}><View><Text style={styles.radarEyebrow}>RADAR DE TACOS</Text><Text style={styles.radarTitle}>Encuentra algo para ti</Text></View><Pressable onPress={() => setRadarOpen(false)}><Ionicons name="close" size={19} color={colors.muted} /></Pressable></View><Text style={styles.radarLabel}>DISTANCIA</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radarOptions}>{radarDistances.map((option) => <Pressable key={option} onPress={() => { setRadarDistance(option); void trackEvent('radar_filter', { filter: `distance:${option}` }, token); }} style={[styles.radarOption, radarDistance === option && styles.radarOptionActive]}><Text style={[styles.radarOptionText, radarDistance === option && styles.radarOptionTextActive]}>{option}</Text></Pressable>)}</ScrollView><Text style={styles.radarLabel}>PRECIO</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radarOptions}>{radarPrices.map((option) => <Pressable key={option} onPress={() => { setRadarPrice(option); void trackEvent('radar_filter', { filter: `price:${option}` }, token); }} style={[styles.radarOption, radarPrice === option && styles.radarOptionActive]}><Text style={[styles.radarOptionText, radarPrice === option && styles.radarOptionTextActive]}>{option}</Text></Pressable>)}</ScrollView><Text style={styles.radarLabel}>ANTOJO</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radarOptions}>{radarMoods.map((option) => <Pressable key={option} onPress={() => { setRadarMood(option); void trackEvent('radar_filter', { filter: `mood:${option}` }, token); }} style={[styles.radarOption, radarMood === option && styles.radarOptionActive]}><Text style={[styles.radarOptionText, radarMood === option && styles.radarOptionTextActive]}>{option}</Text></Pressable>)}</ScrollView></View> : null}
      <View style={styles.sheet}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetEyebrow}>{sorted.length} LUGARES EN ESTA ZONA</Text><Text style={styles.sheetTitle}>{active === 'Pastor' ? 'Pastor que vale la pena' : active}</Text></View><Pressable style={styles.magicButton} disabled={!suggestion} onPress={() => suggestion && router.push(`/place/${suggestion.id}`)}><Ionicons name="sparkles-outline" size={14} color={colors.background} /><Text style={styles.magicText}>Para mí</Text></Pressable></View><ScrollView horizontal showsHorizontalScrollIndicator={false}>{sorted.map((place) => <Pressable key={place.id} style={styles.resultCard} onPress={() => router.push(`/place/${place.id}`)}><View style={styles.resultTop}><Text style={styles.resultName} numberOfLines={1}>{place.name}</Text><RatingBadge rating={active === 'Pastor' ? place.tacos.find((taco) => taco.name === 'Pastor')?.rating ?? place.rating : place.rating} /></View><Text style={styles.resultMeta}>{place.neighborhood} · {place.distance}</Text><Text style={styles.resultStyle}>{place.style}</Text></Pressable>)}</ScrollView></View>
      {locationDenied ? <Pressable style={styles.locationHint} onPress={() => void loadLocation()}><Ionicons name="location-outline" size={14} color={colors.warm} /><Text style={styles.locationHintText}>Activa ubicación para calcular distancias reales</Text></Pressable> : null}
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
  locateActive: { backgroundColor: colors.accent },
  searchBar: { position: 'absolute', top: 116, left: spacing.lg, right: spacing.lg, height: 44, borderRadius: radii.md, backgroundColor: 'rgba(20,24,22,0.94)', borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 9 },
  searchInput: { flex: 1, color: colors.ink, fontSize: 13, paddingVertical: 0 },
  filters: { position: 'absolute', top: 169, left: 0, right: 0, maxHeight: 43 },
  filterContent: { paddingHorizontal: spacing.lg, gap: 8 },
  filter: { backgroundColor: 'rgba(20,24,22,0.92)', borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.border },
  filterActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  filterText: { color: colors.ink, fontSize: 12, fontWeight: '800' },
  filterTextActive: { color: colors.background },
  radarPanel: { position: 'absolute', top: 220, left: spacing.lg, right: spacing.lg, backgroundColor: 'rgba(20,24,22,0.98)', borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md, zIndex: 5 },
  radarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  radarEyebrow: { color: colors.accent, fontSize: 9, letterSpacing: 1.4, fontWeight: '900' },
  radarTitle: { color: colors.ink, fontSize: 17, fontWeight: '900', marginTop: 3 },
  radarLabel: { color: colors.dim, fontSize: 9, letterSpacing: 1.2, fontWeight: '900', marginTop: spacing.sm, marginBottom: 7 },
  radarOptions: { gap: 7 },
  radarOption: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceRaised },
  radarOptionActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  radarOptionText: { color: colors.ink, fontSize: 11, fontWeight: '800' },
  radarOptionTextActive: { color: colors.background },
  pin: { minWidth: 44, height: 32, borderRadius: 18, paddingHorizontal: 8, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  pinAccent: { backgroundColor: colors.accent, borderColor: colors.background },
  pinText: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 230, backgroundColor: 'rgba(11,13,12,0.96)', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: 102 },
  sheetHandle: { width: 34, height: 4, borderRadius: 4, backgroundColor: colors.dim, alignSelf: 'center', marginBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: spacing.md },
  sheetEyebrow: { color: colors.accent, fontSize: 9, letterSpacing: 1.4, fontWeight: '900', marginBottom: 5 },
  sheetTitle: { color: colors.ink, fontSize: 23, fontWeight: '900', letterSpacing: -0.6 },
  magicButton: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 8 },
  magicText: { color: colors.background, fontWeight: '900', fontSize: 10 },
  resultCard: { width: 230, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginRight: spacing.sm },
  resultTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  resultName: { color: colors.ink, fontSize: 15, fontWeight: '900', flex: 1 },
  resultMeta: { color: colors.muted, fontSize: 11, marginTop: 7 },
  resultStyle: { color: colors.warm, fontSize: 11, fontWeight: '800', marginTop: 13 },
  locationHint: { position: 'absolute', top: 220, left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(20,24,22,0.92)', borderRadius: radii.pill, paddingVertical: 9 },
  locationHintText: { color: colors.warm, fontSize: 10, fontWeight: '800' }
});
