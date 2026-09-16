import { Platform } from 'react-native';
import type { SQLiteDatabase } from 'expo-sqlite';
import { catalogDatabaseName, catalogMetadata, type OfflineCatalogRow } from '@/data/catalog';
import { places as fixturePlaces, type Place } from '@/data/fixtures';
import { searchEvidence } from './catalogQuality';
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

const catalogAsset = require('../assets/catalog.db') as number;
const catalogColumns = `
  id, taqueria_id, taqueria_name, name, neighborhood, open_until, rating,
  style, latitude, longitude, address, phone, weekly_hours_json,
  hours_known, price_min, price_max, source_key, catalog_status, image,
  image_is_illustrative, description, tacos_json, photos_json, tags_json,
  search_text
`;

type CatalogDatabaseRow = {
  id: string;
  taqueria_id: string;
  taqueria_name: string;
  name: string;
  neighborhood: string;
  open_until: string;
  rating: number;
  style: string;
  latitude: number;
  longitude: number;
  address: string | null;
  phone: string | null;
  weekly_hours_json: string | null;
  hours_known: number | null;
  price_min: number | null;
  price_max: number | null;
  source_key: string;
  catalog_status: string;
  image: string;
  image_is_illustrative: number;
  description: string | null;
  tacos_json: string | null;
  photos_json: string | null;
  tags_json: string | null;
  search_text: string;
};

type WeeklyHours = Record<string, Array<{ open: string; close: string }>>;
type CatalogTaco = NonNullable<OfflineCatalogRow['tacos']>[number];
type CatalogPhoto = NonNullable<OfflineCatalogRow['photos']>[number];

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function catalogRowFromDatabase(row: CatalogDatabaseRow): OfflineCatalogRow {
  const sourceKey: OfflineCatalogRow['sourceKey'] = row.source_key === 'osm' || row.source_key === 'manual' ? row.source_key : 'denue';
  const catalogStatus: OfflineCatalogRow['catalogStatus'] = row.catalog_status === 'needs_review' ? 'needs_review' : 'active';
  const weeklyHours = parseJson<WeeklyHours | undefined>(row.weekly_hours_json, undefined);
  const tacos = parseJson<CatalogTaco[]>(row.tacos_json, []);
  const photos = parseJson<CatalogPhoto[]>(row.photos_json, []);
  const tags = parseJson<string[]>(row.tags_json, []);

  return {
    id: row.id,
    taqueriaId: row.taqueria_id,
    taqueriaName: row.taqueria_name,
    name: row.name,
    neighborhood: row.neighborhood,
    openUntil: row.open_until,
    rating: Number(row.rating) || 0,
    style: row.style,
    coordinates: { latitude: Number(row.latitude), longitude: Number(row.longitude) },
    ...(row.address ? { address: row.address } : {}),
    ...(row.phone ? { phone: row.phone } : {}),
    ...(weeklyHours ? { weeklyHours } : {}),
    ...(row.hours_known !== null ? { hoursKnown: row.hours_known === 1 } : {}),
    ...(row.price_min !== null ? { priceMin: Number(row.price_min) } : {}),
    ...(row.price_max !== null ? { priceMax: Number(row.price_max) } : {}),
    sourceKey,
    catalogStatus,
    image: row.image,
    imageIsIllustrative: row.image_is_illustrative === 1,
    ...(row.description ? { description: row.description } : {}),
    ...(tacos.length ? { tacos } : {}),
    ...(photos.length ? { photos } : {}),
    ...(tags.length ? { tags } : {})
  };
}

let catalogDatabasePromise: Promise<SQLiteDatabase> | undefined;

async function openCatalogDatabase() {
  if (Platform.OS === 'web') return undefined;
  if (!catalogDatabasePromise) {
    catalogDatabasePromise = (async () => {
      const sqlite = await import('expo-sqlite');
      const assetSource = { assetId: catalogAsset };
      await sqlite.importDatabaseFromAssetAsync(catalogDatabaseName, assetSource);
      let database = await sqlite.openDatabaseAsync(catalogDatabaseName, { useNewConnection: true });
      const hasExpectedRows = async () => {
        try {
          const countRow = await database.getFirstAsync<{ count: number }>('SELECT COUNT(*) AS count FROM catalog_rows');
          return Number(countRow?.count) === catalogMetadata.branchCount;
        } catch {
          return false;
        }
      };
      if (!(await hasExpectedRows())) {
        await database.closeAsync();
        await sqlite.importDatabaseFromAssetAsync(catalogDatabaseName, { ...assetSource, forceOverwrite: true });
        database = await sqlite.openDatabaseAsync(catalogDatabaseName, { useNewConnection: true });
      }
      if (!(await hasExpectedRows())) {
        await database.closeAsync();
        throw new Error(`El catálogo local está incompleto: se esperaban ${catalogMetadata.branchCount} sucursales`);
      }
      await database.execAsync('PRAGMA query_only = ON;');
      return database;
    })().catch((error) => {
      catalogDatabasePromise = undefined;
      throw error;
    });
  }
  return catalogDatabasePromise;
}

function queryParameters(options: LocalCatalogQuery) {
  const values: Array<string | number> = [];
  const where: string[] = [];
  const queryTerms = options.q?.trim() ? terms(options.q.trim()) : [];

  for (const term of queryTerms) {
    where.push('search_text LIKE ?');
    values.push(`%${term}%`);
  }

  const origin = options.lat != null && options.lng != null
    ? { latitude: options.lat, longitude: options.lng }
    : undefined;
  const radiusKm = options.radiusKm != null && Number.isFinite(options.radiusKm)
    ? Math.max(0, options.radiusKm)
    : undefined;

  if (origin && radiusKm != null) {
    const latitudeDelta = radiusKm / 111;
    const longitudeDelta = radiusKm / Math.max(20, 111 * Math.cos(origin.latitude * Math.PI / 180));
    where.push('latitude BETWEEN ? AND ?', 'longitude BETWEEN ? AND ?');
    values.push(origin.latitude - latitudeDelta, origin.latitude + latitudeDelta, origin.longitude - longitudeDelta, origin.longitude + longitudeDelta);
  }

  return { values, where, origin, radiusKm };
}

async function databaseRows(options: LocalCatalogQuery): Promise<OfflineCatalogRow[] | undefined> {
  const database = await openCatalogDatabase();
  if (!database) return undefined;

  const { values, where, origin } = queryParameters(options);
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);
  // When a radius or open-now filter is active, fetch the full bounded set so
  // JavaScript can apply the exact distance and overnight-hours rules before
  // applying the requested offset/limit.
  const scanLimit = origin || options.openNow ? 50_000 : Math.min(50_000, offset + limit);
  const sql = `SELECT ${catalogColumns} FROM catalog_rows${where.length ? ` WHERE ${where.join(' AND ')}` : ''} ORDER BY CASE WHEN catalog_status = 'active' THEN 0 ELSE 1 END, rating DESC, name COLLATE NOCASE, id LIMIT ?`;
  values.push(scanLimit);
  const rows = await database.getAllAsync<CatalogDatabaseRow>(sql, ...values);
  return rows.map(catalogRowFromDatabase);
}

function rankCatalogRows(rows: OfflineCatalogRow[], options: LocalCatalogQuery) {
  const queryTerms = options.q?.trim() ? terms(options.q.trim()) : [];
  const origin = options.lat != null && options.lng != null ? { latitude: options.lat, longitude: options.lng } : undefined;
  const radiusKm = options.radiusKm != null && Number.isFinite(options.radiusKm) ? Math.max(0, options.radiusKm) : undefined;
  const offset = Math.max(0, Math.trunc(options.offset ?? 0));
  const limit = Math.min(Math.max(Math.trunc(options.limit ?? 50), 1), 100);

  const candidates = rows
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
      return a.row.name.localeCompare(b.row.name, 'es', { sensitivity: 'base' }) || a.row.id.localeCompare(b.row.id);
    })
    .map(({ row, distance }) => {
      const place = toPlace(row, distance == null ? 'cerca de ti' : `${distance.toFixed(1)} km`);
      return { ...place, searchEvidence: searchEvidence(place, options.q) };
    });

  return candidates.slice(offset, offset + limit);
}

function discoverFixturePlaces(options: LocalCatalogQuery) {
  const rows: OfflineCatalogRow[] = fixturePlaces.map((place) => {
    const { photos, ...placeWithoutPhotos } = place;
    return {
      ...placeWithoutPhotos,
      taqueriaId: place.taqueriaId ?? place.id,
      taqueriaName: place.taqueriaName ?? place.name,
      sourceKey: 'manual',
      catalogStatus: 'active',
      imageIsIllustrative: Boolean(place.imageIsIllustrative),
      ...(photos?.length
      ? {
          photos: photos.map((photo) => ({
            url: photo.url,
            ...(photo.sourceUrl ? { sourceUrl: photo.sourceUrl } : {}),
            license: photo.license,
            attribution: photo.attribution,
            source: 'catalog' as const
          }))
        }
      : {})
    };
  });
  return rankCatalogRows(rows, options);
}

// The fixture remains available for demo-only UI callers and for web builds.
// Native production discovery reads all bundled rows from SQLite instead of
// constructing the complete catalog during module evaluation.
export const places: Place[] = fixturePlaces;

export async function localDiscover(options: LocalCatalogQuery = {}) {
  try {
    const rows = await databaseRows(options);
    return rows ? rankCatalogRows(rows, options) : discoverFixturePlaces(options);
  } catch {
    return discoverFixturePlaces(options);
  }
}

export async function localRecommendations(location?: Coordinates) {
  const nearby = location
    ? await localDiscover({ lat: location.latitude, lng: location.longitude, radiusKm: 20, limit: 50 })
    : [];
  return nearby.length ? nearby : localDiscover({ limit: 50 });
}

export async function localPlace(id: string) {
  if (Platform.OS === 'web') return fixturePlaces.find((place) => place.id === id);
  try {
    const database = await openCatalogDatabase();
    if (!database) return fixturePlaces.find((place) => place.id === id);
    const row = await database.getFirstAsync<CatalogDatabaseRow>(`SELECT ${catalogColumns} FROM catalog_rows WHERE id = ? LIMIT 1`, id);
    return row ? toPlace(catalogRowFromDatabase(row)) : undefined;
  } catch {
    return fixturePlaces.find((place) => place.id === id);
  }
}

function taqueriaFromBranches(id: string, branches: Place[]) {
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

export async function localTaqueria(id: string) {
  if (Platform.OS === 'web') {
    return taqueriaFromBranches(id, fixturePlaces.filter((place) => (place.taqueriaId || place.id) === id));
  }
  try {
    const database = await openCatalogDatabase();
    if (!database) return undefined;
    const rows = await database.getAllAsync<CatalogDatabaseRow>(`SELECT ${catalogColumns} FROM catalog_rows WHERE taqueria_id = ? ORDER BY name COLLATE NOCASE, id`, id);
    return taqueriaFromBranches(id, rows.map((row) => toPlace(catalogRowFromDatabase(row))));
  } catch {
    return taqueriaFromBranches(id, fixturePlaces.filter((place) => (place.taqueriaId || place.id) === id));
  }
}
