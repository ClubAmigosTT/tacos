import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Place } from '@/data/fixtures';
import { colors } from '@/theme';

const mapBounds = { north: 19.43, south: 19.37, west: -99.19, east: -99.14 };

function pinPosition(place: Place) {
  const horizontal = (place.coordinates.longitude - mapBounds.west) / (mapBounds.east - mapBounds.west);
  const vertical = (mapBounds.north - place.coordinates.latitude) / (mapBounds.north - mapBounds.south);
  const left = Math.max(12, Math.min(88, 12 + horizontal * 76));
  const top = Math.max(22, Math.min(78, 22 + vertical * 56));
  return { top: `${top}%`, left: `${left}%` } as const;
}

export function MapCanvas({ places, active, tacoName, onSelect }: { places: Place[]; active: string; tacoName?: string; onSelect: (id: string) => void; userCoordinates?: { latitude: number; longitude: number }; onRegionChangeComplete?: (coordinates: { latitude: number; longitude: number }) => void }) {
  const ratingTaco = tacoName ?? (active === 'Pastor' ? 'Pastor' : undefined);
  return <View style={styles.webMap}><View style={styles.roadOne} /><View style={styles.roadTwo} /><View style={styles.roadThree} /><Text style={[styles.label, { top: '25%', left: '19%' }]}>NARVARTE</Text><Text style={[styles.label, { top: '44%', left: '57%' }]}>ROMA SUR</Text><Text style={[styles.label, { top: '67%', left: '72%' }]}>CONDESA</Text>{places.map((place) => { const taco = ratingTaco ? place.tacos.find((item) => item.name.toLowerCase() === ratingTaco.toLowerCase()) : undefined; const pinLabel = active === '92% para mí' ? `${place.match}%` : taco ? `${taco.name} ${taco.rating.toFixed(1)}` : place.rating.toFixed(1); return <Pressable key={place.id} onPress={() => onSelect(place.id)} style={[styles.pinPosition, pinPosition(place)]}><View style={[styles.pin, active === '92% para mí' && styles.pinAccent]}><Text style={[styles.pinText, active === '92% para mí' && styles.pinTextAccent]}>{pinLabel}</Text></View></Pressable>; })}</View>;
}

const styles = StyleSheet.create({
  webMap: { ...StyleSheet.absoluteFill, backgroundColor: '#151B18', overflow: 'hidden' },
  roadOne: { position: 'absolute', width: '145%', height: 1, backgroundColor: '#354039', top: '42%', left: '-15%', transform: [{ rotate: '-18deg' }] },
  roadTwo: { position: 'absolute', width: '145%', height: 1, backgroundColor: '#354039', top: '66%', left: '-13%', transform: [{ rotate: '21deg' }] },
  roadThree: { position: 'absolute', width: 1, height: '130%', backgroundColor: '#354039', top: '-15%', left: '49%', transform: [{ rotate: '17deg' }] },
  label: { position: 'absolute', color: '#718077', fontSize: 11, fontWeight: '900', letterSpacing: 2 },
  pinPosition: { position: 'absolute' },
  pin: { minWidth: 44, height: 32, borderRadius: 18, paddingHorizontal: 8, backgroundColor: colors.surface, borderWidth: 2, borderColor: colors.ink, alignItems: 'center', justifyContent: 'center' },
  pinAccent: { backgroundColor: colors.accent, borderColor: colors.background },
  pinText: { color: colors.ink, fontSize: 12, fontWeight: '900' },
  pinTextAccent: { color: colors.background }
});
