import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configuredSource = process.env.MOBILE_CATALOG_SOURCE?.trim();
const inputPath = resolve(root, configuredSource ?? 'catalog/cdmx-edomex.json');
const outputPath = resolve(root, process.env.MOBILE_CATALOG_OUTPUT ?? 'apps/mobile/data/catalog.ts');
const databaseOutputPath = resolve(root, process.env.MOBILE_CATALOG_DB_OUTPUT ?? 'apps/mobile/assets/catalog.db');

async function readJsonIfPresent(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return undefined;
    throw error;
  }
}

function rowsFrom(raw) {
  return Array.isArray(raw) ? raw : raw?.branches;
}

let raw = await readJsonIfPresent(inputPath);
let rows = rowsFrom(raw);

// The combined regional snapshot is used when it is available locally. A
// clean checkout may only contain the two tracked source feeds, so retain a
// deterministic fallback that still bundles both sources into the app.
if (!rows?.length && !configuredSource) {
  const denuePath = resolve(root, 'catalog/denue-cdmx-edomex.json');
  const osmPath = resolve(root, 'catalog/osm-cdmx-edomex.json');
  const denue = await readJsonIfPresent(denuePath);
  const osm = await readJsonIfPresent(osmPath);
  const denueRows = rowsFrom(denue) ?? [];
  const osmRows = rowsFrom(osm) ?? [];
  if (denueRows.length || osmRows.length) {
    const merged = [...denueRows, ...osmRows];
    raw = {
      source: 'INEGI DENUE + OpenStreetMap',
      sourceUrl: 'https://www.inegi.org.mx/app/descarga/?t=11',
      license: 'Términos de Libre Uso de la Información del INEGI; ODbL 1.0',
      attribution: 'Fuente: INEGI, DENUE; © OpenStreetMap contributors',
      exportedAt: denue?.exportedAt ?? osm?.exportedAt,
      coverage: ['Ciudad de México', 'Estado de México'],
      branches: merged
    };
    rows = merged;
  }
}

if (!Array.isArray(rows) || !rows.length) throw new Error('El catálogo móvil debe contener al menos una sucursal');
const inputRowsCount = rows.length;
// The supplied regional databases are already curated. Keep every source row
// in the mobile snapshot: do not apply another name/activity filter, remove
// review rows, or truncate the catalog to a rescue sample. A place can still
// be labelled `needs_review`; that label is informational and must not make it
// disappear from the map.
const duplicateRowsRemoved = 0;
const candidateRows = rows;
if (!candidateRows.length) throw new Error('El catálogo móvil está vacío');

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback;
}

function numberOrUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function normalizedHours(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const result = {};
  for (const [day, intervals] of Object.entries(value)) {
    if (!Array.isArray(intervals)) continue;
    const valid = intervals
      .map((interval) => ({ open: text(interval?.open), close: text(interval?.close) }))
      .filter((interval) => /^([01]\d|2[0-3]):[0-5]\d$/.test(interval.open) && /^([01]\d|2[0-3]):[0-5]\d$/.test(interval.close) && interval.open !== interval.close);
    if (valid.length) result[day] = valid;
  }
  return Object.keys(result).length ? result : undefined;
}

function normalizedPhotos(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((photo) => text(photo?.url))
    .map((photo) => ({
      url: text(photo.url),
      ...(text(photo.sourceUrl) ? { sourceUrl: text(photo.sourceUrl) } : {}),
      license: text(photo.license, 'ODbL 1.0'),
      attribution: text(photo.attribution, '© OpenStreetMap contributors'),
      source: 'catalog'
    }));
}

// Temporary local photo pool. The first four are the original bundled
// images; the user-provided photos are intentionally mixed into the same pool
// so a place without a verified photo still looks complete offline.
const catalogPhotoPool = [
  'catalog-dummy://pastor',
  'catalog-dummy://suadero',
  'catalog-dummy://canasta',
  'catalog-dummy://birria',
  ...Array.from({ length: 23 }, (_, index) => `catalog-dummy://user-${String(index + 1).padStart(2, '0')}`)
];

function hashText(value) {
  let hash = 0;
  for (const character of value) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash;
}

function dummyImageFor(row) {
  const identity = `${row?.id ?? ''}:${row?.name ?? ''}`;
  return catalogPhotoPool[hashText(identity) % catalogPhotoPool.length];
}

function sourceKeyFor(row) {
  const value = text(row?.sourceName).toLowerCase();
  if (value.includes('osm') || value.includes('openstreetmap')) return 'osm';
  if (value.includes('manual')) return 'manual';
  return 'denue';
}

function compactDescription(value) {
  const description = text(value);
  if (!description || /^restaurantes? con servicio de preparación/i.test(description)) return undefined;
  return description.slice(0, 240);
}

function compactTags(value) {
  if (!Array.isArray(value)) return undefined;
  const tags = [...new Set(value.map((tag) => text(tag)).filter(Boolean))].slice(0, 8);
  return tags.length ? tags : undefined;
}

function normalizeSearchText(value) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// All curated source rows are bundled. This is intentionally not capped by a
// mobile/offline limit: the app must behave consistently with the databases
// supplied for CDMX and Estado de México, even when the API is waking up or
// the device is offline.
const selectedRows = candidateRows;

function normalizedTacos(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((taco) => text(taco?.name))
    .map((taco, index) => ({
      id: text(taco.id) || `catalog-taco-${index}`,
      name: text(taco.name),
      rating: numberOrUndefined(taco.rating) ?? 0,
      price: numberOrUndefined(taco.price) ?? 0,
      note: text(taco.note)
    }));
}

const places = selectedRows.map((row, index) => {
  const id = text(row?.id);
  const name = text(row?.name);
  const neighborhood = text(row?.neighborhood);
  const latitude = Number(row?.latitude);
  const longitude = Number(row?.longitude);
  if (!id || !name || !neighborhood || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error(`Registro móvil inválido en la posición ${index}`);
  }

  const hours = normalizedHours(row?.weeklyHours);
  const sourcePhotos = normalizedPhotos(row?.photos);
  const sourceImage = text(row?.imageUrl) || text(row?.image);
  const image = sourceImage || sourcePhotos[0]?.url || dummyImageFor(row);
  const catalogStatus = text(row?.catalogStatus, 'active') === 'needs_review' ? 'needs_review' : 'active';
  const hasRealPhoto = Boolean(sourceImage || sourcePhotos.length);
  const photos = hasRealPhoto ? sourcePhotos : undefined;
  const compactTacos = normalizedTacos(row?.tacos);
  const description = compactDescription(row?.description);
  const tags = compactTags(row?.tags);

  return {
    id,
    taqueriaId: text(row?.taqueriaId, id),
    taqueriaName: text(row?.taqueriaName, name),
    name,
    neighborhood,
    openUntil: text(row?.openUntil, '23:00'),
    rating: numberOrUndefined(row?.rating) ?? 0,
    style: text(row?.style, 'Clásico callejero'),
    coordinates: { latitude, longitude },
    ...(text(row?.address) ? { address: text(row.address) } : {}),
    ...(text(row?.phone) ? { phone: text(row.phone) } : {}),
    ...(hours ? { weeklyHours: hours, hoursKnown: true } : { hoursKnown: false }),
    ...(numberOrUndefined(row?.priceMin) !== undefined ? { priceMin: numberOrUndefined(row.priceMin) } : {}),
    ...(numberOrUndefined(row?.priceMax) !== undefined ? { priceMax: numberOrUndefined(row.priceMax) } : {}),
    sourceKey: sourceKeyFor(row),
    catalogStatus,
    image,
    imageIsIllustrative: !hasRealPhoto,
    ...(description ? { description } : {}),
    ...(compactTacos.length ? { tacos: compactTacos } : {}),
    ...(photos?.length ? { photos } : {}),
    ...(tags ? { tags } : {})
  };
}).sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }) || a.id.localeCompare(b.id));

const metadata = {
  source: text(raw.source, 'OpenStreetMap'),
  sourceUrl: text(raw.sourceUrl),
  license: text(raw.license),
  attribution: text(raw.attribution),
  exportedAt: text(raw.exportedAt, new Date().toISOString()),
  coverage: Array.isArray(raw.coverage) ? raw.coverage.map((item) => text(item)).filter(Boolean) : [],
  branchCount: places.length,
  sourceRows: inputRowsCount,
  duplicateRowsRemoved,
  candidateRows: candidateRows.length,
  offlineLimit: places.length,
  offlineTruncated: candidateRows.length > places.length,
  includedActive: places.filter((place) => place.catalogStatus === 'active').length,
  includedNeedsReview: places.filter((place) => place.catalogStatus === 'needs_review').length,
  excludedRows: inputRowsCount - places.length,
  storage: 'sqlite'
};

// The catalog is shipped as a prebuilt SQLite asset. This keeps all source
// rows in the app while preventing Metro/Hermes from parsing a 26 MB string
// during the first JavaScript module evaluation.
const revisionToken = normalizeSearchText(metadata.exportedAt).replace(/[^a-z0-9]/g, '').slice(0, 32) || 'current';
const catalogHash = createHash('sha256').update(JSON.stringify(places)).digest('hex').slice(0, 16);
metadata.catalogHash = catalogHash;
const catalogDatabaseName = `tacos-catalog-${revisionToken}-${catalogHash}.db`;
await mkdir(dirname(databaseOutputPath), { recursive: true });
const database = new DatabaseSync(databaseOutputPath);
try {
  database.exec(`
    PRAGMA journal_mode = DELETE;
    DROP TABLE IF EXISTS catalog_rows;
    CREATE TABLE catalog_rows (
      id TEXT PRIMARY KEY,
      taqueria_id TEXT NOT NULL,
      taqueria_name TEXT NOT NULL,
      name TEXT NOT NULL,
      neighborhood TEXT NOT NULL,
      open_until TEXT NOT NULL,
      rating REAL NOT NULL,
      style TEXT NOT NULL,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      address TEXT,
      phone TEXT,
      weekly_hours_json TEXT,
      hours_known INTEGER,
      price_min REAL,
      price_max REAL,
      source_key TEXT NOT NULL,
      catalog_status TEXT NOT NULL,
      image TEXT NOT NULL,
      image_is_illustrative INTEGER NOT NULL,
      description TEXT,
      tacos_json TEXT,
      photos_json TEXT,
      tags_json TEXT,
      search_text TEXT NOT NULL
    );
  `);
  const insert = database.prepare(`
    INSERT INTO catalog_rows (
      id, taqueria_id, taqueria_name, name, neighborhood, open_until, rating,
      style, latitude, longitude, address, phone, weekly_hours_json,
      hours_known, price_min, price_max, source_key, catalog_status, image,
      image_is_illustrative, description, tacos_json, photos_json, tags_json,
      search_text
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  database.exec('BEGIN');
  try {
    for (const place of places) {
      const searchText = normalizeSearchText([
        place.name,
        place.taqueriaName,
        place.neighborhood,
        place.address,
        place.style,
        place.description,
        ...(place.tags ?? []),
        ...(place.tacos ?? []).map((taco) => taco.name)
      ].filter(Boolean).join(' '));
      insert.run(
        place.id,
        place.taqueriaId,
        place.taqueriaName,
        place.name,
        place.neighborhood,
        place.openUntil,
        place.rating,
        place.style,
        place.coordinates.latitude,
        place.coordinates.longitude,
        place.address ?? null,
        place.phone ?? null,
        place.weeklyHours ? JSON.stringify(place.weeklyHours) : null,
        place.hoursKnown === undefined ? null : place.hoursKnown ? 1 : 0,
        place.priceMin ?? null,
        place.priceMax ?? null,
        place.sourceKey,
        place.catalogStatus,
        place.image,
        place.imageIsIllustrative ? 1 : 0,
        place.description ?? null,
        place.tacos?.length ? JSON.stringify(place.tacos) : null,
        place.photos?.length ? JSON.stringify(place.photos) : null,
        place.tags?.length ? JSON.stringify(place.tags) : null,
        searchText
      );
    }
    database.exec('COMMIT');
  } catch (error) {
    database.exec('ROLLBACK');
    throw error;
  }
  database.exec(`
    CREATE INDEX catalog_rows_search_idx ON catalog_rows(search_text);
    CREATE INDEX catalog_rows_location_idx ON catalog_rows(latitude, longitude);
    CREATE INDEX catalog_rows_taqueria_idx ON catalog_rows(taqueria_id);
    ANALYZE;
  `);
} finally {
  database.close();
}

const output = `// Generated by scripts/build-mobile-catalog.mjs. Do not edit by hand.\n\nexport type OfflineCatalogRow = {\n  id: string;\n  taqueriaId: string;\n  taqueriaName: string;\n  name: string;\n  neighborhood: string;\n  openUntil: string;\n  rating: number;\n  style: string;\n  coordinates: { latitude: number; longitude: number };\n  address?: string;\n  phone?: string;\n  weeklyHours?: Record<string, Array<{ open: string; close: string }>>;\n  hoursKnown?: boolean;\n  priceMin?: number;\n  priceMax?: number;\n  sourceKey: 'denue' | 'osm' | 'manual';\n  catalogStatus: 'active' | 'needs_review';\n  image: string;\n  imageIsIllustrative: boolean;\n  description?: string;\n  tacos?: Array<{ id: string; name: string; rating: number; price: number; note: string }>;\n  photos?: Array<{ url: string; sourceUrl?: string; license: string; attribution: string; source: 'catalog' }>;\n  tags?: string[];\n};\n\nexport const catalogMetadata = ${JSON.stringify(metadata)} as const;\nexport const catalogRevision = catalogMetadata.exportedAt;\nexport const catalogDatabaseName = ${JSON.stringify(catalogDatabaseName)} as const;\n`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, 'utf8');
console.log(`Mobile SQLite catalog generated: ${places.length} branches from ${inputPath}`);
