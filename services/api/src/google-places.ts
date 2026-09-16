type Coordinates = { latitude: number; longitude: number };

type GoogleAuthor = {
  displayName?: string;
  uri?: string;
  photoUri?: string;
};

type GooglePhotoResource = {
  name?: string;
  authorAttributions?: GoogleAuthor[];
  googleMapsUri?: string;
};

type GooglePlaceSearchResult = {
  id?: string;
  displayName?: { text?: string };
  location?: Coordinates;
  googleMapsUri?: string;
  photos?: GooglePhotoResource[];
};

export type RuntimeGooglePhoto = {
  url: string;
  source: 'google_maps';
  sourceUrl: string;
  googleMapsUri: string;
  attribution: string;
};

const googleApiKey = process.env.GOOGLE_PLACES_API_KEY?.trim();
const textSearchUrl = 'https://places.googleapis.com/v1/places:searchText';
const placesApiBaseUrl = 'https://places.googleapis.com/v1';
const photoCache = new Map<string, { expiresAt: number; result: { configured: true; photos: RuntimeGooglePhoto[] } }>();
const PHOTO_CACHE_TTL_MS = 5 * 60_000;
const NEGATIVE_PHOTO_CACHE_TTL_MS = 60_000;

export function isGooglePlacesConfigured() {
  return Boolean(googleApiKey);
}

function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    return new URL(value).protocol === 'https:';
  } catch {
    return false;
  }
}

async function getJson(url: string, init: RequestInit) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    if (!response.ok) return undefined;
    return await response.json() as Record<string, unknown>;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

function distanceKm(from: Coordinates, to: Coordinates) {
  const earthRadiusKm = 6371;
  const latitudeDelta = (to.latitude - from.latitude) * Math.PI / 180;
  const longitudeDelta = (to.longitude - from.longitude) * Math.PI / 180;
  const latitudeA = from.latitude * Math.PI / 180;
  const latitudeB = to.latitude * Math.PI / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function text(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Resolve at most two Google photo URLs for one place, only when a user opens
 * its detail screen. Photo resource names are intentionally never returned
 * or stored: Google says they can expire and must not be cached.
 */
export async function getGooglePlacePhotos(input: { name: string; address?: string; coordinates: Coordinates }) {
  if (!googleApiKey) return { configured: false, photos: [] as RuntimeGooglePhoto[] };

  const cacheKey = [
    normalizeCacheText(input.name),
    normalizeCacheText(input.address),
    input.coordinates.latitude.toFixed(4),
    input.coordinates.longitude.toFixed(4)
  ].join('|');
  const cached = photoCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.result;
  if (cached) photoCache.delete(cacheKey);

  const search = await getJson(textSearchUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': googleApiKey,
      'X-Goog-FieldMask': 'places.id,places.displayName,places.location,places.photos,places.googleMapsUri'
    },
    body: JSON.stringify({
      textQuery: [input.name, input.address, 'México'].filter(Boolean).join(', '),
      languageCode: 'es',
      regionCode: 'MX',
      maxResultCount: 1,
      locationBias: {
        circle: {
          center: input.coordinates,
          radius: 1_500
        }
      }
    })
  });

  const place = (search?.places as GooglePlaceSearchResult[] | undefined)?.[0];
  if (!place?.location || !Array.isArray(place.photos) || !place.photos.length) {
    const result = { configured: true as const, photos: [] as RuntimeGooglePhoto[] };
    cachePhotoResult(cacheKey, result, NEGATIVE_PHOTO_CACHE_TTL_MS);
    return result;
  }

  // Avoid showing photos from a similarly named place that Google resolved
  // outside the immediate area of the catalog branch.
  if (distanceKm(input.coordinates, place.location) > 3) {
    const result = { configured: true as const, photos: [] as RuntimeGooglePhoto[] };
    cachePhotoResult(cacheKey, result, NEGATIVE_PHOTO_CACHE_TTL_MS);
    return result;
  }

  const photos = await Promise.all(place.photos.slice(0, 2).map(async (photo): Promise<RuntimeGooglePhoto | undefined> => {
    const resourceName = text(photo.name);
    if (!resourceName.startsWith('places/')) return undefined;
    const mediaUrl = new URL(`${placesApiBaseUrl}/${resourceName}/media`);
    mediaUrl.searchParams.set('maxWidthPx', '1200');
    mediaUrl.searchParams.set('maxHeightPx', '900');
    mediaUrl.searchParams.set('skipHttpRedirect', 'true');
    mediaUrl.searchParams.set('key', googleApiKey);
    const media = await getJson(mediaUrl.toString(), { headers: { 'X-Goog-Api-Key': googleApiKey } });
    const photoUri = media?.photoUri;
    const googleMapsUri = text(photo.googleMapsUri) || text(place.googleMapsUri);
    if (!isHttpsUrl(photoUri) || !isHttpsUrl(googleMapsUri)) return undefined;
    const authors = (photo.authorAttributions ?? [])
      .map((author) => text(author.displayName))
      .filter(Boolean);
    const attribution = authors.length
      ? `Foto por ${authors.join(', ')} · Google Maps`
      : 'Google Maps';
    return { url: photoUri, source: 'google_maps', sourceUrl: googleMapsUri, googleMapsUri, attribution };
  }));

  const result = { configured: true as const, photos: photos.filter((photo): photo is RuntimeGooglePhoto => Boolean(photo)) };
  cachePhotoResult(cacheKey, result, result.photos.length ? PHOTO_CACHE_TTL_MS : NEGATIVE_PHOTO_CACHE_TTL_MS);
  return result;
}

function normalizeCacheText(value: unknown) {
  return typeof value === 'string' ? value.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ') : '';
}

function cachePhotoResult(key: string, result: { configured: true; photos: RuntimeGooglePhoto[] }, ttlMs: number) {
  if (photoCache.size >= 500) {
    const oldestKey = photoCache.keys().next().value;
    if (oldestKey) photoCache.delete(oldestKey);
  }
  photoCache.set(key, { expiresAt: Date.now() + ttlMs, result });
}
