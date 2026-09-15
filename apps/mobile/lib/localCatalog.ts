import { places as bundledPlaces } from '@/data/catalog';
import type { Place } from '@/data/fixtures';
import { isDisplayablePlace, searchEvidence } from './catalogQuality';
import { isOpenNow } from './hours';

// Keep the offline catalog aligned with the public catalog rules. Older
// snapshots can contain generic activity labels such as "TORTAS" or
// "DESAYUNOS"; those are not commercial place names.
export const places = bundledPlaces.filter(isDisplayablePlace);

type Coordinates = { latitude: number; longitude: number };
export type LocalCatalogQuery = {
  q?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  offset?: number;
  openNow?: boolean;
  limit?: number;
};

function normalize(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function terms(value: string) {
  return normalize(value).split(/[^a-z0-9]+/).filter((term) => term.length >= 2);
}

function distanceKm(from: Coordinates, to: Coordinates) {
  const earthRadiusKm = 6371;
  const latitudeDelta = (to.latitude - from.latitude) * Math.PI / 180;
  const longitudeDelta = (to.longitude - from.longitude) * Math.PI / 180;
  const latitudeA = from.latitude * Math.PI / 180;
  const latitudeB = to.latitude * Math.PI / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function searchableText(place: Place) {
  return normalize([
    place.name,
    place.taqueriaName,
    place.neighborhood,
    place.address,
    place.style,
    ...place.tags,
    ...place.tacos.map((taco) => taco.name)
  ].filter(Boolean).join(' '));
}

export function localDiscover(options: LocalCatalogQuery = {}) {
  const queryTerms = options.q?.trim() ? terms(options.q.trim()) : [];
  const origin = options.lat != null && options.lng != null ? { latitude: options.lat, longitude: options.lng } : undefined;
  const radiusKm = options.radiusKm != null && Number.isFinite(options.radiusKm) ? options.radiusKm : undefined;
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);

  const candidates = places
    .map((place) => ({ place, distance: origin ? distanceKm(origin, place.coordinates) : undefined }))
    .filter(({ place, distance }) => {
      if (queryTerms.length && !queryTerms.every((term) => searchableText(place).includes(term))) return false;
      if (radiusKm != null && distance != null && distance > radiusKm) return false;
      if (options.openNow && !isOpenNow(place.openUntil, new Date(), place.weeklyHours, place.hoursKnown)) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.distance != null && b.distance != null && a.distance !== b.distance) return a.distance - b.distance;
      if (b.place.rating !== a.place.rating) return b.place.rating - a.place.rating;
      return a.place.name.localeCompare(b.place.name, 'es', { sensitivity: 'base' });
    })
    .map(({ place, distance }) => ({
      ...place,
      distance: distance == null ? 'cerca de ti' : `${distance.toFixed(1)} km`,
      searchEvidence: searchEvidence(place, options.q)
    }));

  return candidates.slice(offset, offset + limit);
}

export function localRecommendations(location?: Coordinates) {
  const nearby = location
    ? localDiscover({ lat: location.latitude, lng: location.longitude, radiusKm: 20, limit: 50 })
    : [];

  return nearby.length ? nearby : localDiscover({ limit: 50 });
}

export function localPlace(id: string) {
  return places.find((place) => place.id === id);
}

export function localTaqueria(id: string) {
  const branches = places.filter((place) => (place.taqueriaId ?? place.id) === id);
  if (!branches.length) return undefined;
  const first = branches[0];
  return {
    id,
    name: first.taqueriaName ?? first.name,
    slug: id,
    description: `${first.name} y sus sucursales.`,
    branchCount: branches.length,
    branches
  };
}
