import { useEffect, useMemo, useState } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { discover, isDemoMode, trackEvent } from '@/lib/api';
import { localDiscover, places } from '@/lib/localCatalog';
import { colors, radii, shadows, spacing, typography } from '@/theme';
import { RatingBadge } from '@/components/RatingBadge';
import { MapCanvas } from '@/components/MapCanvas';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { useAuth } from '@/lib/auth';
import { applyRadar, normalizeRadarText, radarDistances, radarHunger, radarMoods, radarPrices, type RadarDistance, type RadarHunger, type RadarMood, type RadarPrice } from '@/lib/radar';
const filters = ['Pastor', 'Abierto ahora', 'Barato', '92% para mí'];
const defaultMapCenter = { latitude: 19.402, longitude: -99.163 };

export default function MapScreen() {
  const { token, loading: authLoading } = useAuth();
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
  const discoveryQuery = { q: searchQuery, lat: searchCoordinates?.latitude, lng: searchCoordinates?.longitude, radiusKm: searchCoordinates ? 8 : undefined, openNow: active === 'Abierto ahora' ? true : undefined, limit: 50 };
  const { data, isLoading: discoverLoading, isError: discoverError, refetch: refetchDiscover } = useQuery({ queryKey: ['discover', 'map', searchQuery, searchCoordinates?.latitude, searchCoordinates?.longitude, active, token], queryFn: () => discover(discoveryQuery, token), initialData: () => localDiscover(discoveryQuery), enabled: !authLoading });
  // Fixtures are only a deliberate demo-mode fallback. A real build must
  // never make an unavailable or unconfigured API look like a live catalog.
  const discoveryPlaces = data ?? (isDemoMode() ? places : []);
  const requestedTaco = useMemo(() => {
    const normalized = normalizeRadarText(searchQuery.trim());
    if (normalized.length < 3) return undefined;
    const tacoNames = [...new Set(discoveryPlaces.flatMap((place) => place.tacos.map((taco) => taco.name)))];
    return tacoNames.find((name) => normalized.includes(normalizeRadarText(name)))
      ?? tacoNames.find((name) => normalizeRadarText(name).includes(normalized));
  }, [discoveryPlaces, searchQuery]);
  const hasFreeTextSearch = searchQuery.trim().length > 0;
  // "Pastor" is the visual default for an empty map, not a hidden query
  // constraint. Once the user searches for a neighborhood or another branch
  // attribute, let the API result set speak for itself unless a taco name was
  // actually detected in the query.
  const contextualTaco = requestedTaco;
  const sorted = useMemo(() => applyRadar({ places: discoveryPlaces, active, contextualTaco, distance: radarDistance, price: radarPrice, mood: radarMood, hunger: radarHungerLevel }), [active, contextualTaco, discoveryPlaces, radarDistance, radarHungerLevel, radarMood, radarPrice]);
  // Never recommend a place outside the active search/Radar constraints.
  // An empty result set must remain empty instead of silently escaping the
  // user's distance, price or mood choices.
  const suggestion = sorted[0];

  if (authLoading) return <View style={styles.authLoading}><Text style={styles.authLoadingText}>Preparando tu mapa…</Text></View>;

  if (discoverError && !isDemoMode() && !data?.length) return <View style={styles.errorScreen}><AsyncErrorState title="No pudimos actualizar tu mapa" detail="Revisa la conexión para ver sucursales reales del catálogo." onAction={() => void refetchDiscover()} /></View>;

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
      <View style={styles.topOverlay}><Pressable accessibilityRole="button" accessibilityLabel="Volver" style={styles.backButton} onPress={() => router.back()}><Ionicons name="chevron-back" size={22} color={colors.textPrimary} /></Pressable><View style={styles.mapTitle}><Text style={styles.mapKicker}>EXPLORAR</Text><Text style={styles.mapHeading}>Cerca de ti</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Usar mi ubicación" style={[styles.locate, coordinates && styles.locateActive]} onPress={() => void loadLocation()}><Ionicons name="navigate" size={18} color={coordinates ? colors.meatDark : colors.textPrimary} /></Pressable></View>
      <View style={styles.searchBar}><Ionicons name="search" size={17} color={colors.textSecondary} /><TextInput accessibilityLabel="Buscar taquerías, tacos o zonas" value={search} onChangeText={setSearch} onSubmitEditing={() => { setSearchQuery(search.trim()); void trackEvent('map_search', { query_length: search.trim().length }, token); }} placeholder="Pastor, suadero, Roma…" placeholderTextColor={colors.textSecondary} style={styles.searchInput} returnKeyType="search" /></View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filterContent}>{filters.map((filter) => { const selected = filter === active && !(filter === 'Pastor' && hasFreeTextSearch && !requestedTaco); return <Pressable key={filter} accessibilityRole="button" accessibilityLabel={`Filtrar por ${filter}`} accessibilityState={{ selected }} onPress={() => { setActive(filter); void trackEvent('map_filter', { filter }, token); }} style={[styles.filter, selected && styles.filterActive]}><Text style={[styles.filterText, selected && styles.filterTextActive]}>{filter}</Text></Pressable>; })}<Pressable accessibilityRole="button" accessibilityLabel="Abrir Radar de tacos" accessibilityState={{ expanded: radarOpen }} onPress={() => { setRadarOpen((value) => !value); void trackEvent('radar_filter', { filter: 'open' }, token); }} style={[styles.filter, radarOpen && styles.filterActive]}><Ionicons name="options-outline" size={13} color={radarOpen ? colors.background : colors.textPrimary} /><Text style={[styles.filterText, radarOpen && styles.filterTextActive]}>Radar</Text></Pressable></ScrollView>
      {radarOpen ? <View style={styles.radarPanel}><View style={styles.radarHeader}><View><Text style={styles.radarEyebrow}>RADAR DE TACOS</Text><Text style={styles.radarTitle}>Encuentra algo para ti</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Cerrar Radar" onPress={() => setRadarOpen(false)}><Ionicons name="close" size={19} color={colors.textSecondary} /></Pressable></View><Text style={styles.radarLabel}>DISTANCIA</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radarOptions}>{radarDistances.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Distancia: ${option}`} accessibilityState={{ selected: radarDistance === option }} onPress={() => { setRadarDistance(option); void trackEvent('radar_filter', { filter: `distance:${option}` }, token); }} style={[styles.radarOption, radarDistance === option && styles.radarOptionActive]}><Text style={[styles.radarOptionText, radarDistance === option && styles.radarOptionTextActive]}>{option}</Text></Pressable>)}</ScrollView><Text style={styles.radarLabel}>PRECIO</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radarOptions}>{radarPrices.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Precio: ${option}`} accessibilityState={{ selected: radarPrice === option }} onPress={() => { setRadarPrice(option); void trackEvent('radar_filter', { filter: `price:${option}` }, token); }} style={[styles.radarOption, radarPrice === option && styles.radarOptionActive]}><Text style={[styles.radarOptionText, radarPrice === option && styles.radarOptionTextActive]}>{option}</Text></Pressable>)}</ScrollView><Text style={styles.radarLabel}>ANTOJO</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radarOptions}>{radarMoods.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Antojo: ${option}`} accessibilityState={{ selected: radarMood === option }} onPress={() => { setRadarMood(option); void trackEvent('radar_filter', { filter: `mood:${option}` }, token); }} style={[styles.radarOption, radarMood === option && styles.radarOptionActive]}><Text style={[styles.radarOptionText, radarMood === option && styles.radarOptionTextActive]}>{option}</Text></Pressable>)}</ScrollView><Text style={styles.radarLabel}>HAMBRE</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.radarOptions}>{radarHunger.map((option) => <Pressable key={option} accessibilityRole="button" accessibilityLabel={`Hambre: ${option}`} accessibilityState={{ selected: radarHungerLevel === option }} onPress={() => { setRadarHungerLevel(option); void trackEvent('radar_filter', { filter: `hunger:${option}` }, token); }} style={[styles.radarOption, radarHungerLevel === option && styles.radarOptionActive]}><Text style={[styles.radarOptionText, radarHungerLevel === option && styles.radarOptionTextActive]}>{option}</Text></Pressable>)}</ScrollView></View> : null}
      {mapMoved && pendingMapCenter ? <Pressable accessibilityRole="button" accessibilityLabel="Buscar en esta zona" style={styles.searchAreaButton} onPress={() => { setSearchCenter(pendingMapCenter); setPendingMapCenter(undefined); setMapMoved(false); void trackEvent('map_filter', { filter: 'search_area' }, token); }}><Ionicons name="search" size={14} color={colors.background} /><Text style={styles.searchAreaText}>Buscar en esta zona</Text></Pressable> : null}
      <View style={styles.sheet}><View style={styles.sheetHandle} /><View style={styles.sheetHeader}><View><Text style={styles.sheetEyebrow}>{discoverLoading ? 'BUSCANDO EN EL CATÁLOGO' : `${sorted.length} LUGARES EN ESTA ZONA`}</Text><Text style={styles.sheetTitle}>{discoverLoading ? 'Actualizando tu mapa…' : requestedTaco ? `${requestedTaco} que vale la pena` : hasFreeTextSearch ? `Resultados para "${searchQuery.trim()}"` : active === 'Pastor' ? 'Pastor que vale la pena' : active}</Text></View><Pressable accessibilityRole="button" accessibilityLabel={suggestion ? `Abrir recomendación para ${suggestion.name}` : 'Sin recomendaciones disponibles'} style={[styles.magicButton, !suggestion && styles.magicButtonDisabled]} disabled={!suggestion} onPress={() => suggestion && router.push(`/place/${suggestion.id}`)}><Ionicons name="sparkles-outline" size={14} color={colors.background} /><Text style={styles.magicText}>Para mí</Text></Pressable></View>{discoverLoading ? <View style={styles.loadingResults}><Ionicons name="sync-outline" size={18} color={colors.tortilla} /><Text style={styles.loadingResultsText}>Consultando el catálogo de Tacos…</Text></View> : sorted.length ? <ScrollView horizontal showsHorizontalScrollIndicator={false}>{sorted.map((place) => <Pressable key={place.id} accessibilityRole="button" accessibilityLabel={`${place.name}, ${place.rating > 0 ? place.rating.toFixed(1) : 'sin calificación'}, ${place.distance}`} style={styles.resultCard} onPress={() => router.push(`/place/${place.id}`)}><View style={styles.resultTop}><Text style={styles.resultName} numberOfLines={1}>{place.name}</Text><RatingBadge rating={contextualTaco ? place.tacos.find((taco) => taco.name.toLowerCase() === contextualTaco.toLowerCase())?.rating ?? place.rating : place.rating} /></View><Text style={styles.resultMeta}>{place.neighborhood} · {place.distance}</Text><Text style={styles.resultStyle}>{place.style}</Text></Pressable>)}</ScrollView> : <View style={styles.emptyResults}><Ionicons name="moon-outline" size={21} color={colors.salsa} /><View style={styles.emptyResultsCopy}><Text style={styles.emptyResultsTitle}>No hay lugares con esta combinación</Text><Text style={styles.emptyResultsText}>Prueba otra hora, zona o criterio para seguir explorando.</Text><Pressable accessibilityRole="button" accessibilityLabel="Proponer una taquería que no aparece" onPress={() => router.push({ pathname: '/catalog-proposal', params: { kind: 'branch' } })}><Text style={styles.proposeLink}>¿Falta una taquería? Agrégala</Text></Pressable></View><Pressable accessibilityRole="button" accessibilityLabel="Limpiar filtros y búsqueda" style={styles.clearButton} onPress={clearDiscovery}><Text style={styles.clearButtonText}>Limpiar</Text></Pressable></View>}</View>
      {locationDenied ? <Pressable accessibilityRole="button" accessibilityLabel="Activar ubicación para calcular distancias reales" style={styles.locationHint} onPress={() => void loadLocation()}><Ionicons name="location-outline" size={14} color={colors.salsa} /><Text style={styles.locationHintText}>Activa ubicación para calcular distancias reales</Text></Pressable> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  authLoading: { flex: 1, backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  authLoadingText: { color: colors.textSecondary, fontSize: 13 },
  errorScreen: { flex: 1, backgroundColor: colors.background },
  topOverlay: { position: 'absolute', top: 62, left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  backButton: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.overlayStrong, alignItems: 'center', justifyContent: 'center', ...shadows.floating },
  mapTitle: { alignItems: 'center' },
  mapKicker: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, letterSpacing: typography.tracking.loose, fontWeight: typography.weight.semibold },
  mapHeading: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 20, fontWeight: typography.weight.semibold, marginTop: 2 },
  locate: { width: 44, height: 44, borderRadius: radii.md, backgroundColor: colors.overlayStrong, alignItems: 'center', justifyContent: 'center', ...shadows.floating },
  locateActive: { backgroundColor: colors.tortilla },
  searchBar: { position: 'absolute', top: 116, left: spacing.lg, right: spacing.lg, height: 48, borderRadius: radii.md, backgroundColor: colors.surfaceTranslucent, borderWidth: 1, borderColor: colors.border, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 13, gap: 9 },
  searchInput: { flex: 1, color: colors.textPrimary, fontFamily: typography.fontFamily.regular, fontSize: 13, paddingVertical: 0 },
  filters: { position: 'absolute', top: 169, left: 0, right: 0, maxHeight: 43 },
  filterContent: { paddingHorizontal: spacing.lg, gap: 8 },
  filter: { backgroundColor: colors.surfaceTranslucent, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 10, borderWidth: 1, borderColor: colors.border },
  filterActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  filterText: { color: colors.textPrimary, fontFamily: typography.fontFamily.medium, fontSize: 12, fontWeight: typography.weight.medium },
  filterTextActive: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold },
  radarPanel: { position: 'absolute', top: 220, left: spacing.lg, right: spacing.lg, backgroundColor: colors.surfaceTranslucent, borderWidth: 1, borderColor: colors.border, borderRadius: radii.lg, padding: spacing.md, zIndex: 5, ...shadows.floating },
  radarHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: spacing.sm },
  radarEyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, letterSpacing: typography.tracking.label, fontWeight: typography.weight.semibold },
  radarTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 17, fontWeight: typography.weight.semibold, marginTop: 3 },
  radarLabel: { color: colors.textTertiary, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, letterSpacing: 1.2, fontWeight: typography.weight.semibold, marginTop: spacing.sm, marginBottom: 7 },
  radarOptions: { gap: 7 },
  radarOption: { paddingHorizontal: 11, paddingVertical: 8, borderRadius: radii.pill, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surfaceElevated },
  radarOptionActive: { backgroundColor: colors.tortilla, borderColor: colors.tortilla },
  radarOptionText: { color: colors.textPrimary, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium },
  radarOptionTextActive: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold },
  searchAreaButton: { position: 'absolute', top: 220, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 9, zIndex: 6, ...shadows.card },
  searchAreaText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 11, fontWeight: typography.weight.semibold },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 230, backgroundColor: colors.overlayStrong, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, padding: spacing.lg, paddingBottom: 102, ...shadows.floating },
  sheetHandle: { width: 34, height: 4, borderRadius: 4, backgroundColor: colors.textTertiary, alignSelf: 'center', marginBottom: spacing.lg },
  sheetHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: spacing.md },
  sheetEyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, letterSpacing: typography.tracking.label, fontWeight: typography.weight.semibold, marginBottom: 5 },
  sheetTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 23, fontWeight: typography.weight.semibold, letterSpacing: -0.6 },
  magicButton: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 10, paddingVertical: 8 },
  magicButtonDisabled: { opacity: 0.35 },
  magicText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontWeight: typography.weight.semibold, fontSize: 10 },
  resultCard: { width: 230, backgroundColor: colors.surface, borderRadius: radii.lg, padding: spacing.md, marginRight: spacing.sm, ...shadows.card },
  resultTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  resultName: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 15, fontWeight: typography.weight.semibold, flex: 1 },
  resultMeta: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 11, marginTop: 7 },
  resultStyle: { color: colors.salsa, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium, marginTop: 13 },
  emptyResults: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radii.lg, backgroundColor: colors.surface, padding: spacing.md, ...shadows.card },
  emptyResultsCopy: { flex: 1 },
  emptyResultsTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  emptyResultsText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 10, lineHeight: 15, marginTop: 3 },
  proposeLink: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: 10, fontWeight: typography.weight.semibold, marginTop: 7 },
  loadingResults: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: radii.lg, backgroundColor: colors.surface, padding: spacing.md, ...shadows.card },
  loadingResultsText: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium },
  clearButton: { borderRadius: radii.pill, backgroundColor: colors.tortilla, paddingHorizontal: 11, paddingVertical: 8 },
  clearButtonText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 10, fontWeight: typography.weight.semibold },
  locationHint: { position: 'absolute', top: 220, left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surfaceTranslucent, borderRadius: radii.pill, paddingVertical: 9 },
  locationHintText: { color: colors.salsa, fontFamily: typography.fontFamily.medium, fontSize: 10, fontWeight: typography.weight.medium }
});
