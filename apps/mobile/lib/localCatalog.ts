import { catalogMetadata, catalogRows, type OfflineCatalogRow } from '@/data/catalog';
import type { Place } from '@/data/fixtures';
import { isTacoCatalogPlace, searchEvidence } from './catalogQuality';
import { isOpenNow } from './hours';

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

const catalogSources: Record<OfflineCatalogRow['sourceKey'], NonNullable<Place['source']>> = {
  denue: {
    name: 'denue-cdmx-edomex',
    url: 'https://www.inegi.org.mx/app/mapa/denue/',
    license: 'Términos de Libre Uso de la Información del INEGI',
    attribution: 'Fuente: INEGI, DENUE, edición mayo de 2026',
    updatedAt: catalogMetadata.exportedAt
  },
  osm: {
    name: 'osm-cdmx-edomex',
    url: 'https://www.openstreetmap.org',
    license: 'ODbL 1.0',
    attribution: '© OpenStreetMap contributors',
    updatedAt: catalogMetadata.exportedAt
  },
  manual: {
    name: 'manual-catalog',
    url: '',
    license: 'Información proporcionada para pruebas',
    attribution: 'Fuente manual pendiente de verificación',
    updatedAt: catalogMetadata.exportedAt
  }
};

const catalogPhotoPool = [
  'catalog-dummy://pastor',
  'catalog-dummy://suadero',
  'catalog-dummy://canasta',
  'catalog-dummy://birria',
  ...Array.from({ length: 23 }, (_, index) => `catalog-dummy://user-${String(index + 1).padStart(2, '0')}`)
];

function hashText(value: string) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function dummyImageFor(row: Pick<OfflineCatalogRow, 'id' | 'name'>) {
  return catalogPhotoPool[hashText(`${row.id}:${row.name}`) % catalogPhotoPool.length];
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

function normalize(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function terms(value: string) {
  return normalize(value).split(/[^a-z0-9]+/).filter((term) => term.length >= 2);
}

function searchableText(row: OfflineCatalogRow) {
  return normalize([
    row.name,
    row.taqueriaName,
    row.neighborhood,
    row.address,
    row.style,
    row.description,
    ...(row.tags ?? []),
    ...(row.tacos ?? []).map((taco) => taco.name)
  ].filter(Boolean).join(' '));
}

function toPlace(row: OfflineCatalogRow, distance?: string): Place {
  const image = row.image || dummyImageFor(row);
  return {
    id: row.id,
    taqueriaId: row.taqueriaId || row.id,
    taqueriaName: row.taqueriaName || row.name,
    name: row.name,
    neighborhood: row.neighborhood,
    distance: distance ?? 'cerca de ti',
    openUntil: row.openUntil,
    rating: row.rating,
    reviewCount: 0,
    style: row.style,
    coordinates: row.coordinates,
    ...(row.address ? { address: row.address } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    ...(row.weeklyHours ? { weeklyHours: row.weeklyHours } : {}),
    ...(row.hoursKnown !== undefined ? { hoursKnown: row.hoursKnown } : {}),
    ...(row.priceMin !== undefined ? { priceMin: row.priceMin } : {}),
    ...(row.priceMax !== undefined ? { priceMax: row.priceMax } : {}),
    source: catalogSources[row.sourceKey],
    catalogStatus: row.catalogStatus,
    image,
    imageIsIllustrative: row.imageIsIllustrative,
    description: row.description ?? '',
    tacos: row.tacos ?? [],
    ...(row.photos?.length ? { photos: row.photos } : {}),
    tags: row.tags ?? []
  };
}

// Keep rows compact in memory. Full Place objects are created only for the
// handful of results rendered by the screen or for an explicitly opened ID.
const displayableRows = catalogRows.filter((row) => isTacoCatalogPlace(row));

export function localDiscover(options: LocalCatalogQuery = {}) {
  const queryTerms = options.q?.trim() ? terms(options.q.trim()) : [];
  const origin = options.lat != null && options.lng != null ? { latitude: options.lat, longitude: options.lng } : undefined;
  const radiusKm = options.radiusKm != null && Number.isFinite(options.radiusKm) ? options.radiusKm : undefined;
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);

  const candidates = displayableRows
    .map((row) => ({ row, distance: origin ? distanceKm(origin, row.coordinates) : undefined }))
    .filter(({ row, distance }) => {
      if (queryTerms.length && !queryTerms.every((term) => searchableText(row).includes(term))) return false;
      if (radiusKm != null && distance != null && distance > radiusKm) return false;
      if (options.openNow && !isOpenNow(row.openUntil, new Date(), row.weeklyHours, row.hoursKnown)) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.distance != null && b.distance != null && a.distance !== b.distance) return a.distance - b.distance;
      if (a.row.catalogStatus !== b.row.catalogStatus) return a.row.catalogStatus === 'active' ? -1 : 1;
      if (b.row.rating !== a.row.rating) return b.row.rating - a.row.rating;
      return a.row.name.localeCompare(b.row.name, 'es', { sensitivity: 'base' });
    })
    .map(({ row, distance }) => {
      const place = toPlace(row, distance == null ? 'cerca de ti' : `${distance.toFixed(1)} km`);
      return { ...place, searchEvidence: searchEvidence(place, options.q) };
    });

  return candidates.slice(offset, offset + limit);
}

// Demo-only callers still receive a useful small set; production discovery
// comes from the API and does not instantiate all 34k catalog records.
export const places: Place[] = localDiscover({ limit: 50 });

export function localRecommendations(location?: Coordinates) {
  const nearby = location
    ? localDiscover({ lat: location.latitude, lng: location.longitude, radiusKm: 20, limit: 50 })
    : [];
  return nearby.length ? nearby : localDiscover({ limit: 50 });
}

export function localPlace(id: string) {
  const row = displayableRows.find((item) => item.id === id);
  return row ? toPlace(row) : undefined;
}

export function localTaqueria(id: string) {
  const branches = displayableRows
    .filter((row) => (row.taqueriaId || row.id) === id)
    .map((row) => toPlace(row));
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
