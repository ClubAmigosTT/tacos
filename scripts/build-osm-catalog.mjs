import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const inputPath = resolve(process.env.OSM_ENRICHED_FILE ?? 'taquerias_enriquecidas.json');
const discoveryPath = resolve(process.env.OSM_DISCOVERY_FILE ?? 'taqueria_ids.csv');
const outputPath = resolve(process.env.OSM_CATALOG_FILE ?? 'catalog/osm-cdmx-edomex.json');
const denueCatalogPath = resolve(process.env.DENUE_CATALOG_FILE ?? 'catalog/denue-cdmx-edomex.json');
const boundaryPath = resolve(process.env.OSM_BOUNDARIES_FILE ?? 'catalog/osm-boundaries.json');
const nominatimUrl = (process.env.NOMINATIM_URL?.trim() || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const userAgent = process.env.TACO_DISCOVERY_USER_AGENT?.trim() || 'TacosCatalog/1.0 (local catalog boundary preparation)';
const refreshBoundaries = process.env.OSM_REFRESH_BOUNDARIES === 'true';
// Candidate rows are retained for coverage and moderation, but receive
// catalogStatus=needs_review so the public API does not show them by default.
const includeCandidates = process.env.OSM_INCLUDE_CANDIDATES !== 'false';

const dayKeys = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const dayAliases = new Map([
  ['mo', 'mon'], ['tu', 'tue'], ['we', 'wed'], ['th', 'thu'], ['fr', 'fri'], ['sa', 'sat'], ['su', 'sun'],
  ['lu', 'mon'], ['ma', 'tue'], ['mi', 'wed'], ['ju', 'thu'], ['vi', 'fri'], ['sa', 'sat'], ['do', 'sun']
]);

function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim() || fallback : fallback;
}

function httpsUrl(value) {
  const candidate = text(value);
  try {
    return new URL(candidate).protocol === 'https:' ? candidate : '';
  } catch {
    return '';
  }
}

function unique(values) {
  return [...new Set(values.map((value) => text(value).toLowerCase()).filter(Boolean))];
}

function normalizedKey(value) {
  return text(value)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

const CDMX_ALCALDIAS = new Map([
  ['alvaro obregon', 'Álvaro Obregón'],
  ['azcapotzalco', 'Azcapotzalco'],
  ['benito juarez', 'Benito Juárez'],
  ['coyoacan', 'Coyoacán'],
  ['cuajimalpa', 'Cuajimalpa de Morelos'],
  ['cuajimalpa de morelos', 'Cuajimalpa de Morelos'],
  ['cuauhtemoc', 'Cuauhtémoc'],
  ['gustavo a madero', 'Gustavo A. Madero'],
  ['iztacalco', 'Iztacalco'],
  ['iztapalapa', 'Iztapalapa'],
  ['la magdalena contreras', 'La Magdalena Contreras'],
  ['magdalena contreras', 'La Magdalena Contreras'],
  ['miguel hidalgo', 'Miguel Hidalgo'],
  ['milpa alta', 'Milpa Alta'],
  ['tlahuac', 'Tláhuac'],
  ['tlalpan', 'Tlalpan'],
  ['venustiano carranza', 'Venustiano Carranza'],
  ['xochimilco', 'Xochimilco'],
]);

const GENERIC_ADMIN_KEYS = new Set([
  'ciudad de mexico',
  'cdmx',
  'distrito federal',
  'mexico df',
  'mexico d f',
  'mexico city',
  'estado de mexico',
  'edomex',
  'mexico',
]);

function isGenericAdmin(value) {
  const key = normalizedKey(value);
  return !key || GENERIC_ADMIN_KEYS.has(key);
}

function boundaryContains(value, name) {
  const valueKey = normalizedKey(value);
  const nameKey = normalizedKey(name);
  if (!valueKey || !nameKey) return false;
  return valueKey === nameKey
    || valueKey.startsWith(`${nameKey} `)
    || valueKey.endsWith(` ${nameKey}`)
    || valueKey.includes(` ${nameKey} `);
}

async function loadCanonicalMunicipalities() {
  const names = new Map();
  for (const label of CDMX_ALCALDIAS.values()) names.set(normalizedKey(label), label);
  try {
    const document = JSON.parse(await readFile(denueCatalogPath, 'utf8'));
    const branches = Array.isArray(document) ? document : document?.branches;
    for (const branch of branches ?? []) {
      const state = normalizedKey(branch?.state);
      const municipality = text(branch?.municipality);
      if (!municipality || isGenericAdmin(municipality)) continue;
      if (state === 'estado de mexico' || state === 'edomex') {
        names.set(normalizedKey(municipality), municipality);
      }
    }
  } catch {
    // The OSM-only build remains usable when the DENUE feed is not present.
  }
  return [...names.entries()]
    .sort((left, right) => right[0].length - left[0].length)
    .map(([key, label]) => ({ key, label }));
}

function canonicalAdminName(value, coverage, canonicalMunicipalities) {
  const raw = text(value);
  const key = normalizedKey(raw);
  if (!key || isGenericAdmin(raw)) return '';

  if (coverage === 'cdmx') {
    for (const [alias, label] of [...CDMX_ALCALDIAS.entries()].sort((left, right) => right[0].length - left[0].length)) {
      if (boundaryContains(key, alias)) return label;
    }
    return '';
  }

  for (const item of canonicalMunicipalities) {
    if (coverage === 'edomex' && CDMX_ALCALDIAS.has(item.key)) continue;
    if (key === item.key || key.startsWith(`${item.key} `) || item.key.startsWith(`${key} `)) {
      return item.label;
    }
  }
  return '';
}

function municipalityFor(place, coverage, canonicalMunicipalities) {
  const directValues = [place.municipality, place.city];
  const contextualValues = [
    place.neighborhood,
    ...text(place.address).split(',').map((value) => value.trim()),
  ];

  for (const value of directValues) {
    const canonical = canonicalAdminName(value, coverage, canonicalMunicipalities);
    if (canonical) return { name: canonical, inferred: canonical !== text(value) };
  }
  for (const value of contextualValues) {
    const canonical = canonicalAdminName(value, coverage, canonicalMunicipalities);
    if (canonical) return { name: canonical, inferred: true };
  }

  const fallback = directValues.map(text).find((value) => value && !isGenericAdmin(value));
  return { name: fallback || regionName(coverage), inferred: false };
}

function minutes(value) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : undefined;
}

function normalizeTime(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return undefined;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (minute > 59 || hour > 24 || (hour === 24 && minute !== 0)) return undefined;
  // The app and database use HH:mm and do not accept 24:00. Treat midnight
  // as the last minute of the day for display and open-now calculations.
  const normalizedHour = hour === 24 ? 23 : hour;
  const normalizedMinute = hour === 24 ? 59 : minute;
  return `${String(normalizedHour).padStart(2, '0')}:${String(normalizedMinute).padStart(2, '0')}`;
}

function expandDays(expression) {
  const tokens = expression.match(/Mo|Tu|We|Th|Fr|Sa|Su|Lu|Ma|Mi|Ju|Vi|Do/gi)?.map((token) => dayAliases.get(token.toLowerCase())) ?? [];
  const validTokens = tokens.filter(Boolean);
  if (!validTokens.length) return [];
  if (!expression.includes('-')) return [...new Set(validTokens)];

  const start = dayKeys.indexOf(validTokens[0]);
  const end = dayKeys.indexOf(validTokens[1] ?? validTokens[0]);
  if (start < 0 || end < 0) return [];
  const days = [];
  for (let index = start, count = 0; count < dayKeys.length; count += 1, index = (index + 1) % dayKeys.length) {
    days.push(dayKeys[index]);
    if (index === end) break;
  }
  return days;
}

function parseOpeningHours(value) {
  const raw = text(value);
  if (!raw) return { weeklyHours: undefined, openUntil: '23:00' };

  const weeklyHours = Object.fromEntries(dayKeys.map((day) => [day, []]));
  const normalized = raw.replace(/\s+/g, ' ').trim();
  if (/^24\/7$/i.test(normalized)) {
    for (const day of dayKeys) weeklyHours[day].push({ open: '00:00', close: '23:59' });
    return { weeklyHours, openUntil: '23:59' };
  }

  // Split on semicolons, or on a comma that starts a new day expression. A
  // plain comma inside the time part is kept so multiple intervals survive.
  const segments = normalized.split(/\s*;\s*|\s*,\s*(?=(?:Mo|Tu|We|Th|Fr|Sa|Su|Lu|Ma|Mi|Ju|Vi|Do)(?:\s|[-,]))/i);
  let parsedIntervals = 0;
  let latestClose;

  for (const segment of segments) {
    if (/\boff\b|\bclosed\b|\bcerrado\b/i.test(segment)) continue;
    const timeMatches = [...segment.matchAll(/(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})/g)];
    if (!timeMatches.length) continue;

    const dayMatch = /^((?:(?:Mo|Tu|We|Th|Fr|Sa|Su|Lu|Ma|Mi|Ju|Vi|Do)(?:\s*[-,]\s*)?)+)\s+/i.exec(segment);
    const days = dayMatch ? expandDays(dayMatch[1]) : [...dayKeys];
    if (!days.length) continue;

    for (const timeMatch of timeMatches) {
      const open = normalizeTime(timeMatch[1]);
      const close = normalizeTime(timeMatch[2]);
      if (!open || !close || open === close) continue;
      if (!latestClose || (minutes(close) ?? 0) > (minutes(latestClose) ?? 0)) latestClose = close;
      for (const day of days) {
        const interval = { open, close };
        if (!weeklyHours[day].some((item) => item.open === open && item.close === close)) weeklyHours[day].push(interval);
      }
      parsedIntervals += 1;
    }
  }

  if (!parsedIntervals) return { weeklyHours: undefined, openUntil: '23:00' };
  return { weeklyHours, openUntil: latestClose ?? '23:00' };
}

function pointInRing(longitude, latitude, ring) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index, index += 1) {
    const [xi, yi] = ring[index];
    const [xj, yj] = ring[previous];
    const intersects = ((yi > latitude) !== (yj > latitude))
      && longitude < ((xj - xi) * (latitude - yi)) / ((yj - yi) || Number.EPSILON) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(longitude, latitude, rings) {
  if (!rings?.[0] || !pointInRing(longitude, latitude, rings[0])) return false;
  return !rings.slice(1).some((ring) => pointInRing(longitude, latitude, ring));
}

function pointInGeometry(longitude, latitude, geometry) {
  if (!geometry) return false;
  if (geometry.type === 'Polygon') return pointInPolygon(longitude, latitude, geometry.coordinates);
  if (geometry.type === 'MultiPolygon') return geometry.coordinates.some((polygon) => pointInPolygon(longitude, latitude, polygon));
  if (geometry.type === 'Feature') return pointInGeometry(longitude, latitude, geometry.geometry);
  return false;
}

async function fetchBoundary(state) {
  const params = new URLSearchParams({ format: 'jsonv2', polygon_geojson: '1', limit: '1', country: 'Mexico', state });
  const response = await fetch(`${nominatimUrl}/search?${params}`, {
    headers: { Accept: 'application/json', 'User-Agent': userAgent }
  });
  if (!response.ok) throw new Error(`Nominatim respondió ${response.status} para ${state}`);
  const results = await response.json();
  const result = Array.isArray(results) ? results.find((item) => item?.geojson) : undefined;
  if (!result?.geojson) throw new Error(`Nominatim no devolvió geometría para ${state}`);
  return { name: state, osmType: result.osm_type, osmId: result.osm_id, geometry: result.geojson };
}

async function loadBoundaries() {
  if (!refreshBoundaries) {
    try {
      const cached = JSON.parse(await readFile(boundaryPath, 'utf8'));
      if (Array.isArray(cached?.boundaries) && cached.boundaries.length === 2) return cached.boundaries;
    } catch {
      // The first build fetches the small administrative geometries and caches them.
    }
  }

  const boundaries = [];
  for (const state of ['Ciudad de México', 'Estado de México']) {
    if (boundaries.length) await new Promise((resolvePromise) => setTimeout(resolvePromise, 1100));
    console.log(`Descargando límite administrativo: ${state}`);
    boundaries.push(await fetchBoundary(state));
  }
  await mkdir(resolve(boundaryPath, '..'), { recursive: true });
  await writeFile(boundaryPath, `${JSON.stringify({ source: 'Nominatim/OpenStreetMap', fetchedAt: new Date().toISOString(), boundaries }, null, 2)}\n`, 'utf8');
  return boundaries;
}

function coverageForPlace(place, boundaries) {
  const inCdmx = pointInGeometry(place.longitude, place.latitude, boundaries[0].geometry);
  const inEdomex = pointInGeometry(place.longitude, place.latitude, boundaries[1].geometry);
  if (inCdmx && inEdomex) return 'cdmx-edomex';
  if (inCdmx) return 'cdmx';
  if (inEdomex) return 'edomex';
  return undefined;
}

function regionName(coverage) {
  return coverage === 'cdmx' ? 'Ciudad de México' : 'Estado de México';
}

function slug(value) {
  return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64);
}

function dedupeKey(name, latitude, longitude) {
  return `${slug(name)}:${Number(latitude).toFixed(4)}:${Number(longitude).toFixed(4)}`;
}

function styleFromCuisine(value) {
  const cuisine = text(value).toLowerCase();
  if (cuisine.includes('pastor')) return 'Pastor';
  if (cuisine.includes('birria')) return 'Birria';
  if (cuisine.includes('carnita')) return 'Carnitas';
  if (cuisine.includes('barbacoa')) return 'Barbacoa';
  if (cuisine.includes('suadero')) return 'Suadero';
  return 'Clásico callejero';
}

function businessType(place, name, description) {
  const textValue = [
    name,
    description,
    place.brand,
    place.official_name,
    place.alt_name,
    place.operator,
    place.dish,
    place.menu,
    place.product,
    place.cuisine,
    place.amenity,
  ].map(text).join(' ').toLowerCase();
  if (textValue.includes('food truck') || textValue.includes('camion')) return 'food_truck';
  if (textValue.includes('puesto') || textValue.includes('street_vendor')) return 'street_taco_stand';
  if (textValue.includes('canasta')) return 'tacos_de_canasta';
  if (/(tacos?|taquer[ií]a|birria|carnitas?|barbacoa|suadero|pastor)/i.test(`${name} ${description} ${text(place.cuisine)}`)) return 'taqueria';
  return 'candidate';
}

const tacoSignalPattern = /\b(?:tacos?|taquer[ií]a|birria|carnitas?|barbacoa|suadero|pastor|canasta|cabeza|trompo|quesabirria|guisad[oa]s?)\b/i;

function hasTacoSignal(place) {
  return tacoSignalPattern.test([
    text(place.name),
    text(place.brand),
    text(place.official_name),
    text(place.alt_name),
    text(place.operator),
    text(place.description),
    text(place.dish),
    text(place.menu),
    text(place.product),
    text(place.cuisine).replaceAll(';', ' ')
  ].join(' '));
}

function stableId(place) {
  const providerId = text(place.provider_id, text(place.source_id));
  return providerId.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '');
}

function parseCsvLine(line) {
  const values = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === ',' && !quoted) {
      values.push(value);
      value = '';
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function parseDiscoveryCsv(document) {
  const lines = document.split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = parseCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = parseCsvLine(line);
    return Object.fromEntries(headers.map((header, index) => [header, values[index] ?? '']));
  });
}

const raw = JSON.parse(await readFile(inputPath, 'utf8'));
const enrichedPlaces = Array.isArray(raw) ? raw : raw?.places;
if (!Array.isArray(enrichedPlaces)) throw new Error('El archivo enriquecido debe ser un array o contener { places: [] }');

let discoveryPlaces = [];
try {
  discoveryPlaces = parseDiscoveryCsv(await readFile(discoveryPath, 'utf8'));
} catch (error) {
  if (error?.code !== 'ENOENT') throw error;
}

const placesBySourceId = new Map();
for (const place of enrichedPlaces) {
  const sourceId = text(place.provider_id, text(place.source_id));
  if (sourceId) placesBySourceId.set(sourceId, place);
}
for (const place of discoveryPlaces) {
  const sourceId = text(place.provider_id, text(place.source_id));
  if (!sourceId || placesBySourceId.has(sourceId)) continue;
  placesBySourceId.set(sourceId, place);
}
const places = [...placesBySourceId.values()];

const boundaries = await loadBoundaries();
const canonicalMunicipalities = await loadCanonicalMunicipalities();
const seenSourceIds = new Set();
const seenDedupeKeys = new Set();
const branches = [];
let highRows = 0;
let namedHighRows = 0;
let candidateRows = 0;
let namedCandidateRows = 0;
let outsideRows = 0;
let duplicateRows = 0;

for (const place of places) {
  const sourceConfidence = text(place.confidence);
  const signalPresent = hasTacoSignal(place);
  // Re-evaluate historical rows with the current word-boundary classifier.
  // This prevents names such as "Espartaco" from becoming active only because
  // an older run used a substring match for "taco".
  const confidence = signalPresent ? sourceConfidence : 'candidate';
  const matchReason = signalPresent ? text(place.match_reason) : 'needs_review_signal';
  if (confidence !== 'high' && (!includeCandidates || confidence !== 'candidate')) continue;
  if (confidence === 'high') highRows += 1;
  else candidateRows += 1;
  const originalName = text(
    place.name,
    text(place.brand, text(place.official_name, text(place.alt_name)))
  );
  if (originalName) {
    if (confidence === 'high') namedHighRows += 1;
    else namedCandidateRows += 1;
  }

  const latitude = Number(place.latitude);
  const longitude = Number(place.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
  const coverage = coverageForPlace({ latitude, longitude }, boundaries);
  if (!coverage) {
    outsideRows += 1;
    continue;
  }

  const sourcePlaceId = text(place.provider_id, text(place.source_id));
  if (seenSourceIds.has(sourcePlaceId)) {
    duplicateRows += 1;
    continue;
  }
  seenSourceIds.add(sourcePlaceId);

  const name = originalName || 'Puesto de tacos por verificar';
  const key = dedupeKey(name, place.latitude, place.longitude);
  if (seenDedupeKeys.has(key)) {
    duplicateRows += 1;
    continue;
  }
  seenDedupeKeys.add(key);

  const id = `osm-${stableId(place)}`;
  const parsedHours = parseOpeningHours(place.opening_hours);
  const cityOrNeighborhood = text(place.neighborhood, text(place.city, regionName(coverage)));
  const municipalityInfo = municipalityFor(place, coverage, canonicalMunicipalities);
  const municipality = municipalityInfo.name;
  const cuisineTags = text(place.cuisine).split(';');
  const generatedName = !originalName;
  const tags = unique([
    'tacos',
    'openstreetmap',
    coverage,
    ...cuisineTags,
    place.amenity,
    municipalityInfo.inferred ? 'admin-normalized' : '',
    `confidence-${confidence || 'candidate'}`,
    matchReason ? `reason-${matchReason}` : '',
    generatedName ? 'generated-name' : '',
    generatedName ? 'needs-review' : '',
  ]);
  const sourceUpdatedAt = text(place.details_updated_at, text(place.last_seen_at, text(raw.exportedAt)));
  const website = text(place.website);
  const imageUrl = httpsUrl(place.image_url);
  const photos = imageUrl ? [{
    url: imageUrl,
    sourceUrl: imageUrl,
    license: 'Licencia no indicada por la fuente',
    attribution: 'Imagen enlazada en el registro de OpenStreetMap'
  }] : [];

  const description = text(place.description, generatedName ? 'Puesto de tacos identificado en OpenStreetMap; nombre pendiente de confirmar.' : '');
  const branch = {
    id,
    taqueriaId: id,
    taqueriaName: name,
    name,
    neighborhood: cityOrNeighborhood,
    municipality,
    state: regionName(coverage),
    latitude,
    longitude,
    ...(text(place.address) ? { address: text(place.address) } : {}),
    ...(text(place.phone) ? { phone: text(place.phone) } : {}),
    ...(parsedHours.weeklyHours ? { weeklyHours: parsedHours.weeklyHours } : {}),
    openUntil: parsedHours.openUntil,
    style: styleFromCuisine(place.cuisine),
    description,
    tags,
    businessType: businessType(place, name, description),
    confidence,
    matchReason,
    rating: 0,
    sourceName: 'osm-cdmx-edomex',
    sourcePlaceId,
    sourceUrl: text(raw.sourceUrl, 'https://www.openstreetmap.org'),
    sourceLicense: text(raw.license, 'ODbL 1.0'),
    sourceAttribution: text(raw.attribution, '© OpenStreetMap contributors'),
    sourceUpdatedAt,
    // Both high-confidence and candidate rows are source-backed catalog data.
    // Candidate rows stay visible so the community can correct them in-app.
    catalogQuality: 'catalog',
    catalogStatus: confidence === 'high' && !generatedName ? 'active' : 'needs_review',
    ...(website.startsWith('https://') ? { website } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    photos,
    tacos: []
  };
  branches.push(branch);
}

branches.sort((left, right) => left.name.localeCompare(right.name, 'es') || left.id.localeCompare(right.id));
await mkdir(resolve(outputPath, '..'), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({
  source: 'OpenStreetMap',
  sourceUrl: text(raw.sourceUrl, 'https://www.openstreetmap.org'),
  license: text(raw.license, 'ODbL 1.0'),
  attribution: text(raw.attribution, '© OpenStreetMap contributors'),
  exportedAt: new Date().toISOString(),
  coverage: ['Ciudad de México', 'Estado de México'],
  selection: includeCandidates
    ? 'confidence=high o candidate dentro de los límites administrativos de CDMX o Edomex; los candidatos y lugares sin nombre quedan needs_review'
    : 'confidence=high, nombre no vacío dentro de los límites administrativos de CDMX o Edomex',
  stats: { inputRows: places.length, highRows, namedHighRows, candidateRows, namedCandidateRows, outsideRows, duplicateRows, branches: branches.length },
  branches
}, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
  input: inputPath,
  output: outputPath,
  boundaries: boundaryPath,
  inputRows: places.length,
  highRows,
  namedHighRows,
  candidateRows,
  namedCandidateRows,
  outsideRows,
  duplicateRows,
  branches: branches.length
}, null, 2));
