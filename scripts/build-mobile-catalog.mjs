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

const GENERIC_NAME_TOKENS = new Set([
  'a', 'al', 'antojito', 'antojitos', 'bar', 'carnita', 'carnitas', 'carne',
  'comida', 'comidas', 'con', 'cocina', 'de', 'del', 'desayuno', 'desayunos',
  'el', 'en', 'fonda', 'food', 'horas', 'la', 'las', 'los', 'mexicana',
  'mexicano', 'mexicanos', 'puesto', 'restaurant', 'restaurante',
  'restaurantes', 'sin', 'suadero', 'taco', 'tacos', 'taqueria', 'tortas',
  'y', 'barbacoa', 'birria', 'pastor', 'canasta'
]);

const GENERIC_EXACT_NAMES = new Set([
  'antojito', 'antojitos', 'barbacoa', 'birria', 'carnitas', 'comida',
  'comida mexicana', 'comidas', 'cocina economica', 'desayuno', 'desayunos',
  'food truck', 'mexicana', 'mexicano', 'puesto de tacos', 'restaurant',
  'restaurante', 'restaurantes', 'suadero', 'taco', 'tacos', 'taqueria',
  'tortas', 'tacos de canasta', 'zona de comida'
]);

function hasCommercialName(value) {
  const normalized = text(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  if (!normalized || GENERIC_EXACT_NAMES.has(normalized)) return false;
  return normalized.split(' ').some((token) => !GENERIC_NAME_TOKENS.has(token) && !/^\d+$/.test(token) && token.length >= 2);
}

const TACO_SIGNAL = /(^|\s)(tacos?|taquer(?:ia|ía)s?|pastor|suadero|carnitas?|barbacoa|birria|canasta)(\s|$)/i;

function isTacoCandidate(row) {
  const status = text(row?.catalogStatus, 'active');
  if (status !== 'needs_review') return true;
  const searchable = [row?.name, row?.taqueriaName, ...(Array.isArray(row?.tags) ? row.tags : [])].filter(Boolean).join(' ');
  return TACO_SIGNAL.test(searchable);
}

function catalogRowKey(row) {
  const sourceName = text(row?.sourceName);
  const sourcePlaceId = text(row?.sourcePlaceId);
  if (sourceName && sourcePlaceId) return `source:${sourceName}:${sourcePlaceId}`;
  const latitude = Number(row?.latitude);
  const longitude = Number(row?.longitude);
  const name = text(row?.name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  return `place:${name}:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
}

const DEDUPE_NAME_TOKENS = new Set([
  'taco', 'tacos', 'taqueria', 'taquería', 'restaurant', 'restaurante',
  'restaurantes', 'tortas'
]);

function normalizedName(value) {
  return text(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function canonicalName(value) {
  return normalizedName(value)
    .split(' ')
    .filter((token) => token && !DEDUPE_NAME_TOKENS.has(token))
    .join(' ');
}

function distanceMeters(left, right) {
  const leftLatitude = Number(left?.latitude);
  const leftLongitude = Number(left?.longitude);
  const rightLatitude = Number(right?.latitude);
  const rightLongitude = Number(right?.longitude);
  if (![leftLatitude, leftLongitude, rightLatitude, rightLongitude].every(Number.isFinite)) return Infinity;
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = (rightLatitude - leftLatitude) * Math.PI / 180;
  const longitudeDelta = (rightLongitude - leftLongitude) * Math.PI / 180;
  const latitudeA = leftLatitude * Math.PI / 180;
  const latitudeB = rightLatitude * Math.PI / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function rowQuality(row) {
  return (text(row?.catalogStatus, 'active') === 'active' ? 8 : 0)
    + (text(row?.address) ? 3 : 0)
    + (text(row?.phone) ? 2 : 0)
    + (row?.weeklyHours && typeof row.weeklyHours === 'object' ? 2 : 0)
    + (text(row?.imageUrl) || text(row?.image) || (Array.isArray(row?.photos) && row.photos.length) ? 4 : 0)
    + (Array.isArray(row?.tags) ? Math.min(row.tags.length, 4) : 0);
}

function mergeDuplicateRows(left, right) {
  const winner = rowQuality(right) > rowQuality(left) ? right : left;
  const other = winner === left ? right : left;
  return {
    ...winner,
    address: text(winner.address) || text(other.address) || undefined,
    phone: text(winner.phone) || text(other.phone) || undefined,
    weeklyHours: winner.weeklyHours ?? other.weeklyHours,
    imageUrl: text(winner.imageUrl) || text(other.imageUrl) || undefined,
    image: text(winner.image) || text(other.image) || undefined,
    photos: Array.isArray(winner.photos) && winner.photos.length ? winner.photos : other.photos
  };
}

/**
 * DENUE and OSM frequently describe the same storefront with different IDs
 * and slightly different names. Keep one offline row when the names resolve
 * to the same business within 120 metres. The server performs the same
 * reconciliation for live results; this prevents the offline snapshot from
 * wasting result slots on cross-source duplicates.
 */
function dedupeRows(input) {
  const rows = [];
  const buckets = new Map();
  let duplicateRows = 0;
  const bucketSize = 0.001;

  for (const row of input) {
    const latitude = Number(row?.latitude);
    const longitude = Number(row?.longitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      rows.push(row);
      continue;
    }

    const name = normalizedName(row?.name ?? row?.taqueriaName);
    const canonical = canonicalName(row?.name ?? row?.taqueriaName);
    const address = normalizedName(row?.address);
    const bucketLat = Math.floor(latitude / bucketSize);
    const bucketLng = Math.floor(longitude / bucketSize);
    let duplicateIndex;

    for (let lat = bucketLat - 1; lat <= bucketLat + 1 && duplicateIndex === undefined; lat += 1) {
      for (let lng = bucketLng - 1; lng <= bucketLng + 1 && duplicateIndex === undefined; lng += 1) {
        const bucket = buckets.get(`${lat}:${lng}`) ?? [];
        for (const candidateIndex of bucket) {
          const candidate = rows[candidateIndex];
          const distance = distanceMeters(row, candidate);
          if (distance > 120) continue;
          const candidateName = normalizedName(candidate?.name ?? candidate?.taqueriaName);
          const candidateCanonical = canonicalName(candidate?.name ?? candidate?.taqueriaName);
          const candidateAddress = normalizedName(candidate?.address);
          const sameName = Boolean(name && candidateName && name === candidateName);
          const sameCanonicalName = Boolean(canonical && candidateCanonical && canonical.length >= 4 && canonical === candidateCanonical);
          const sameAddress = Boolean(address && candidateAddress && address === candidateAddress);
          if (sameName || sameCanonicalName || sameAddress) {
            duplicateIndex = candidateIndex;
            break;
          }
        }
      }
    }

    if (duplicateIndex === undefined) {
      const index = rows.push(row) - 1;
      const key = `${bucketLat}:${bucketLng}`;
      const bucket = buckets.get(key) ?? [];
      bucket.push(index);
      buckets.set(key, bucket);
    } else {
      rows[duplicateIndex] = mergeDuplicateRows(rows[duplicateIndex], row);
      duplicateRows += 1;
    }
  }

  return { rows, duplicateRows };
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
    const seen = new Set();
    const merged = [...denueRows, ...osmRows].filter((row) => {
      const key = catalogRowKey(row);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
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
const dedupeResult = dedupeRows(rows);
rows = dedupeResult.rows;
rows = rows.filter((row) => hasCommercialName(row?.name ?? row?.taqueriaName));
// Keep valid review records visible in the offline snapshot.  They are not
// treated as verified; the app labels them so we do not silently lose places
// that came from DENUE, OSM, or a user-provided catalog.  Set the env flag to
// false only for a deliberately verified-only export.
const includeReviewRows = process.env.MOBILE_INCLUDE_REVIEW !== 'false';
const candidateRows = rows.filter((row) => {
  const status = text(row?.catalogStatus, 'active');
  return (status === 'active' || (includeReviewRows && status === 'needs_review')) && isTacoCandidate(row);
});
if (!candidateRows.length) throw new Error('El catálogo móvil no contiene sucursales activas');

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

function selectOfflineRows(rows) {
  const configuredLimit = Number.parseInt(process.env.MOBILE_OFFLINE_LIMIT ?? '2500', 10);
  const limit = Number.isFinite(configuredLimit) ? Math.max(500, Math.min(configuredLimit, rows.length)) : Math.min(2500, rows.length);
  if (rows.length <= limit) return rows;

  // Keep a small deterministic sample in every 3 km-ish geographic bucket so
  // the offline fallback is useful throughout CDMX and Estado de México. The
  // complete catalog remains in Postgres; the app only needs a rescue index.
  const bucketLimit = 5;
  const buckets = new Map();
  const selected = [];
  const ranked = [...rows].sort((left, right) => rowQuality(right) - rowQuality(left) || normalizedName(left.name).localeCompare(normalizedName(right.name)) || text(left.id).localeCompare(text(right.id)));
  for (const row of ranked) {
    if (selected.length >= limit) break;
    const bucketKey = `${Math.floor(Number(row.latitude) / 0.03)}:${Math.floor(Number(row.longitude) / 0.03)}`;
    const count = buckets.get(bucketKey) ?? 0;
    if (count >= bucketLimit) continue;
    buckets.set(bucketKey, count + 1);
    selected.push(row);
  }
  if (selected.length < limit) {
    const selectedIds = new Set(selected.map((row) => text(row.id)));
    for (const row of ranked) {
      if (selected.length >= limit) break;
      if (selectedIds.has(text(row.id))) continue;
      selectedIds.add(text(row.id));
      selected.push(row);
    }
  }
  return selected;
}

const selectedRows = selectOfflineRows(candidateRows);

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
  duplicateRowsRemoved: dedupeResult.duplicateRows,
  candidateRows: candidateRows.length,
  offlineLimit: places.length,
  offlineTruncated: candidateRows.length > places.length,
  includedActive: places.filter((place) => place.catalogStatus === 'active').length,
  includedNeedsReview: places.filter((place) => place.catalogStatus === 'needs_review').length,
  excludedRows: inputRowsCount - places.length
};

// Keep the bundled snapshot as a compact coordinate/name index. Full Place
// objects are created only for results that are actually shown. In
// particular, do not repeat source attribution and illustrative photo data
// 30k times: that used to make the Android JS bundle ~80 MB and forced the
// entire catalog into memory during startup.
const serializedRows = JSON.stringify(JSON.stringify(places));
const output = `// Generated by scripts/build-mobile-catalog.mjs. Do not edit by hand.\n\nexport type OfflineCatalogRow = {\n  id: string;\n  taqueriaId: string;\n  taqueriaName: string;\n  name: string;\n  neighborhood: string;\n  openUntil: string;\n  rating: number;\n  style: string;\n  coordinates: { latitude: number; longitude: number };\n  address?: string;\n  phone?: string;\n  weeklyHours?: Record<string, Array<{ open: string; close: string }>>;\n  hoursKnown?: boolean;\n  priceMin?: number;\n  priceMax?: number;\n  sourceKey: 'denue' | 'osm' | 'manual';\n  catalogStatus: 'active' | 'needs_review';\n  image: string;\n  imageIsIllustrative: boolean;\n  description?: string;\n  tacos?: Array<{ id: string; name: string; rating: number; price: number; note: string }>;\n  photos?: Array<{ url: string; sourceUrl?: string; license: string; attribution: string; source: 'catalog' }>;\n  tags?: string[];\n};\n\nexport const catalogMetadata = ${JSON.stringify(metadata)} as const;\nexport const catalogRevision = catalogMetadata.exportedAt;\n\nconst rawRows: unknown = JSON.parse(${serializedRows});\nexport const catalogRows = rawRows as OfflineCatalogRow[];\n`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, 'utf8');
console.log(`Mobile catalog generated: ${places.length} branches from ${inputPath}`);
