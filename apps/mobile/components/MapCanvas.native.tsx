import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import type { Place } from '@/data/fixtures';
import { colors } from '@/theme';

const mapStyle = [{ elementType: 'geometry', stylers: [{ color: '#202522' }] }, { elementType: 'labels.text.fill', stylers: [{ color: '#8f9a91' }] }, { elementType: 'labels.text.stroke', stylers: [{ color: '#202522' }] }, { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#303833' }] }, { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#101614' }] }];

export function MapCanvas({ places, active, onSelect, userCoordinates, onRegionChangeComplete }: { places: Place[]; active: string; onSelect: (id: string) => void; userCoordinates?: { latitude: number; longitude: number }; onRegionChangeComplete?: (coordinates: { latitude: number; longitude: number }) => void }) {
  const mapRef = useRef<MapView>(null);
  const initialRegion = userCoordinates ? { ...userCoordinates, latitudeDelta: 0.04, longitudeDelta: 0.04 } : { latitude: 19.402, longitude: -99.163, latitudeDelta: 0.065, longitudeDelta: 0.065 };
  useEffect(() => { if (userCoordinates) mapRef.current?.animateToRegion({ ...userCoordinates, latitudeDelta: 0.04, longitudeDelta: 0.04 }, 450); }, [userCoordinates?.latitude, userCoordinates?.longitude]);
  return <MapView ref={mapRef} {...(Platform.OS === 'android' ? { provider: PROVIDER_GOOGLE } : {})} style={StyleSheet.absoluteFill} initialRegion={initialRegion} showsUserLocation={Boolean(userCoordinates)} showsMyLocationButton={Platform.OS === 'android'} customMapStyle={mapStyle} onRegionChangeComplete={(region) => onRegionChangeComplete?.({ latitude: region.latitude, longitude: region.longitude })}>{places.map((place) => <Marker key={place.id} coordinate={place.coordinates} onPress={() => onSelect(place.id)}><View style={[styles.pin, active === '92% para mí' && styles.pinAccent]}><Text style={[styles.pinText, active === '92% para mí' && styles.pinTextAccent]}>{active === 'Pastor' ? place.tacos.find((taco) => taco.name === 'Pastor')?.rating.toFixed(1) ?? place.rating.toFixed(1) : place.rating.toFixed(1)}</Text></View></Marker>)}</MapView>;
}

const styles = StyleSheet.create({
  pin: { minWidth: 44, height: 32, borderRadius: 18, paddingHorizontal: 8, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  pinAccent: { backgroundColor: colors.accent, borderColor: colors.background },
  pinText: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  pinTextAccent: { color: colors.background }
});
