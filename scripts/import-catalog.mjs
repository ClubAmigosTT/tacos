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
const raw = feedUrl
  ? await (async () => { const response = await fetch(feedUrl); if (!response.ok) throw new Error(`CATALOG_FEED_URL respondió ${response.status}`); return response.json(); })()
  : JSON.parse(await readFile(inputPath, 'utf8'));
const rows = Array.isArray(raw) ? raw : raw.branches;
if (!Array.isArray(rows)) throw new Error('El catálogo debe ser un array o { branches: [] }');

const pool = new Pool({ connectionString: databaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
const client = await pool.connect();
const errors = [];
let upserted = 0;
let duplicates = 0;
const requiredDays = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

function text(value, fallback = '') { return typeof value === 'string' ? value.trim() : fallback; }
function slug(value) { return text(value).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64); }
function dedupeKey(row) { return `${slug(row.name)}:${Number(row.latitude).toFixed(4)}:${Number(row.longitude).toFixed(4)}`; }
function validHours(hours) { return hours && typeof hours === 'object' && requiredDays.every((day) => Array.isArray(hours[day])); }
function validPhoto(photo) { return photo && /^https?:\/\//.test(text(photo.url)) && text(photo.license).length > 1 && text(photo.attribution).length > 1; }

try {
  await client.query('BEGIN');
  if (replaceDemo) await client.query("UPDATE branches SET catalog_status = 'archived', is_active = false WHERE source_name = 'demo'");

  for (const [index, row] of rows.entries()) {
    try {
      const name = text(row.name);
      const neighborhood = text(row.neighborhood);
      const latitude = Number(row.latitude);
      const longitude = Number(row.longitude);
      const address = text(row.address);
      const hours = row.weeklyHours;
      const photos = Array.isArray(row.photos) ? row.photos.filter(validPhoto) : [];
      if (!name || !neighborhood || !address || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error('nombre, zona, dirección y coordenadas son obligatorios');
      if (!validHours(hours)) throw new Error('weeklyHours debe tener mon..sun como arrays');
      if (!photos.length) throw new Error('se requiere al menos una foto con URL, licencia y atribución');
      const id = text(row.id) || `${slug(name)}-${Math.round((latitude + 90) * 10000)}-${Math.round((longitude + 180) * 10000)}`;
      const taqueriaId = text(row.taqueriaId) || id;
      const sourcePlaceId = text(row.sourcePlaceId) || null;
      const key = dedupeKey(row);
      const duplicate = await client.query(`SELECT id FROM branches WHERE dedupe_key = $1 OR ($2::text IS NOT NULL AND source_name = $3 AND source_place_id = $2)`, [key, sourcePlaceId, sourceName]);
      if (duplicate.rows[0] && duplicate.rows[0].id !== id) {
        duplicates += 1;
        await client.query("UPDATE branches SET catalog_status = 'needs_review', updated_at = now() WHERE id = $1", [duplicate.rows[0].id]);
        continue;
      }
      await client.query(`INSERT INTO taquerias (id, name, slug, description) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, updated_at = now()`, [taqueriaId, text(row.taqueriaName, name), `${slug(text(row.taqueriaName, name))}-${slug(taqueriaId).slice(-8)}`, text(row.taqueriaDescription)]);
      const primary = photos.find((photo) => photo.isPrimary) || photos[0];
      await client.query(`
        INSERT INTO branches (id, taqueria_id, name, neighborhood, address, phone, location, open_until, weekly_hours, price_min, price_max, style, image_url, image_license, image_attribution, image_source_url, description, tags, search_text, rating, match_score, is_active, source_name, source_place_id, source_url, source_license, source_attribution, source_updated_at, dedupe_key, catalog_status, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, true, $23, $24, $25, $26, $27, $28, $29, 'active', now())
        ON CONFLICT (id) DO UPDATE SET taqueria_id = EXCLUDED.taqueria_id, name = EXCLUDED.name, neighborhood = EXCLUDED.neighborhood, address = EXCLUDED.address, phone = EXCLUDED.phone, location = EXCLUDED.location, open_until = EXCLUDED.open_until, weekly_hours = EXCLUDED.weekly_hours, price_min = EXCLUDED.price_min, price_max = EXCLUDED.price_max, style = EXCLUDED.style, image_url = EXCLUDED.image_url, image_license = EXCLUDED.image_license, image_attribution = EXCLUDED.image_attribution, image_source_url = EXCLUDED.image_source_url, description = EXCLUDED.description, tags = EXCLUDED.tags, search_text = EXCLUDED.search_text, source_name = EXCLUDED.source_name, source_place_id = EXCLUDED.source_place_id, source_url = EXCLUDED.source_url, source_license = EXCLUDED.source_license, source_attribution = EXCLUDED.source_attribution, source_updated_at = EXCLUDED.source_updated_at, dedupe_key = EXCLUDED.dedupe_key, catalog_status = 'active', is_active = true, updated_at = now()
      `, [id, taqueriaId, name, neighborhood, address, text(row.phone) || null, longitude, latitude, text(row.openUntil, '23:00'), JSON.stringify(hours), Number(row.priceMin) || null, Number(row.priceMax) || null, text(row.style, 'Clásico callejero'), primary.url, primary.license, primary.attribution, primary.sourceUrl || null, text(row.description), Array.isArray(row.tags) ? row.tags.map(String) : [], `${name} ${neighborhood} ${text(row.style)} ${(row.tags || []).join(' ')}`, Number(row.rating) || 0, Number(row.matchScore) || 80, sourceName, sourcePlaceId, sourceUrl, sourceLicense, text(row.sourceAttribution) || primary.attribution, row.sourceUpdatedAt ? new Date(row.sourceUpdatedAt) : null, key]);
      await client.query('DELETE FROM branch_photos WHERE branch_id = $1', [id]);
      for (const photo of photos) await client.query('INSERT INTO branch_photos (id, branch_id, url, source_url, license, attribution, is_primary) VALUES ($1, $2, $3, $4, $5, $6, $7)', [randomUUID(), id, photo.url, photo.sourceUrl || null, photo.license, photo.attribution, photo === primary]);
      if (Array.isArray(row.tacos)) {
        for (const taco of row.tacos) {
          const tacoId = text(taco.id) || `${id}-${slug(taco.name)}`;
          if (!text(taco.name)) continue;
          await client.query(`INSERT INTO menu_items (id, branch_id, name, note, price, rating, is_active) VALUES ($1, $2, $3, $4, $5, $6, true) ON CONFLICT (id) DO UPDATE SET branch_id = EXCLUDED.branch_id, name = EXCLUDED.name, note = EXCLUDED.note, price = EXCLUDED.price, rating = EXCLUDED.rating, is_active = true`, [tacoId, id, text(taco.name), text(taco.note), Number(taco.price) || 0, Number(taco.rating) || 0]);
        }
      }
      upserted += 1;
    } catch (error) { errors.push({ index, message: error instanceof Error ? error.message : String(error) }); }
  }
  await client.query(`INSERT INTO catalog_imports (id, source_name, source_url, source_license, records_seen, records_upserted, duplicates_flagged, errors) VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)`, [randomUUID(), sourceName, sourceUrl, sourceLicense, rows.length, upserted, duplicates, JSON.stringify(errors)]);
  await client.query('COMMIT');
  console.log(JSON.stringify({ sourceName, recordsSeen: rows.length, recordsUpserted: upserted, duplicatesFlagged: duplicates, errors }, null, 2));
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
