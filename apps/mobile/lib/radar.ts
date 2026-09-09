import type { Place } from '@/data/fixtures';
import { isOpenNow } from '@/lib/hours';

export const radarDistances = ['Cerca', 'En la zona', 'Toda la ciudad'] as const;
export const radarPrices = ['Barato', 'Medio', 'Cualquier precio'] as const;
export const radarMoods = ['Clásico', 'Aventura', 'Alta calidad'] as const;
export const radarHunger = ['Ligero', 'Normal', 'Mucha hambre'] as const;

export type RadarDistance = (typeof radarDistances)[number];
export type RadarPrice = (typeof radarPrices)[number];
export type RadarMood = (typeof radarMoods)[number];
export type RadarHunger = (typeof radarHunger)[number];

export type RadarOptions = {
  places: Place[];
  active: string;
  contextualTaco?: string;
  distance: RadarDistance;
  price: RadarPrice;
  mood: RadarMood;
  hunger: RadarHunger;
};

function distanceKm(distance: string) {
  const value = Number.parseFloat(distance.replace(',', '.'));
  return Number.isFinite(value) ? value : Number.POSITIVE_INFINITY;
}

function lowestPrice(place: Place) {
  return Math.min(...place.tacos.map((taco) => taco.price), Number.POSITIVE_INFINITY);
}

/**
 * Apply the contextual Radar constraints and ranking in one deterministic
 * place. Numeric distances are optional while location permission is pending;
 * all non-geographic constraints still apply in that state.
 */
export function applyRadar({ places, active, contextualTaco, distance, price, mood, hunger }: RadarOptions) {
  const tacoFiltered = contextualTaco
    ? places.filter((place) => place.tacos.some((taco) => taco.name.toLowerCase() === contextualTaco.toLowerCase()))
    : places;
  const source = [...tacoFiltered];
  const distanceLimit = distance === 'Cerca' ? 2 : distance === 'En la zona' ? 5 : Number.POSITIVE_INFINITY;
  const hasDistanceData = source.some((place) => Number.isFinite(distanceKm(place.distance)));
  const filtered = source.filter((place) => {
    if (hasDistanceData && distanceKm(place.distance) > distanceLimit) return false;
    if (price === 'Barato' && lowestPrice(place) > 24) return false;
    if (price === 'Medio' && (lowestPrice(place) < 24 || lowestPrice(place) > 32)) return false;
    const highestPrice = Math.max(...place.tacos.map((taco) => taco.price), 0);
    if (hunger === 'Ligero' && highestPrice > 32) return false;
    if (hunger === 'Mucha hambre' && highestPrice < 24 && place.tacos.length < 3) return false;
    return true;
  });

  const moodFiltered = mood === 'Clásico'
    ? filtered.filter((place) => place.flavorProfile.traditional >= 70)
    : mood === 'Aventura'
      ? filtered.filter((place) => place.flavorProfile.traditional < 80 || place.flavorProfile.intensity >= 75)
      : filtered;
  const hungerScore = (place: Place) => Math.max(...place.tacos.map((taco) => taco.price), 0) + place.tacos.length * 4;
  const moodScore = (place: Place) => mood === 'Clásico'
    ? place.flavorProfile.traditional
    : mood === 'Aventura'
      ? place.flavorProfile.intensity + (100 - place.flavorProfile.traditional)
      : place.rating * 20;
  const contextualSort = (a: Place, b: Place) => {
    if (hunger !== 'Normal') {
      const hungerDelta = hungerScore(b) - hungerScore(a);
      if (hungerDelta) return hunger === 'Mucha hambre' ? hungerDelta : -hungerDelta;
    }
    return moodScore(b) - moodScore(a);
  };

  if (active === 'Barato') return moodFiltered.sort((a, b) => (lowestPrice(a) - lowestPrice(b)) || contextualSort(a, b));
  if (active === '92% para mí') return moodFiltered.sort((a, b) => (b.match - a.match) || contextualSort(a, b));
  if (active === 'Pastor') return moodFiltered.sort((a, b) => {
    const aRating = a.tacos.find((taco) => taco.name.toLowerCase() === contextualTaco?.toLowerCase())?.rating ?? a.rating;
    const bRating = b.tacos.find((taco) => taco.name.toLowerCase() === contextualTaco?.toLowerCase())?.rating ?? b.rating;
    return (bRating - aRating) || contextualSort(a, b);
  });
  if (active === 'Abierto ahora') return moodFiltered.filter((place) => isOpenNow(place.openUntil)).sort(contextualSort);
  return moodFiltered.sort(contextualSort);
}
