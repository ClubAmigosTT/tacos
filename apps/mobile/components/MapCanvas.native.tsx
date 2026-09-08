import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { StyleSheet, Text, View } from 'react-native';
import type { Place } from '@/data/fixtures';
import { colors } from '@/theme';

const mapStyle = [{ elementType: 'geometry', stylers: [{ color: '#202522' }] }, { elementType: 'labels.text.fill', stylers: [{ color: '#8f9a91' }] }, { elementType: 'labels.text.stroke', stylers: [{ color: '#202522' }] }, { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#303833' }] }, { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#101614' }] }];

export function MapCanvas({ places, active, onSelect }: { places: Place[]; active: string; onSelect: (id: string) => void }) {
  return <MapView provider={PROVIDER_GOOGLE} style={StyleSheet.absoluteFill} initialRegion={{ latitude: 19.402, longitude: -99.163, latitudeDelta: 0.065, longitudeDelta: 0.065 }} customMapStyle={mapStyle}>{places.map((place) => <Marker key={place.id} coordinate={place.coordinates} onPress={() => onSelect(place.id)}><View style={[styles.pin, active === '92% para mí' && styles.pinAccent]}><Text style={[styles.pinText, active === '92% para mí' && styles.pinTextAccent]}>{active === 'Pastor' ? place.tacos.find((taco) => taco.name === 'Pastor')?.rating.toFixed(1) ?? place.rating.toFixed(1) : place.rating.toFixed(1)}</Text></View></Marker>)}</MapView>;
}

const styles = StyleSheet.create({
  pin: { minWidth: 44, height: 32, borderRadius: 18, paddingHorizontal: 8, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  pinAccent: { backgroundColor: colors.accent, borderColor: colors.background },
  pinText: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  pinTextAccent: { color: colors.background }
});
