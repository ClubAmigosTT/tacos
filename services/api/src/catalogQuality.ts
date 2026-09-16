const genericNameTokens = new Set([
  'a', 'al', 'antojito', 'antojitos', 'bar', 'carnita', 'carnitas', 'carne',
  'comida', 'comidas', 'con', 'cocina', 'de', 'del', 'desayuno', 'desayunos',
  'el', 'en', 'fonda', 'food', 'horas', 'la', 'las', 'los', 'mexicana',
  'mexicano', 'mexicanos', 'puesto', 'restaurant', 'restaurante',
  'restaurantes', 'sin', 'suadero', 'taco', 'tacos', 'taqueria', 'tortas',
  'y', 'barbacoa', 'birria', 'pastor', 'canasta'
]);

const genericExactNames = new Set([
  'antojito', 'antojitos', 'barbacoa', 'birria', 'carnitas', 'comida',
  'comida mexicana', 'comidas', 'cocina economica', 'desayuno', 'desayunos',
  'food truck', 'mexicana', 'mexicano', 'puesto de tacos', 'restaurant',
  'restaurante', 'restaurantes', 'suadero', 'taco', 'tacos', 'taqueria',
  'tortas', 'tacos de canasta', 'zona de comida'
]);

function normalize(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function isDisplayableCatalogPlace(place: { name?: unknown; taqueriaName?: unknown }) {
  const normalized = normalize(place.name ?? place.taqueriaName);
  if (!normalized || genericExactNames.has(normalized)) return false;
  return normalized.split(' ').some((token) => !genericNameTokens.has(token) && !/^\d+$/.test(token) && token.length >= 2);
}

const tacoSignal = /(^|\s)(tacos?|taquer(?:ia|ía)s?|pastor|suadero|carnitas?|barbacoa|birria|canasta)(\s|$)/i;

/**
 * Active catalog records have already passed the importer confidence rules.
 * A needs_review record must still contain a taco-specific signal in its
 * name or tags; otherwise generic restaurants such as cafes, burrito shops,
 * and torterías consume the public result limit before they are verified.
 */
export function isTacoCatalogPlace(place: { name?: unknown; taqueriaName?: unknown; catalogStatus?: unknown; tags?: unknown }) {
  if (!isDisplayableCatalogPlace(place)) return false;
  if (place.catalogStatus !== 'needs_review') return true;
  const text = [place.name, place.taqueriaName, ...(Array.isArray(place.tags) ? place.tags : [])].filter(Boolean).join(' ');
  return tacoSignal.test(text);
}

const dedupeTypeTokens = new Set(['taco', 'tacos', 'taqueria', 'restaurant', 'restaurante', 'restaurantes', 'tortas']);

function canonicalBusinessName(value: unknown) {
  return normalize(value)
    .split(' ')
    .filter((token) => token && !dedupeTypeTokens.has(token))
    .join(' ');
}

function distanceMeters(left: { latitude: number; longitude: number }, right: { latitude: number; longitude: number }) {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = (right.latitude - left.latitude) * Math.PI / 180;
  const longitudeDelta = (right.longitude - left.longitude) * Math.PI / 180;
  const latitudeA = left.latitude * Math.PI / 180;
  const latitudeB = right.latitude * Math.PI / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

type DedupePlace = {
  id: string;
  name: string;
  taqueriaName?: string;
  address?: string;
  phone?: string;
  coordinates: { latitude: number; longitude: number };
  catalogStatus?: 'active' | 'needs_review';
  weeklyHours?: unknown;
  image?: string | null;
  imageIsIllustrative?: boolean;
  photos?: unknown[];
  source?: { name?: string };
};

function dedupeQuality(place: DedupePlace) {
  return (place.catalogStatus === 'active' ? 8 : 0)
    + (place.address ? 3 : 0)
    + (place.phone ? 2 : 0)
    + (place.weeklyHours ? 2 : 0)
    + (place.image && !place.imageIsIllustrative ? 4 : 0)
    + (place.photos?.length ? 3 : 0)
    + (place.source?.name?.includes('manual') ? 2 : 0);
}

/**
 * Reconciles the same storefront coming from DENUE and OSM before the API's
 * limit is applied. The source IDs remain intact in the database; this is a
 * presentation-level merge that is intentionally conservative (same or
 * canonicalized name plus <=120m, or identical address plus <=80m).
 */
export function dedupeCatalogPlaces<T extends DedupePlace>(places: T[]) {
  const unique: T[] = [];
  const buckets = new Map<string, number[]>();
  const bucketSize = 0.001;

  places.forEach((place) => {
    const bucketLatitude = Math.floor(place.coordinates.latitude / bucketSize);
    const bucketLongitude = Math.floor(place.coordinates.longitude / bucketSize);
    const name = normalize(place.name || place.taqueriaName);
    const canonical = canonicalBusinessName(place.name || place.taqueriaName);
    const address = normalize(place.address);
    let duplicateIndex: number | undefined;

    for (let latitude = bucketLatitude - 1; latitude <= bucketLatitude + 1 && duplicateIndex === undefined; latitude += 1) {
      for (let longitude = bucketLongitude - 1; longitude <= bucketLongitude + 1 && duplicateIndex === undefined; longitude += 1) {
        for (const candidateIndex of buckets.get(`${latitude}:${longitude}`) ?? []) {
          const candidate = unique[candidateIndex];
          const distance = distanceMeters(place.coordinates, candidate.coordinates);
          if (distance > 120) continue;
          const candidateName = normalize(candidate.name || candidate.taqueriaName);
          const candidateCanonical = canonicalBusinessName(candidate.name || candidate.taqueriaName);
          const candidateAddress = normalize(candidate.address);
          const sameName = Boolean(name && candidateName && name === candidateName);
          const sameCanonicalName = Boolean(canonical && candidateCanonical && canonical.length >= 4 && canonical === candidateCanonical);
          const sameAddress = Boolean(address && candidateAddress && address === candidateAddress && distance <= 80);
          if (sameName || sameCanonicalName || sameAddress) {
            duplicateIndex = candidateIndex;
            break;
          }
        }
      }
    }

    if (duplicateIndex === undefined) {
      const index = unique.push(place) - 1;
      const key = `${bucketLatitude}:${bucketLongitude}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(index);
      buckets.set(key, bucket);
      return;
    }

    if (dedupeQuality(place) > dedupeQuality(unique[duplicateIndex])) unique[duplicateIndex] = place;
  });

  return unique;
}
