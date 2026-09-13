import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const inputPath = resolve(process.env.OSM_ENRICHED_FILE ?? 'taquerias_enriquecidas.json');
const outputPath = resolve(process.env.OSM_CATALOG_FILE ?? 'catalog/osm-cdmx-edomex.json');
const boundaryPath = resolve(process.env.OSM_BOUNDARIES_FILE ?? 'catalog/osm-boundaries.json');
const nominatimUrl = (process.env.NOMINATIM_URL?.trim() || 'https://nominatim.openstreetmap.org').replace(/\/$/, '');
const userAgent = process.env.TACO_DISCOVERY_USER_AGENT?.trim() || 'TacosCatalog/1.0 (local catalog boundary preparation)';
const refreshBoundaries = process.env.OSM_REFRESH_BOUNDARIES === 'true';

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

function stableId(place) {
  const providerId = text(place.provider_id, text(place.source_id));
  return providerId.replace(/[^a-zA-Z0-9_-]+/g, '-').toLowerCase().replace(/^-+|-+$/g, '');
}

const raw = JSON.parse(await readFile(inputPath, 'utf8'));
const places = Array.isArray(raw) ? raw : raw?.places;
if (!Array.isArray(places)) throw new Error('El archivo enriquecido debe ser un array o contener { places: [] }');

const boundaries = await loadBoundaries();
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
  const confidence = text(place.confidence);
  if (confidence !== 'high' && confidence !== 'candidate') continue;
  if (confidence === 'high') highRows += 1;
  else candidateRows += 1;
  const name = text(place.name);
  if (!name) continue;
  if (confidence === 'high') namedHighRows += 1;
  else namedCandidateRows += 1;

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

  const key = dedupeKey(name, place.latitude, place.longitude);
  if (seenDedupeKeys.has(key)) {
    duplicateRows += 1;
    continue;
  }
  seenDedupeKeys.add(key);

  const id = `osm-${stableId(place)}`;
  const parsedHours = parseOpeningHours(place.opening_hours);
  const cityOrNeighborhood = text(place.neighborhood, text(place.city, regionName(coverage)));
  const cuisineTags = text(place.cuisine).split(';');
  const tags = unique(['tacos', 'openstreetmap', coverage, ...cuisineTags, place.amenity]);
  const sourceUpdatedAt = text(place.details_updated_at, text(place.last_seen_at, text(raw.exportedAt)));
  const website = text(place.website);
  const imageUrl = httpsUrl(place.image_url);
  const photos = imageUrl ? [{
    url: imageUrl,
    sourceUrl: imageUrl,
    license: 'Licencia no indicada por la fuente',
    attribution: 'Imagen enlazada en el registro de OpenStreetMap'
  }] : [];

  const branch = {
    id,
    taqueriaId: id,
    taqueriaName: name,
    name,
    neighborhood: cityOrNeighborhood,
    latitude,
    longitude,
    ...(text(place.address) ? { address: text(place.address) } : {}),
    ...(text(place.phone) ? { phone: text(place.phone) } : {}),
    ...(parsedHours.weeklyHours ? { weeklyHours: parsedHours.weeklyHours } : {}),
    openUntil: parsedHours.openUntil,
    style: styleFromCuisine(place.cuisine),
    description: text(place.description),
    tags,
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
    catalogStatus: 'active',
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
  selection: 'confidence=high o candidate, nombre no vacío dentro de los límites administrativos de CDMX o Edomex',
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
