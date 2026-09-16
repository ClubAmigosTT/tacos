import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const configuredSource = process.env.MOBILE_CATALOG_SOURCE?.trim();
const inputPath = resolve(root, configuredSource ?? 'catalog/cdmx-edomex.json');
const outputPath = resolve(root, process.env.MOBILE_CATALOG_OUTPUT ?? 'apps/mobile/data/catalog.ts');

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
  excludedRows: inputRowsCount - places.length
};

// Keep the bundled snapshot compact while retaining every supplied row. Full
// Place objects are created only for results that are actually shown, so the
// complete catalog does not repeat source attribution and illustrative photo
// data 30k times.
const serializedRows = JSON.stringify(JSON.stringify(places));
const output = `// Generated by scripts/build-mobile-catalog.mjs. Do not edit by hand.\n\nexport type OfflineCatalogRow = {\n  id: string;\n  taqueriaId: string;\n  taqueriaName: string;\n  name: string;\n  neighborhood: string;\n  openUntil: string;\n  rating: number;\n  style: string;\n  coordinates: { latitude: number; longitude: number };\n  address?: string;\n  phone?: string;\n  weeklyHours?: Record<string, Array<{ open: string; close: string }>>;\n  hoursKnown?: boolean;\n  priceMin?: number;\n  priceMax?: number;\n  sourceKey: 'denue' | 'osm' | 'manual';\n  catalogStatus: 'active' | 'needs_review';\n  image: string;\n  imageIsIllustrative: boolean;\n  description?: string;\n  tacos?: Array<{ id: string; name: string; rating: number; price: number; note: string }>;\n  photos?: Array<{ url: string; sourceUrl?: string; license: string; attribution: string; source: 'catalog' }>;\n  tags?: string[];\n};\n\nexport const catalogMetadata = ${JSON.stringify(metadata)} as const;\nexport const catalogRevision = catalogMetadata.exportedAt;\n\nconst rawRows: unknown = JSON.parse(${serializedRows});\nexport const catalogRows = rawRows as OfflineCatalogRow[];\n`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, 'utf8');
console.log(`Mobile catalog generated: ${places.length} branches from ${inputPath}`);
