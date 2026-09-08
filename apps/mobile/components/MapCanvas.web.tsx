import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { Place } from '@/data/fixtures';
import { colors } from '@/theme';

export function MapCanvas({ places, active, onSelect }: { places: Place[]; active: string; onSelect: (id: string) => void }) {
  return <View style={styles.webMap}><View style={styles.roadOne} /><View style={styles.roadTwo} /><View style={styles.roadThree} /><Text style={[styles.label, { top: '25%', left: '19%' }]}>NARVARTE</Text><Text style={[styles.label, { top: '44%', left: '57%' }]}>ROMA SUR</Text><Text style={[styles.label, { top: '67%', left: '72%' }]}>CONDESA</Text>{places.map((place, index) => <Pressable key={place.id} onPress={() => onSelect(place.id)} style={[styles.pinPosition, { top: `${31 + index * 16}%`, left: `${29 + index * 22}%` }]}><View style={[styles.pin, active === '92% para mí' && styles.pinAccent]}><Text style={[styles.pinText, active === '92% para mí' && styles.pinTextAccent]}>{active === 'Pastor' ? place.tacos.find((taco) => taco.name === 'Pastor')?.rating.toFixed(1) ?? place.rating.toFixed(1) : place.rating.toFixed(1)}</Text></View></Pressable>)}</View>;
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
