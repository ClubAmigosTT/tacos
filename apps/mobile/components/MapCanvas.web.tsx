import { PanResponder, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useEffect, useRef, useState } from 'react';
import type { Place } from '@/data/fixtures';
import { MapPin } from './MapPin';
import { normalizeRadarText } from '@/lib/radar';
import { colors, typography } from '@/theme';

const mapBounds = { north: 19.43, south: 19.37, west: -99.19, east: -99.14 };
const defaultCenter = { latitude: 19.402, longitude: -99.163 };

function pinPosition(place: Place) {
  const horizontal = (place.coordinates.longitude - mapBounds.west) / (mapBounds.east - mapBounds.west);
  const vertical = (mapBounds.north - place.coordinates.latitude) / (mapBounds.north - mapBounds.south);
  const left = Math.max(12, Math.min(88, 12 + horizontal * 76));
  const top = Math.max(22, Math.min(78, 22 + vertical * 56));
  return { top: `${top}%`, left: `${left}%` } as const;
}

export function MapCanvas({ places, active, tacoName, onSelect, userCoordinates, onRegionChangeComplete }: { places: Place[]; active: string; tacoName?: string; onSelect: (id: string) => void; userCoordinates?: { latitude: number; longitude: number }; onRegionChangeComplete?: (coordinates: { latitude: number; longitude: number }) => void }) {
  const viewport = useWindowDimensions();
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const panRef = useRef(pan);
  const dragStartRef = useRef(pan);
  const originRef = useRef(defaultCenter);
  const previousUserCoordinates = useRef<string | undefined>(undefined);
  const viewportRef = useRef(viewport);
  const regionChangeRef = useRef(onRegionChangeComplete);
  viewportRef.current = viewport;
  regionChangeRef.current = onRegionChangeComplete;
  const userCoordinatesKey = userCoordinates ? `${userCoordinates.latitude}:${userCoordinates.longitude}` : '';
  useEffect(() => {
    if (!userCoordinatesKey || previousUserCoordinates.current === userCoordinatesKey) return;
    previousUserCoordinates.current = userCoordinatesKey;
    originRef.current = userCoordinates ?? defaultCenter;
    panRef.current = { x: 0, y: 0 };
    setPan({ x: 0, y: 0 });
  }, [userCoordinatesKey]);
  const panResponder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_event, gestureState) => Math.abs(gestureState.dx) > 4 || Math.abs(gestureState.dy) > 4,
    onPanResponderGrant: () => { dragStartRef.current = panRef.current; },
    onPanResponderMove: (_event, gestureState) => {
      const currentViewport = viewportRef.current;
      const next = {
        x: Math.max(-currentViewport.width * 0.42, Math.min(currentViewport.width * 0.42, dragStartRef.current.x + gestureState.dx)),
        y: Math.max(-currentViewport.height * 0.28, Math.min(currentViewport.height * 0.28, dragStartRef.current.y + gestureState.dy))
      };
      panRef.current = next;
      setPan(next);
    },
    onPanResponderRelease: () => {
      const currentViewport = viewportRef.current;
      const next = panRef.current;
      const longitude = originRef.current.longitude - (next.x / Math.max(currentViewport.width, 1)) * (mapBounds.east - mapBounds.west);
      const latitude = originRef.current.latitude + (next.y / Math.max(currentViewport.height, 1)) * (mapBounds.north - mapBounds.south);
      regionChangeRef.current?.({ latitude, longitude });
    }
  })).current;
  // The screen decides whether the current query is actually taco-specific.
  // Do not infer Pastor from the visual filter here: a neighborhood search
  // may leave that filter selected while pins should show branch ratings.
  const ratingTaco = tacoName;
  return <View accessibilityRole="adjustable" accessibilityLabel="Mapa de taquerías; arrastra para explorar" style={styles.webMap} {...panResponder.panHandlers}><View style={[styles.mapContent, { transform: [{ translateX: pan.x }, { translateY: pan.y }] }]}><View style={styles.roadOne} /><View style={styles.roadTwo} /><View style={styles.roadThree} /><Text style={[styles.label, { top: '25%', left: '19%' }]}>NARVARTE</Text><Text style={[styles.label, { top: '44%', left: '57%' }]}>ROMA SUR</Text><Text style={[styles.label, { top: '67%', left: '72%' }]}>CONDESA</Text>{places.map((place) => { const taco = ratingTaco ? place.tacos.find((item) => normalizeRadarText(item.name) === normalizeRadarText(ratingTaco)) : undefined; const tacoLabel = taco ? `${taco.name} ${taco.rating > 0 ? taco.rating.toFixed(1) : '—'}` : undefined; const pinLabel = active === '92% para mí' ? (place.match != null ? `${place.match}%` : '—') : tacoLabel ?? (place.rating > 0 ? place.rating.toFixed(1) : '—'); return <Pressable key={place.id} accessibilityRole="button" accessibilityLabel={`Abrir ${place.name}, ${pinLabel}`} onPress={() => onSelect(place.id)} style={[styles.pinPosition, pinPosition(place)]}><MapPin label={pinLabel} accent={active === '92% para mí'} /></Pressable>; })}</View></View>;
}

const styles = StyleSheet.create({
  webMap: { ...StyleSheet.absoluteFill, backgroundColor: colors.mapBase, overflow: 'hidden' },
  mapContent: { ...StyleSheet.absoluteFill },
  roadOne: { position: 'absolute', width: '145%', height: 1, backgroundColor: colors.mapRoad, top: '42%', left: '-15%', transform: [{ rotate: '-18deg' }] },
  roadTwo: { position: 'absolute', width: '145%', height: 1, backgroundColor: colors.mapRoad, top: '66%', left: '-13%', transform: [{ rotate: '21deg' }] },
  roadThree: { position: 'absolute', width: 1, height: '130%', backgroundColor: colors.mapRoad, top: '-15%', left: '49%', transform: [{ rotate: '17deg' }] },
  label: { position: 'absolute', color: colors.mapLabel, fontFamily: typography.fontFamily.semibold, fontSize: 11, fontWeight: typography.weight.semibold, letterSpacing: 2 },
  pinPosition: { position: 'absolute' },
});
