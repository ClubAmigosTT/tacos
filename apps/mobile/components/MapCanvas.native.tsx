import MapView, { Callout, Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { memo, useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { Place } from '@/data/fixtures';
import { MapPin } from './MapPin';
import { normalizeRadarText } from '@/lib/radar';
import { colors } from '@/theme';

const mapStyle = [{ elementType: 'geometry', stylers: [{ color: colors.mapBase }] }, { elementType: 'labels.text.fill', stylers: [{ color: colors.mapLabel }] }, { elementType: 'labels.text.stroke', stylers: [{ color: colors.mapBase }] }, { featureType: 'road', elementType: 'geometry', stylers: [{ color: colors.mapRoad }] }, { featureType: 'water', elementType: 'geometry', stylers: [{ color: colors.mapWater }] }];

export const MapCanvas = memo(function MapCanvas({ places, active, tacoName, onSelect, userCoordinates, onRegionChangeComplete }: { places: Place[]; active: string; tacoName?: string; onSelect: (id: string) => void; userCoordinates?: { latitude: number; longitude: number }; onRegionChangeComplete?: (coordinates: { latitude: number; longitude: number }) => void }) {
  const mapRef = useRef<MapView>(null);
  const initialRegion = userCoordinates ? { ...userCoordinates, latitudeDelta: 0.04, longitudeDelta: 0.04 } : { latitude: 19.402, longitude: -99.163, latitudeDelta: 0.065, longitudeDelta: 0.065 };
  useEffect(() => { if (userCoordinates) mapRef.current?.animateToRegion({ ...userCoordinates, latitudeDelta: 0.04, longitudeDelta: 0.04 }, 450); }, [userCoordinates?.latitude, userCoordinates?.longitude]);
  // The screen decides whether the current query is actually taco-specific.
  // Do not infer Pastor from the visual filter here: a neighborhood search
  // may leave that filter selected while pins should show branch ratings.
  const ratingTaco = tacoName;
  return <MapView ref={mapRef} provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined} style={StyleSheet.absoluteFill} initialRegion={initialRegion} showsUserLocation={Boolean(userCoordinates)} showsMyLocationButton={Platform.OS === 'android'} customMapStyle={Platform.OS === 'android' ? mapStyle : undefined} mapType={Platform.OS === 'ios' ? 'mutedStandard' : 'standard'} userInterfaceStyle={Platform.OS === 'ios' ? 'dark' : undefined} accessibilityLabel="Mapa de taquerías" onRegionChangeComplete={(region) => onRegionChangeComplete?.({ latitude: region.latitude, longitude: region.longitude })}>{places.map((place) => { const taco = ratingTaco ? place.tacos.find((item) => normalizeRadarText(item.name) === normalizeRadarText(ratingTaco)) : undefined; const tacoLabel = taco ? `${taco.name} ${taco.rating > 0 ? taco.rating.toFixed(1) : '—'}` : undefined; const pinLabel = active === '92% para mí' ? (place.match != null ? `${place.match}%` : '—') : tacoLabel ?? (place.rating > 0 ? place.rating.toFixed(1) : '—'); const markerLabel = `${place.name}, ${pinLabel}, ${place.distance}`; return <Marker key={`${place.id}-${active}-${pinLabel}`} coordinate={place.coordinates} tracksViewChanges={false} title={place.name} description={`${pinLabel} · ${place.distance}`} accessibilityLabel={`Abrir ${markerLabel}`} onPress={() => onSelect(place.id)} onCalloutPress={() => onSelect(place.id)}><MapPin label={pinLabel} accent={active === '92% para mí'} /><Callout tooltip><View accessible accessibilityRole="button" accessibilityLabel={`Abrir ${markerLabel}`} style={styles.callout}><Text style={styles.calloutName}>{place.name}</Text><Text style={styles.calloutDetail}>{pinLabel} · {place.distance}</Text><Text style={styles.calloutAction}>Abrir ficha</Text></View></Callout></Marker>; })}</MapView>;
});

const styles = StyleSheet.create({
  callout: { minWidth: 180, maxWidth: 260, backgroundColor: colors.surface, borderRadius: 12, padding: 12 },
  calloutName: { color: colors.textPrimary, fontSize: 14, fontWeight: '600' },
  calloutDetail: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },
  calloutAction: { color: colors.tortilla, fontSize: 11, fontWeight: '600', marginTop: 8 }
});
