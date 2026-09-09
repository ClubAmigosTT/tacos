import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { useEffect, useRef } from 'react';
import { Platform, StyleSheet } from 'react-native';
import type { Place } from '@/data/fixtures';
import { MapPin } from './MapPin';

const mapStyle = [{ elementType: 'geometry', stylers: [{ color: '#202522' }] }, { elementType: 'labels.text.fill', stylers: [{ color: '#8f9a91' }] }, { elementType: 'labels.text.stroke', stylers: [{ color: '#202522' }] }, { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#303833' }] }, { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#101614' }] }];

export function MapCanvas({ places, active, tacoName, onSelect, userCoordinates, onRegionChangeComplete }: { places: Place[]; active: string; tacoName?: string; onSelect: (id: string) => void; userCoordinates?: { latitude: number; longitude: number }; onRegionChangeComplete?: (coordinates: { latitude: number; longitude: number }) => void }) {
  const mapRef = useRef<MapView>(null);
  const initialRegion = userCoordinates ? { ...userCoordinates, latitudeDelta: 0.04, longitudeDelta: 0.04 } : { latitude: 19.402, longitude: -99.163, latitudeDelta: 0.065, longitudeDelta: 0.065 };
  useEffect(() => { if (userCoordinates) mapRef.current?.animateToRegion({ ...userCoordinates, latitudeDelta: 0.04, longitudeDelta: 0.04 }, 450); }, [userCoordinates?.latitude, userCoordinates?.longitude]);
  const ratingTaco = tacoName ?? (active === 'Pastor' ? 'Pastor' : undefined);
  return <MapView ref={mapRef} {...(Platform.OS === 'android' ? { provider: PROVIDER_GOOGLE } : {})} style={StyleSheet.absoluteFill} initialRegion={initialRegion} showsUserLocation={Boolean(userCoordinates)} showsMyLocationButton={Platform.OS === 'android'} customMapStyle={mapStyle} accessibilityLabel="Mapa de taquerías" onRegionChangeComplete={(region) => onRegionChangeComplete?.({ latitude: region.latitude, longitude: region.longitude })}>{places.map((place) => { const taco = ratingTaco ? place.tacos.find((item) => item.name.toLowerCase() === ratingTaco.toLowerCase()) : undefined; const pinLabel = active === '92% para mí' ? `${place.match}%` : taco ? `${taco.name} ${taco.rating.toFixed(1)}` : place.rating.toFixed(1); return <Marker key={place.id} coordinate={place.coordinates} accessibilityLabel={`Abrir ${place.name}, ${pinLabel}`} onPress={() => onSelect(place.id)}><MapPin label={pinLabel} accent={active === '92% para mí'} /></Marker>; })}</MapView>;
}
