import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL es obligatorio para importar el catálogo');

const inputPath = resolve(process.env.CATALOG_FILE ?? 'catalog/branches.json');
const feedUrl = process.env.CATALOG_FEED_URL?.trim();
const sourceName = process.env.CATALOG_SOURCE_NAME?.trim() || 'catalog-import';
const sourceUrl = process.env.CATALOG_SOURCE_URL?.trim() || null;
const sourceLicense = process.env.CATALOG_SOURCE_LICENSE?.trim() || null;
const replaceDemo = process.env.CATALOG_REPLACE_DEMO === 'true';
const reconcile = process.env.CATALOG_RECONCILE === 'true';
const isDemoSource = sourceName === 'demo';
const allowPartial = process.env.CATALOG_ALLOW_PARTIAL === 'true' || sourceName === 'osm-cdmx-edomex';

if (!isDemoSource && (!sourceUrl || !sourceLicense)) {
  throw new Error('CATALOG_SOURCE_URL y CATALOG_SOURCE_LICENSE son obligatorios para un catálogo real');
}
if (sourceUrl && !isHttpsUrl(sourceUrl)) throw new Error('CATALOG_SOURCE_URL debe usar HTTPS');

const raw = feedUrl
  ? await (async () => {
      if (!isHttpsUrl(feedUrl)) throw new Error('CATALOG_FEED_URL debe usar HTTPS');
      const response = await fetch(feedUrl);
      if (!response.ok) throw new Error(`CATALOG_FEED_URL respondió ${response.status}`);
      return response.json();
    })()
  : JSON.parse(await readFile(inputPath, 'utf8'));
const rows = Array.isArray(raw) ? raw : raw?.branches;
if (!Array.isArray(rows)) throw new Error('El catálogo debe ser un array o { branches: [] }');
if (!rows.length) throw new Error('El catálogo no puede estar vacío');

const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
const client = await pool.connect();
const errors = [];
const seenKeys = new Map();
const importedBranchIds = new Set();
let upserted = 0;
let duplicates = 0;
const requiredDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function text(value, fallback = '') { return typeof value === 'string' ? value.trim() : fallback; }
function slug(value) { return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64); }
function isHttpsUrl(value) {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
}
function timeToMinutes(value) {
  if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return undefined;
  const [hours, minutes] = value.split(':').map(Number);
  return hours * 60 + minutes;
}
function validHours(hours) {
  return hours && typeof hours === 'object' && requiredDays.every((day) => Array.isArray(hours[day]) && hours[day].every((interval) => {
    const open = timeToMinutes(interval?.open);
    const close = timeToMinutes(interval?.close);
    return open !== undefined && close !== undefined && open !== close;
  }));
}
function validPhoto(photo) {
  if (!photo || !isHttpsUrl(text(photo.url)) || text(photo.license).length < 2 || text(photo.attribution).length < 2) return false;
  return !photo.sourceUrl || isHttpsUrl(text(photo.sourceUrl));
}
function numberOrUndefined(value) {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function validRating(value) {
  const parsed = numberOrUndefined(value);
  return parsed === undefined || (parsed >= 0 && parsed <= 5);
}
function validMatchScore(value) {
  const parsed = numberOrUndefined(value);
  return parsed === undefined || (parsed >= 0 && parsed <= 99);
}
function validPrice(value) {
  const parsed = numberOrUndefined(value);
  return parsed === undefined || (parsed >= 0 && parsed <= 100000);
}
function parseSourceDate(value) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('sourceUpdatedAt no es una fecha válida');
  return date;
}
function dedupeKey(row) { return `${slug(row.name)}:${Number(row.latitude).toFixed(4)}:${Number(row.longitude).toFixed(4)}`; }
function normalizedTags(value) {
  return Array.isArray(value) ? [...new Set(value.map((tag) => text(tag)).filter(Boolean))].slice(0, 30) : [];
}

try {
  await client.query('BEGIN');

  for (const [index, row] of rows.entries()) {
    try {
      const name = text(row?.name);
      const taqueriaName = text(row?.taqueriaName, name);
      const neighborhood = text(row?.neighborhood);
      const latitude = Number(row?.latitude);
      const longitude = Number(row?.longitude);
      const address = text(row?.address) || null;
      const hours = row?.weeklyHours;
      const rawPhotos = Array.isArray(row?.photos) ? row.photos : [];
      const photos = rawPhotos.filter(validPhoto);
      const priceMin = numberOrUndefined(row?.priceMin);
      const priceMax = numberOrUndefined(row?.priceMax);
      const rating = numberOrUndefined(row?.rating) ?? 0;
      const matchScore = numberOrUndefined(row?.matchScore);
      const openUntil = text(row?.openUntil, '23:00');
      const sourceUpdatedAt = parseSourceDate(row?.sourceUpdatedAt);
      const catalogStatus = text(row?.catalogStatus, 'active');
      const catalogQuality = text(row?.catalogQuality, allowPartial ? 'catalog' : 'verified');
      const normalizedHours = hours && validHours(hours) ? hours : {};
      const primary = photos.find((photo) => photo.isPrimary) || photos[0];
      const imageUrl = primary?.url || text(row?.imageUrl) || null;
      const sourceAttribution = text(row?.sourceAttribution) || primary?.attribution || null;

      if (!name || !neighborhood || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
        throw new Error('nombre, zona y coordenadas son obligatorios y válidos');
      }
      if (!allowPartial && !validHours(hours)) throw new Error('weeklyHours debe tener intervalos válidos para mon..sun');
      if (allowPartial && hours !== undefined && hours !== null && Object.keys(hours).length && !validHours(hours)) throw new Error('weeklyHours debe tener intervalos válidos para mon..sun');
      if (timeToMinutes(openUntil) === undefined) throw new Error('openUntil debe tener formato HH:mm');
      if (rawPhotos.length !== photos.length || (!allowPartial && !rawPhotos.length)) throw new Error('cada foto debe tener URL HTTPS, licencia, atribución y sourceUrl HTTPS opcional');
      if (!validPrice(priceMin) || !validPrice(priceMax) || (priceMin !== undefined && priceMax !== undefined && priceMin > priceMax)) throw new Error('priceMin y priceMax deben ser precios válidos');
      if (!validRating(row?.rating) || !validMatchScore(row?.matchScore)) throw new Error('rating y matchScore deben estar entre 0 y 5 / 0 y 99');
      if (!['active', 'needs_review', 'archived'].includes(catalogStatus)) throw new Error('catalogStatus no es válido');
      if (!['catalog', 'community', 'verified'].includes(catalogQuality)) throw new Error('catalogQuality no es válido');

      const id = text(row?.id) || `${slug(name)}-${Math.round((latitude + 90) * 10000)}-${Math.round((longitude + 180) * 10000)}`;
      const taqueriaId = text(row?.taqueriaId) || id;
      const sourcePlaceId = text(row?.sourcePlaceId) || null;
      const key = dedupeKey(row);
      if (seenKeys.has(key)) {
        duplicates += 1;
        errors.push({ index, message: `duplicado dentro del feed; también aparece en el registro ${seenKeys.get(key)}` });
        continue;
      }
      seenKeys.set(key, index);

      const duplicate = await client.query(`SELECT id FROM branches WHERE dedupe_key = $1 OR ($2::text IS NOT NULL AND source_name = $3 AND source_place_id = $2) LIMIT 1`, [key, sourcePlaceId, sourceName]);
      if (duplicate.rows[0] && duplicate.rows[0].id !== id) {
        duplicates += 1;
        await client.query("UPDATE branches SET catalog_status = 'needs_review', updated_at = now() WHERE id = $1", [duplicate.rows[0].id]);
        errors.push({ index, message: `conflicto con la sucursal existente ${duplicate.rows[0].id}` });
        continue;
      }

      const taqueriaSlug = `${slug(taqueriaName)}-${slug(taqueriaId).slice(-8)}`.slice(0, 64);
      await client.query(`
        INSERT INTO taquerias (id, name, slug, description)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, slug = EXCLUDED.slug, description = EXCLUDED.description, updated_at = now()
      `, [taqueriaId, taqueriaName, taqueriaSlug || `taqueria-${slug(taqueriaId)}`, text(row?.taqueriaDescription)]);

      const tags = normalizedTags(row?.tags);
      await client.query(`
        INSERT INTO branches (id, taqueria_id, name, neighborhood, address, phone, location, open_until, weekly_hours, price_min, price_max, style, image_url, image_license, image_attribution, image_source_url, description, tags, search_text, rating, match_score, is_active, source_name, source_place_id, source_url, source_license, source_attribution, source_updated_at, dedupe_key, catalog_status, catalog_quality, last_verified_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, true, $23, $24, $25, $26, $27, $28, $29, $30, $31, $32, now())
        ON CONFLICT (id) DO UPDATE SET taqueria_id = EXCLUDED.taqueria_id, name = EXCLUDED.name, neighborhood = EXCLUDED.neighborhood, address = EXCLUDED.address, phone = EXCLUDED.phone, location = EXCLUDED.location, open_until = EXCLUDED.open_until, weekly_hours = EXCLUDED.weekly_hours, price_min = EXCLUDED.price_min, price_max = EXCLUDED.price_max, style = EXCLUDED.style, image_url = EXCLUDED.image_url, image_license = EXCLUDED.image_license, image_attribution = EXCLUDED.image_attribution, image_source_url = EXCLUDED.image_source_url, description = EXCLUDED.description, tags = EXCLUDED.tags, search_text = EXCLUDED.search_text, rating = EXCLUDED.rating, match_score = EXCLUDED.match_score, source_name = EXCLUDED.source_name, source_place_id = EXCLUDED.source_place_id, source_url = EXCLUDED.source_url, source_license = EXCLUDED.source_license, source_attribution = EXCLUDED.source_attribution, source_updated_at = EXCLUDED.source_updated_at, dedupe_key = EXCLUDED.dedupe_key, catalog_status = EXCLUDED.catalog_status, catalog_quality = EXCLUDED.catalog_quality, last_verified_at = EXCLUDED.last_verified_at, is_active = true, updated_at = now()
      `, [id, taqueriaId, name, neighborhood, address, text(row?.phone) || null, longitude, latitude, openUntil, JSON.stringify(normalizedHours), priceMin ?? null, priceMax ?? null, text(row?.style, 'Clásico callejero'), imageUrl, primary?.license || null, primary?.attribution || null, primary?.sourceUrl || null, text(row?.description), tags, `${name} ${neighborhood} ${text(row?.style)} ${tags.join(' ')} ${Array.isArray(row?.tacos) ? row.tacos.map((taco) => text(taco?.name)).join(' ') : ''}`, rating, matchScore ?? null, sourceName, sourcePlaceId, sourceUrl, sourceLicense, sourceAttribution, sourceUpdatedAt, key, catalogStatus, catalogQuality, catalogQuality === 'verified' ? new Date() : null]);
      importedBranchIds.add(id);

      await client.query('DELETE FROM branch_photos WHERE branch_id = $1', [id]);
      for (const photo of photos) await client.query('INSERT INTO branch_photos (id, branch_id, url, source_url, license, attribution, is_primary) VALUES ($1, $2, $3, $4, $5, $6, $7)', [randomUUID(), id, photo.url, photo.sourceUrl || null, photo.license, photo.attribution, photo === primary]);

      if (Array.isArray(row?.tacos) && (!allowPartial || row.tacos.length > 0)) {
        const activeTacoIds = [];
        const seenTacoIds = new Set();
        for (const taco of row.tacos) {
          const tacoName = text(taco?.name);
          if (!tacoName) throw new Error('cada taco del menú debe tener nombre');
          const tacoId = text(taco?.id) || `${id}-${slug(tacoName)}`;
          if (seenTacoIds.has(tacoId)) throw new Error(`taco duplicado: ${tacoId}`);
          if (!validPrice(taco?.price) || !validRating(taco?.rating)) throw new Error(`precio o rating inválido para ${tacoName}`);
          seenTacoIds.add(tacoId);
          activeTacoIds.push(tacoId);
          await client.query(`INSERT INTO menu_items (id, branch_id, name, note, price, rating, is_active) VALUES ($1, $2, $3, $4, $5, $6, true) ON CONFLICT (id) DO UPDATE SET branch_id = EXCLUDED.branch_id, name = EXCLUDED.name, note = EXCLUDED.note, price = EXCLUDED.price, rating = EXCLUDED.rating, is_active = true`, [tacoId, id, tacoName, text(taco?.note), numberOrUndefined(taco?.price) ?? 0, numberOrUndefined(taco?.rating) ?? 0]);
        }
        if (activeTacoIds.length) await client.query('UPDATE menu_items SET is_active = false WHERE branch_id = $1 AND NOT (id = ANY($2::text[]))', [id, activeTacoIds]);
        else await client.query('UPDATE menu_items SET is_active = false WHERE branch_id = $1', [id]);
      }
      upserted += 1;
    } catch (error) {
      errors.push({ index, message: error instanceof Error ? error.message : String(error) });
    }
  }

  // Reconciliation is opt-in because the feed must represent a complete
  // snapshot. Invalid or conflicting rows pause reconciliation to avoid
  // archiving valid places because of a bad source response.
  let archived = 0;
  let demoArchived = 0;
  if (replaceDemo && !errors.length && duplicates === 0) {
    const result = await client.query("UPDATE branches SET catalog_status = 'archived', is_active = false, updated_at = now() WHERE source_name = 'demo' AND catalog_status <> 'archived'");
    demoArchived = result.rowCount ?? 0;
  }
  if (reconcile && !errors.length && duplicates === 0) {
    const ids = [...importedBranchIds];
    const result = ids.length
      ? await client.query("UPDATE branches SET catalog_status = 'archived', is_active = false, updated_at = now() WHERE source_name = $1 AND NOT (id = ANY($2::text[])) AND catalog_status <> 'archived'", [sourceName, ids])
      : await client.query("UPDATE branches SET catalog_status = 'archived', is_active = false, updated_at = now() WHERE source_name = $1 AND catalog_status <> 'archived'", [sourceName]);
    archived = result.rowCount ?? 0;
  }

  await client.query(`INSERT INTO catalog_imports (id, source_name, source_url, source_license, records_seen, records_upserted, duplicates_flagged, errors) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`, [randomUUID(), sourceName, sourceUrl, sourceLicense, rows.length, upserted, duplicates, JSON.stringify(errors)]);
  await client.query('COMMIT');
  console.log(JSON.stringify({ sourceName, recordsSeen: rows.length, recordsUpserted: upserted, duplicatesFlagged: duplicates, demoArchived, archived, reconciliationApplied: reconcile && !errors.length && duplicates === 0, errors }, null, 2));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
