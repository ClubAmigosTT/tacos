import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const inputPath = resolve(root, process.env.MOBILE_CATALOG_SOURCE ?? 'catalog/osm-cdmx-edomex.json');
const outputPath = resolve(root, process.env.MOBILE_CATALOG_OUTPUT ?? 'apps/mobile/data/catalog.ts');

const raw = JSON.parse(await readFile(inputPath, 'utf8'));
const rows = Array.isArray(raw) ? raw : raw?.branches;
if (!Array.isArray(rows) || !rows.length) throw new Error('El catálogo móvil debe contener al menos una sucursal');

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

const places = rows.map((row, index) => {
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
  branchCount: places.length
};

// Keep the bundled snapshot compact.  The catalog is read-only generated data;
// pretty-printing millions of repeated JSON characters needlessly increases
// the mobile binary and startup parse cost.
const output = `// Generated by scripts/build-mobile-catalog.mjs. Do not edit by hand.\nimport type { Place } from './fixtures';\n\nexport const catalogMetadata = ${JSON.stringify(metadata)} as const;\nexport const catalogRevision = catalogMetadata.exportedAt;\n\nexport const places: Place[] = ${JSON.stringify(places)};\n`;

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output, 'utf8');
console.log(`Mobile catalog generated: ${places.length} branches from ${inputPath}`);
