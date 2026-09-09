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
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { useAuth } from '@/lib/auth';
import { applyRadar, radarDistances, radarHunger, radarMoods, radarPrices, type RadarDistance, type RadarHunger, type RadarMood, type RadarPrice } from '@/lib/radar';
const filters = ['Pastor', 'Abierto ahora', 'Barato', '92% para mí'];
const defaultMapCenter = { latitude: 19.402, longitude: -99.163 };

export default function MapScreen() {
  const { token } = useAuth();
  const { q: initialQuery } = useLocalSearchParams<{ q?: string }>();
  const [active, setActive] = useState('Pastor');
  const [search, setSearch] = useState(initialQuery ?? '');
  const [searchQuery, setSearchQuery] = useState(initialQuery ?? '');
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }>();
  const [searchCenter, setSearchCenter] = useState<{ latitude: number; longitude: number }>();
  const [pendingMapCenter, setPendingMapCenter] = useState<{ latitude: number; longitude: number }>();
  const [mapMoved, setMapMoved] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [radarOpen, setRadarOpen] = useState(false);
  const [radarDistance, setRadarDistance] = useState<RadarDistance>('En la zona');
  const [radarPrice, setRadarPrice] = useState<RadarPrice>('Cualquier precio');
  const [radarMood, setRadarMood] = useState<RadarMood>('Alta calidad');
  const [radarHungerLevel, setRadarHungerLevel] = useState<RadarHunger>('Normal');
  useEffect(() => { if (initialQuery != null) setSearch(initialQuery); }, [initialQuery]);
  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  async function loadLocation() {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== Location.PermissionStatus.GRANTED) { setLocationDenied(true); return; }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoordinates({ latitude: current.coords.latitude, longitude: current.coords.longitude });
      setSearchCenter(undefined);
      setPendingMapCenter(undefined);
      setMapMoved(false);
    } catch { setLocationDenied(true); }
  }
  useEffect(() => { if (Platform.OS !== 'web') void loadLocation(); }, []);
  const searchCoordinates = searchCenter ?? coordinates;
  const handleMapRegionChange = (next: { latitude: number; longitude: number }) => {
    const baseline = searchCoordinates ?? defaultMapCenter;
    const moved = Math.abs(next.latitude - baseline.latitude) > 0.002 || Math.abs(next.longitude - baseline.longitude) > 0.002;
    if (moved) { setPendingMapCenter(next); setMapMoved(true); }
    else { setPendingMapCenter(undefined); setMapMoved(false); }
  };
  const { data = places, isError: discoverError, refetch: refetchDiscover } = useQuery({ queryKey: ['discover', 'map', searchQuery, searchCoordinates?.latitude, searchCoordinates?.longitude, token], queryFn: () => discover({ q: searchQuery, lat: searchCoordinates?.latitude, lng: searchCoordinates?.longitude }, token), placeholderData: places });
  const discoveryPlaces = token && discoverError ? [] : data;
  const requestedTaco = useMemo(() => {
    const normalized = searchQuery.trim().toLowerCase();
    if (normalized.length < 3) return undefined;
    const tacoNames = [...new Set(discoveryPlaces.flatMap((place) => place.tacos.map((taco) => taco.name)))];
    return tacoNames.find((name) => normalized.includes(name.toLowerCase()))
      ?? tacoNames.find((name) => name.toLowerCase().includes(normalized));
  }, [discoveryPlaces, searchQuery]);
  const hasFreeTextSearch = searchQuery.trim().length > 0;
  // "Pastor" is the visual default for an empty map, not a hidden query
  // constraint. Once the user searches for a neighborhood or another branch
  // attribute, let the API result set speak for itself unless a taco name was
  // actually detected in the query.
  const contextualTaco = requestedTaco ?? (!hasFreeTextSearch && active === 'Pastor' ? 'Pastor' : undefined);
  const sorted = useMemo(() => applyRadar({ places: discoveryPlaces, active, contextualTaco, distance: radarDistance, price: radarPrice, mood: radarMood, hunger: radarHungerLevel }), [active, contextualTaco, discoveryPlaces, radarDistance, radarHungerLevel, radarMood, radarPrice]);
  // Never recommend a place outside the active search/Radar constraints.
  // An empty result set must remain empty instead of silently escaping the
  // user's distance, price or mood choices.
  const suggestion = sorted[0];

  if (token && discoverError) return <View style={styles.errorScreen}><AsyncErrorState title="No pudimos actualizar tu mapa" detail="No mostramos sucursales demo mientras tu sesión está activa. Revisa la conexión para recuperar resultados reales." onAction={() => void refetchDiscover()} /></View>;

  function clearDiscovery() {
    setActive('Pastor');
    setRadarDistance('En la zona');
    setRadarPrice('Cualquier precio');
    setRadarMood('Alta calidad');
    setRadarHungerLevel('Normal');
    setSearch('');
    setSearchQuery('');
    setSearchCenter(undefined);
    setPendingMapCenter(undefined);
    setMapMoved(false);
  }

  return (
    <View style={styles.screen}>
      <MapCanvas places={sorted} active={active} tacoName={contextualTaco} onSelect={(id) => router.push(`/place/${id}`)} userCoordinates={coordinates} onRegionChangeComplete={handleMapRegionChange} />
      <View style={styles.topOverlay}><Pressable accessibilityRole="button" accessibilityLabel="Volver" style={styles.backButton} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.ink} /></Pressable><View style={styles.mapTitle}><Text style={styles.mapKicker}>EXPLORAR</Text><Text style={styles.mapHeading}>Tu mapa</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Usar mi ubicación" style={[styles.locate, coordinates && styles.locateActive]} onPress={() => void loadLocation()}><Ionicons name="navigate" size={18} color={coordinates ? colors.background : colors.ink} /></Pressable></View>
      <View style={styles.searchBar}><Ionicons name="search" size={17} color={colors.muted} /><TextInput accessibilityLabel="Buscar taquerías, tacos o zonas" value={search} onChangeText={setSearch} onSubmitEditing={() => { setSearchQuery(search.trim()); void trackEvent('map_search', { query_length: search.trim().length }, token); }} placeholder="Pastor, suadero, Roma…" placeholderTextColor={colors.muted} style={styles.searchInput} returnKeyType="search" /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filterContent}>{filters.map((filter) => { const selected = filter === active && !(filter === 'Pastor' && hasFreeTextSearch && !requestedTaco); return <Pressable key={filter} accessibilityRole="button" accessibilityLabel={`Filtrar por ${filter}`} accessibilityState={{ selected }} onPress={() => { setActive(filter); void trackEvent('map_filter', { filter }, token); }} style={[styles.filter, selected && styles.filterActive]}><Text style={[styles.filterText, selected && styles.filterTextActive]}>{filter}</Text></Pressable>; })}<Pressable accessibilityRole="button" accessibilityLabel="Abrir Radar de tacos" accessibilityState={{ expanded: radarOpen }} onPress={() => { setRadarOpen((value) => !value); void trackEvent('radar_filter', { filter: 'open' }, token); }} style={[styles.filter, radarOpen && styles.filterActive]}><Ionicons name="options-outline" size={13} color={radarOpen ? colors.background : colors.ink} /><Text style={[styles.filterText, radarOpen && styles.filterTextActive]}>Radar</Text></Pressable></ScrollView>
      {radarOpen ? <View style={styles.radarPanel}><View style={styles.radarHeader}><View><Text style={styles.radarEyebrow}>RADAR DE TACOS</Text><Text style={styles.radarTitle}>Encuentra algo para ti</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cerrar Radar" onPress={() => setRadarOpen(false)}><Ionicons name="close" size={19} color={colors.muted} /></Pressable></View><Text style={styles.radarLabel}>DISTANCIA</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radarOptions}>{radarDistances.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Distancia: ${option}`} accessibilityState={{ selected: radarDistance === option }} onPress={() => { setRadarDistance(option); void trackEvent('radar_filter', { filter: `distance:${option}` }, token); }} style={[styles.radarOption, radarDistance === option && styles.radarOptionActive]}><Text style={[styles.radarOptionText, radarDistance === option && styles.radarOptionTextActive]}>{option}</Text></Pressable>)}</ScrollView><Text style={styles.radarLabel}>PRECIO</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radarOptions}>{radarPrices.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Precio: ${option}`} accessibilityState={{ selected: radarPrice === option }} onPress={() => { setRadarPrice(option); void trackEvent('radar_filter', { filter: `price:${option}` }, token); }} style={[styles.radarOption, radarPrice === option && styles.radarOptionActive]}><Text style={[styles.radarOptionText, radarPrice === option && styles.radarOptionTextActive]}>{option}</Text></Pressable>)}</ScrollView><Text style={styles.radarLabel}>ANTOJO</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radarOptions}>{radarMoods.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Antojo: ${option}`} accessibilityState={{ selected: radarMood === option }} onPress={() => { setRadarMood(option); void trackEvent('radar_filter', { filter: `mood:${option}` }, token); }} style={[styles.radarOption, radarMood === option && styles.radarOptionActive]}><Text style={[styles.radarOptionText, radarMood === option && styles.radarOptionTextActive]}>{option}</Text></Pressable>)}</ScrollView><Text style={styles.radarLabel}>HAMBRE</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radarOptions}>{radarHunger.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Hambre: ${option}`} accessibilityState={{ selected: radarHungerLevel === option }} onPress={() => { setRadarHungerLevel(option); void trackEvent('radar_filter', { filter: `hunger:${option}` }, token); }} style={[styles.radarOption, radarHungerLevel === option && styles.radarOptionActive]}><Text style={[styles.radarOptionText, radarHungerLevel === option && styles.radarOptionTextActive]}>{option}</Text></Pressable>)}</ScrollView></View> : null}
      {mapMoved && pendingMapCenter ? <Pressable accessibilityRole="button" accessibilityLabel="Buscar en esta zona" style={styles.searchAreaButton} onPress={() => { setSearchCenter(pendingMapCenter); setPendingMapCenter(undefined); setMapMoved(false); void trackEvent('map_filter', { filter: 'search_area' }, token); }}><Ionicons name="search" size={14} color={colors.background} /><Text style={styles.searchAreaText}>Buscar en esta zona</Text></Pressable> : null}
      <View style={styles.sheet}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetEyebrow}>{sorted.length} LUGARES EN ESTA ZONA</Text><Text style={styles.sheetTitle}>{requestedTaco ? `${requestedTaco} que vale la pena` : hasFreeTextSearch ? `Resultados para "${searchQuery.trim()}"` : active === 'Pastor' ? 'Pastor que vale la pena' : active}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={suggestion ? `Abrir recomendación para ${suggestion.name}` : 'Sin recomendaciones disponibles'} style={[styles.magicButton, !suggestion && styles.magicButtonDisabled]} disabled={!suggestion} onPress={() => suggestion && router.push(`/place/${suggestion.id}`)}><Ionicons name="sparkles-outline" size={14} color={colors.background} /><Text style={styles.magicText}>Para mí</Text></Pressable></View>{sorted.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}>{sorted.map((place) => <Pressable key={place.id} accessibilityRole="button" accessibilityLabel={`${place.name}, ${place.rating.toFixed(1)} de rating, ${place.distance}`} style={styles.resultCard} onPress={() => router.push(`/place/${place.id}`)}><View style={styles.resultTop}><Text style={styles.resultName} numberOfLines={1}>{place.name}</Text><RatingBadge rating={contextualTaco ? place.tacos.find((taco) => taco.name.toLowerCase() === contextualTaco.toLowerCase())?.rating ?? place.rating : place.rating} /></View><Text style={styles.resultMeta}>{place.neighborhood} · {place.distance}</Text><Text style={styles.resultStyle}>{place.style}</Text></Pressable>)}</ScrollView> : <View style={styles.emptyResults}><Ionicons name="moon-outline" size={21} color={colors.warm} /><View style={styles.emptyResultsCopy}><Text style={styles.emptyResultsTitle}>No hay lugares con esta combinación</Text><Text style={styles.emptyResultsText}>Prueba otra hora, zona o criterio para seguir explorando.</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Limpiar filtros y búsqueda" style={styles.clearButton} onPress={clearDiscovery}><Text style={styles.clearButtonText}>Limpiar</Text></Pressable></View>}</View>
      {locationDenied ? <Pressable accessibilityRole="button" accessibilityLabel="Activar ubicación para calcular distancias reales" style={styles.locationHint} onPress={() => void loadLocation()}><Ionicons name="location-outline" size={14} color={colors.warm} /><Text style={styles.locationHintText}>Activa ubicación para calcular distancias reales</Text></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  errorScreen: { flex: 1, backgroundColor: colors.background },
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
  searchAreaButton: { position: 'absolute', top: 220, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 9, zIndex: 6 },
  searchAreaText: { color: colors.background, fontSize: 11, fontWeight: '900' },
  pin: { minWidth: 44, height: 32, borderRadius: 18, paddingHorizontal: 8, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  pinAccent: { backgroundColor: colors.accent, borderColor: colors.background },
  pinText: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 230, backgroundColor: 'rgba(11,13,12,0.96)', borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: spacing.lg, paddingBottom: 102 },
  sheetHandle: { width: 34, height: 4, borderRadius: 4, backgroundColor: colors.dim, alignSelf: 'center', marginBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: spacing.md },
  sheetEyebrow: { color: colors.accent, fontSize: 9, letterSpacing: 1.4, fontWeight: '900', marginBottom: 5 },
  sheetTitle: { color: colors.ink, fontSize: 23, fontWeight: '900', letterSpacing: -0.6 },
  magicButton: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.accent, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 8 },
  magicButtonDisabled: { opacity: 0.35 },
  magicText: { color: colors.background, fontWeight: '900', fontSize: 10 },
  resultCard: { width: 230, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface, borderRadius: radii.md, padding: spacing.md, marginRight: spacing.sm },
  resultTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  resultName: { color: colors.ink, fontSize: 15, fontWeight: '900', flex: 1 },
  resultMeta: { color: colors.muted, fontSize: 11, marginTop: 7 },
  resultStyle: { color: colors.warm, fontSize: 11, fontWeight: '800', marginTop: 13 },
  emptyResults: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: colors.border, borderRadius: radii.md, backgroundColor: colors.surface, padding: spacing.md },
  emptyResultsCopy: { flex: 1 },
  emptyResultsTitle: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  emptyResultsText: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: 3 },
  clearButton: { borderRadius: radii.pill, backgroundColor: colors.accent, paddingHorizontal: 11, paddingVertical: 8 },
  clearButtonText: { color: colors.background, fontSize: 10, fontWeight: '900' },
  locationHint: { position: 'absolute', top: 220, left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: 'rgba(20,24,22,0.92)', borderRadius: radii.pill, paddingVertical: 9 },
  locationHintText: { color: colors.warm, fontSize: 10, fontWeight: '800' }
});
