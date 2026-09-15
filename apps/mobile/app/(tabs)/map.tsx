import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { router, useIsFocused, useLocalSearchParams, usePathname } from 'expo-router';
import { useQuery } from '@tanstack/react-query';
import * as Location from 'expo-location';
import { Animated, FlatList, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { discover, isDemoMode, trackEvent } from '@/lib/api';
import { localDiscover, places } from '@/lib/localCatalog';
import { colors, radii, shadows, spacing, typography } from '@/theme';
import { RatingBadge } from '@/components/RatingBadge';
import { MapCanvas } from '@/components/MapCanvas';
import { AsyncErrorState } from '@/components/AsyncErrorState';
import { CatalogImage } from '@/components/CatalogImage';
import { useAuth } from '@/lib/auth';
import { isDisplayablePlace, searchEvidence, searchEvidenceLabel } from '@/lib/catalogQuality';

const filters = ['Todos', 'Abierto ahora', 'Barato'] as const;
type MapFilter = (typeof filters)[number];

const defaultMapCenter = { latitude: 19.402, longitude: -99.163 };

export default function MapScreen() {
  const { token, loading: authLoading } = useAuth();
  const isFocused = useIsFocused();
  const pathname = usePathname();
  const isVisible = isFocused || pathname === '/map' || pathname.endsWith('/map');
  const { q: initialQuery } = useLocalSearchParams<{ q?: string }>();
  const [active, setActive] = useState<MapFilter>('Todos');
  const [search, setSearch] = useState(initialQuery ?? '');
  const [searchQuery, setSearchQuery] = useState(initialQuery ?? '');
  const [coordinates, setCoordinates] = useState<{ latitude: number; longitude: number }>();
  const [searchCenter, setSearchCenter] = useState<{ latitude: number; longitude: number }>();
  const [pendingMapCenter, setPendingMapCenter] = useState<{ latitude: number; longitude: number }>();
  const [mapMoved, setMapMoved] = useState(false);
  const [locationDenied, setLocationDenied] = useState(false);
  const [sheetCollapsed, setSheetCollapsed] = useState(false);
  const sheetTransition = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(sheetTransition, {
      toValue: sheetCollapsed ? 1 : 0,
      duration: 220,
      useNativeDriver: Platform.OS !== 'web'
    }).start();
  }, [sheetCollapsed, sheetTransition]);

  useEffect(() => {
    if (initialQuery != null) setSearch(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    const timer = setTimeout(() => setSearchQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);

  async function loadLocation() {
    try {
      const permission = await Location.requestForegroundPermissionsAsync();
      if (permission.status !== Location.PermissionStatus.GRANTED) {
        setLocationDenied(true);
        return;
      }
      const current = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoordinates({ latitude: current.coords.latitude, longitude: current.coords.longitude });
      setSearchCenter(undefined);
      setPendingMapCenter(undefined);
      setMapMoved(false);
      setLocationDenied(false);
    } catch {
      setLocationDenied(true);
    }
  }

  useEffect(() => {
    if (Platform.OS !== 'web' && isVisible) void loadLocation();
  }, [isVisible]);

  const searchCoordinates = searchCenter ?? coordinates;
  const handleMapRegionChange = useCallback((next: { latitude: number; longitude: number }) => {
    const baseline = searchCoordinates ?? defaultMapCenter;
    const moved = Math.abs(next.latitude - baseline.latitude) > 0.002 || Math.abs(next.longitude - baseline.longitude) > 0.002;
    if (moved) {
      setPendingMapCenter(next);
      setMapMoved(true);
    } else {
      setPendingMapCenter(undefined);
      setMapMoved(false);
    }
  }, [searchCoordinates]);

  const handlePlaceSelect = useCallback((id: string) => {
    router.push(`/place/${id}`);
  }, []);

  const discoveryQuery = {
    q: searchQuery,
    lat: searchCoordinates?.latitude,
    lng: searchCoordinates?.longitude,
    radiusKm: searchCoordinates ? 8 : undefined,
    openNow: active === 'Abierto ahora' ? true : undefined,
    limit: 50
  };
  const { data, isLoading: discoverLoading, isError: discoverError, refetch: refetchDiscover } = useQuery({
    queryKey: ['discover', 'map', searchQuery, searchCoordinates?.latitude, searchCoordinates?.longitude, active, token],
    queryFn: ({ signal }) => discover(discoveryQuery, token, signal),
    initialData: () => localDiscover(discoveryQuery),
    enabled: !authLoading && isVisible
  });
  const renderMapResult = useCallback(({ item }: { item: (typeof places)[number] }) => <MapResultCard place={item} onPress={handlePlaceSelect} />, [handlePlaceSelect]);

  // The small bundled fallback remains useful while the API wakes up or the
  // device is offline. Fixtures are only a deliberate demo-mode fallback.
  const rawDiscoveryPlaces = data ?? (isDemoMode() ? places : []);
  const discoveryPlaces = useMemo(() => rawDiscoveryPlaces
    .filter(isDisplayablePlace)
    .map((place) => ({ ...place, searchEvidence: searchEvidence(place, searchQuery) })), [rawDiscoveryPlaces, searchQuery]);
  const sorted = useMemo(() => {
    if (active !== 'Barato') return discoveryPlaces;

    // Catalog prices are sparse. Unknown prices remain visible; this filter
    // only excludes places whose known minimum is above the affordable range.
    return discoveryPlaces.filter((place) => {
      const prices = [
        place.priceMin,
        place.priceMax,
        ...place.tacos.map((taco) => taco.price)
      ].filter((price): price is number => typeof price === 'number' && Number.isFinite(price) && price > 0);
      return !prices.length || Math.min(...prices) <= 24;
    });
  }, [active, discoveryPlaces]);

  const hasFreeTextSearch = searchQuery.trim().length > 0;
  const sheetTitle = discoverLoading
    ? 'Actualizando tu mapa…'
    : hasFreeTextSearch
      ? `Resultados para "${searchQuery.trim()}"`
      : active === 'Todos'
        ? 'Taquerías cerca de ti'
        : active;

  if (!isVisible) return <View style={styles.screen} />;
  if (authLoading) {
    return <View style={styles.authLoading}><Text style={styles.authLoadingText}>Preparando tu mapa…</Text></View>;
  }

  if (discoverError && !isDemoMode() && !data?.length) {
    return <View style={styles.errorScreen}><AsyncErrorState title="No pudimos actualizar tu mapa" detail="Revisa la conexión para ver sucursales reales del catálogo." onAction={() => void refetchDiscover()} /></View>;
  }

  function clearDiscovery() {
    setActive('Todos');
    setSearch('');
    setSearchQuery('');
    setSearchCenter(undefined);
    setPendingMapCenter(undefined);
    setMapMoved(false);
    setSheetCollapsed(false);
  }

  return (
    <View style={styles.screen}>
      <MapCanvas places={sorted} active={active} onSelect={handlePlaceSelect} userCoordinates={coordinates} onRegionChangeComplete={handleMapRegionChange} />

      <View style={styles.topOverlay}>
        <Pressable accessibilityRole="button" accessibilityLabel="Volver" style={styles.backButton} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={22} color={colors.textPrimary} />
        </Pressable>
        <View style={styles.mapTitle}>
          <Text style={styles.mapKicker}>EXPLORAR</Text>
          <Text style={styles.mapHeading}>Cerca de ti</Text>
        </View>
        <Pressable accessibilityRole="button" accessibilityLabel="Usar mi ubicación" style={[styles.locate, coordinates && styles.locateActive]} onPress={() => void loadLocation()}>
          <Ionicons name="navigate" size={18} color={coordinates ? colors.meatDark : colors.textPrimary} />
        </Pressable>
      </View>

      <View style={styles.searchBar}>
        <Ionicons name="search" size={17} color={colors.textSecondary} />
        <TextInput
          accessibilityLabel="Buscar taquerías, tacos o zonas"
          value={search}
          onChangeText={setSearch}
          onSubmitEditing={() => {
            setSearchQuery(search.trim());
            void trackEvent('map_search', { query_length: search.trim().length }, token);
          }}
          placeholder="Busca una taquería o zona…"
          placeholderTextColor={colors.textSecondary}
          style={styles.searchInput}
          returnKeyType="search"
        />
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.filters} contentContainerStyle={styles.filterContent}>
        {filters.map((filter) => {
          const selected = filter === active;
          return (
            <Pressable
              key={filter}
              accessibilityRole="button"
              accessibilityLabel={`Filtrar por ${filter}`}
              accessibilityState={{ selected }}
              onPress={() => {
                setActive(filter);
                void trackEvent('map_filter', { filter }, token);
              }}
              style={[styles.filter, selected && styles.filterActive]}
            >
              <Text style={[styles.filterText, selected && styles.filterTextActive]}>{filter}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {mapMoved && pendingMapCenter ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Buscar en esta zona"
          style={styles.searchAreaButton}
          onPress={() => {
            setSearchCenter(pendingMapCenter);
            setPendingMapCenter(undefined);
            setMapMoved(false);
            void trackEvent('map_filter', { filter: 'search_area' }, token);
          }}
        >
          <Ionicons name="search" size={14} color={colors.background} />
          <Text style={styles.searchAreaText}>Buscar en esta zona</Text>
        </Pressable>
      ) : null}

      <View style={[styles.sheet, sheetCollapsed && styles.sheetCollapsed]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={sheetCollapsed ? 'Mostrar lugares' : 'Reducir lista de lugares'}
          accessibilityState={{ expanded: !sheetCollapsed }}
          style={styles.sheetHandleButton}
          onPress={() => setSheetCollapsed((value) => !value)}
        >
          <View style={styles.sheetHandle} />
          <Ionicons name={sheetCollapsed ? 'chevron-up' : 'chevron-down'} size={15} color={colors.textTertiary} />
        </Pressable>

        {sheetCollapsed ? (
          <Animated.View style={{ opacity: sheetTransition }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Expandir lugares de la zona" style={styles.collapsedSummary} onPress={() => setSheetCollapsed(false)}>
              <View style={styles.collapsedCopy}>
                <Text style={styles.sheetEyebrow}>{discoverLoading ? 'BUSCANDO EN EL CATÁLOGO' : `${sorted.length} LUGARES EN ESTA ZONA`}</Text>
                <Text style={styles.collapsedTitle} numberOfLines={1}>{sheetTitle}</Text>
              </View>
              <Ionicons name="chevron-up" size={18} color={colors.tortilla} />
            </Pressable>
          </Animated.View>
        ) : (
          <Animated.View style={{ opacity: sheetTransition.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }) }}>
            <View style={styles.sheetHeader}>
              <View style={styles.sheetHeaderCopy}>
                <Text style={styles.sheetEyebrow}>{discoverLoading ? 'BUSCANDO EN EL CATÁLOGO' : `${sorted.length} LUGARES EN ESTA ZONA`}</Text>
                <Text style={styles.sheetTitle}>{sheetTitle}</Text>
              </View>
            </View>

            {discoverLoading ? (
              <View style={styles.loadingResults}>
                <Ionicons name="sync-outline" size={18} color={colors.tortilla} />
                <Text style={styles.loadingResultsText}>Consultando el catálogo de Tacos…</Text>
              </View>
            ) : sorted.length ? (
              <FlatList
                data={sorted}
                horizontal
                keyExtractor={(place) => place.id}
                renderItem={renderMapResult}
                showsHorizontalScrollIndicator={false}
                initialNumToRender={4}
                maxToRenderPerBatch={4}
                windowSize={3}
                style={styles.resultsList}
              />
            ) : (
              <View style={styles.emptyResults}>
                <Ionicons name="moon-outline" size={21} color={colors.salsa} />
                <View style={styles.emptyResultsCopy}>
                  <Text style={styles.emptyResultsTitle}>No hay lugares con este criterio</Text>
                  <Text style={styles.emptyResultsText}>Prueba otra zona o quita el filtro para seguir explorando.</Text>
                  <Pressable accessibilityRole="button" accessibilityLabel="Proponer una taquería que no aparece" onPress={() => router.push({ pathname: '/catalog-proposal', params: { kind: 'branch' } })}>
                    <Text style={styles.proposeLink}>¿Falta una taquería? Agrégala</Text>
                  </Pressable>
                </View>
                <Pressable accessibilityRole="button" accessibilityLabel="Limpiar filtros y búsqueda" style={styles.clearButton} onPress={clearDiscovery}>
                  <Text style={styles.clearButtonText}>Limpiar</Text>
                </Pressable>
              </View>
            )}
          </Animated.View>
        )}
      </View>

      {locationDenied ? (
        <Pressable accessibilityRole="button" accessibilityLabel="Activar ubicación para calcular distancias reales" style={styles.locationHint} onPress={() => void loadLocation()}>
          <Ionicons name="location-outline" size={14} color={colors.salsa} />
          <Text style={styles.locationHintText}>Activa ubicación para calcular distancias reales</Text>
        </Pressable>
      ) : null}
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
  searchAreaButton: { position: 'absolute', top: 220, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.tortilla, borderRadius: radii.pill, paddingHorizontal: 14, paddingVertical: 9, zIndex: 6, ...shadows.card },
  searchAreaText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 11, fontWeight: typography.weight.semibold },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, minHeight: 230, backgroundColor: colors.overlayStrong, borderTopLeftRadius: radii.lg, borderTopRightRadius: radii.lg, padding: spacing.lg, paddingBottom: 102, ...shadows.floating },
  sheetCollapsed: { minHeight: 94, paddingTop: 6, paddingBottom: 74 },
  sheetHandleButton: { height: 27, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7, marginBottom: 2 },
  sheetHandle: { width: 34, height: 4, borderRadius: 4, backgroundColor: colors.textTertiary },
  collapsedSummary: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  collapsedCopy: { flex: 1 },
  collapsedTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 18, fontWeight: typography.weight.semibold, letterSpacing: -0.3 },
  sheetHeader: { flexDirection: 'row', alignItems: 'flex-end', marginBottom: spacing.md },
  sheetHeaderCopy: { flex: 1 },
  sheetEyebrow: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: typography.size.micro, letterSpacing: typography.tracking.label, fontWeight: typography.weight.semibold, marginBottom: 5 },
  sheetTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 23, fontWeight: typography.weight.semibold, letterSpacing: -0.6 },
  resultCard: { width: 230, backgroundColor: colors.surface, borderRadius: radii.lg, overflow: 'hidden', marginRight: spacing.sm, ...shadows.card },
  resultImage: { width: '100%', height: 88, backgroundColor: colors.surfaceRaised },
  resultBody: { padding: spacing.md },
  resultTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6 },
  resultName: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 15, fontWeight: typography.weight.semibold, flex: 1 },
  resultMeta: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 11, marginTop: 7 },
  resultBottom: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginTop: 13 },
  resultStyle: { color: colors.salsa, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium, flex: 1 },
  reviewLabel: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: 9, fontWeight: typography.weight.semibold },
  emptyResults: { flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: radii.lg, backgroundColor: colors.surface, padding: spacing.md, ...shadows.card },
  emptyResultsCopy: { flex: 1 },
  emptyResultsTitle: { color: colors.textPrimary, fontFamily: typography.fontFamily.semibold, fontSize: 12, fontWeight: typography.weight.semibold },
  emptyResultsText: { color: colors.textSecondary, fontFamily: typography.fontFamily.regular, fontSize: 10, lineHeight: 15, marginTop: 3 },
  proposeLink: { color: colors.tortilla, fontFamily: typography.fontFamily.semibold, fontSize: 10, fontWeight: typography.weight.semibold, marginTop: 7 },
  loadingResults: { flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: radii.lg, backgroundColor: colors.surface, padding: spacing.md, ...shadows.card },
  loadingResultsText: { color: colors.textSecondary, fontFamily: typography.fontFamily.medium, fontSize: 11, fontWeight: typography.weight.medium },
  resultsList: { height: 181 },
  clearButton: { borderRadius: radii.pill, backgroundColor: colors.tortilla, paddingHorizontal: 11, paddingVertical: 8 },
  clearButtonText: { color: colors.meatDark, fontFamily: typography.fontFamily.semibold, fontSize: 10, fontWeight: typography.weight.semibold },
  locationHint: { position: 'absolute', top: 220, left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, backgroundColor: colors.surfaceTranslucent, borderRadius: radii.pill, paddingVertical: 9 },
  locationHintText: { color: colors.salsa, fontFamily: typography.fontFamily.medium, fontSize: 10, fontWeight: typography.weight.medium }
});

function MapResultCard({ place, onPress }: { place: (typeof places)[number]; onPress: (id: string) => void }) {
  const evidenceLabel = searchEvidenceLabel(place.searchEvidence);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${place.name}, ${place.rating > 0 ? place.rating.toFixed(1) : 'sin calificación'}, ${place.distance}`}
      style={styles.resultCard}
      onPress={() => onPress(place.id)}
    >
      <CatalogImage uri={place.image} fallbackLabel="Imagen ilustrativa" accessibilityLabel={`Imagen de ${place.name}`} style={styles.resultImage} />
      <View style={styles.resultBody}>
        <View style={styles.resultTop}>
          <Text style={styles.resultName} numberOfLines={1}>{place.name}</Text>
          <RatingBadge rating={place.rating} />
        </View>
        <Text style={styles.resultMeta}>{place.neighborhood} · {place.distance}</Text>
        <View style={styles.resultBottom}>
          <Text style={styles.resultStyle}>{place.style}</Text>
          {evidenceLabel ? <Text style={styles.reviewLabel}>{evidenceLabel}</Text> : place.catalogStatus === 'needs_review' ? <Text style={styles.reviewLabel}>Por verificar</Text> : null}
        </View>
      </View>
    </Pressable>
  );
}
