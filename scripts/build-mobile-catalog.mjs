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

function catalogRowKey(row) {
  const sourceName = text(row?.sourceName);
  const sourcePlaceId = text(row?.sourcePlaceId);
  if (sourceName && sourcePlaceId) return `source:${sourceName}:${sourcePlaceId}`;
  const latitude = Number(row?.latitude);
  const longitude = Number(row?.longitude);
  const name = text(row?.name).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  return `place:${name}:${latitude.toFixed(4)}:${longitude.toFixed(4)}`;
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
const includeReviewRows = process.env.MOBILE_INCLUDE_REVIEW === 'true';
const selectedRows = rows.filter((row) => includeReviewRows || text(row?.catalogStatus, 'active') === 'active');
if (!selectedRows.length) throw new Error('El catálogo móvil no contiene sucursales activas');

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
      attribution: text(photo.attribution, '© OpenStreetMap contributors')
    }));
}

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
  const sourceName = text(row?.sourceName, text(raw.source, 'OpenStreetMap'));
  const sourceUrl = text(row?.sourceUrl, text(raw.sourceUrl));
  const sourceLicense = text(row?.sourceLicense, text(raw.license, 'ODbL 1.0'));
  const sourceAttribution = text(row?.sourceAttribution, text(raw.attribution, '© OpenStreetMap contributors'));
  const tags = Array.isArray(row?.tags) ? [...new Set(row.tags.map((tag) => text(tag)).filter(Boolean))] : [];
  const image = text(row?.imageUrl) || text(row?.image);
  const photos = normalizedPhotos(row?.photos);

  return {
    id,
    taqueriaId: text(row?.taqueriaId, id),
    taqueriaName: text(row?.taqueriaName, name),
    name,
    neighborhood,
    distance: 'cerca de ti',
    openUntil: text(row?.openUntil, '23:00'),
    rating: numberOrUndefined(row?.rating) ?? 0,
    reviewCount: 0,
    style: text(row?.style, 'Clásico callejero'),
    coordinates: { latitude, longitude },
    ...(text(row?.address) ? { address: text(row.address) } : {}),
    ...(text(row?.phone) ? { phone: text(row.phone) } : {}),
    ...(hours ? { weeklyHours: hours, hoursKnown: true } : { hoursKnown: false }),
    ...(numberOrUndefined(row?.priceMin) !== undefined ? { priceMin: numberOrUndefined(row.priceMin) } : {}),
    ...(numberOrUndefined(row?.priceMax) !== undefined ? { priceMax: numberOrUndefined(row.priceMax) } : {}),
    source: {
      name: sourceName,
      url: sourceUrl,
      license: sourceLicense,
      attribution: sourceAttribution,
      ...(text(row?.sourceUpdatedAt) ? { updatedAt: text(row.sourceUpdatedAt) } : {})
    },
    image,
    description: text(row?.description),
    tacos: normalizedTacos(row?.tacos),
    photos,
    tags
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
  sourceRows: rows.length,
  excludedNeedsReview: rows.length - places.length
};

// Keep the bundled snapshot compact.  The catalog is read-only generated data;
// pretty-printing millions of repeated JSON characters needlessly increases
// the mobile binary and startup parse cost.
// Keep the generated data as an opaque value while TypeScript parses it. If
// the 25k-row literal is contextually typed as Place[] directly, the compiler
// tries to construct a huge union of every object shape and fails with TS2590.
const serializedPlaces = JSON.stringify(JSON.stringify(places));
const output = `// Generated by scripts/build-mobile-catalog.mjs. Do not edit by hand.\nimport type { Place } from './fixtures';\n\nexport const catalogMetadata = ${JSON.stringify(metadata)} as const;\nexport const catalogRevision = catalogMetadata.exportedAt;\n\nconst rawPlaces: unknown = JSON.parse(${serializedPlaces});\nexport const places = rawPlaces as Place[];\n`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, 'utf8');
console.log(`Mobile catalog generated: ${places.length} branches from ${inputPath}`);
