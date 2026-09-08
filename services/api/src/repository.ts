import { Pool } from 'pg';
import { places, type ApiPlace } from './data.js';

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })
  : null;

type DiscoverQuery = { q?: string; lat?: number; lng?: number; limit: number };
type VisitInput = { placeId: string; tacoIds: string[]; rating: number };

function normalizePlace(row: any): ApiPlace {
  return {
    id: row.id,
    name: row.name,
    neighborhood: row.neighborhood,
    distance: row.distance_km == null ? 'cerca de ti' : `${Number(row.distance_km).toFixed(1)} km`,
    openUntil: row.open_until ?? '23:00',
    rating: Number(row.rating),
    match: Number(row.match_score ?? 80),
    style: row.style,
    coordinates: { latitude: Number(row.latitude), longitude: Number(row.longitude) },
    image: row.image_url,
    description: row.description,
    tags: row.tags ?? [],
    tacos: (row.tacos ?? []).map((taco: any) => ({ id: taco.id, name: taco.name, rating: Number(taco.rating), price: Number(taco.price), note: taco.note }))
  };
}

export async function discoverPlaces(query: DiscoverQuery): Promise<ApiPlace[]> {
  if (!pool) {
    const normalized = query.q?.trim().toLowerCase();
    const filtered = normalized ? places.filter((place) => `${place.name} ${place.neighborhood} ${place.style} ${place.tags.join(' ')} ${place.tacos.map((taco) => taco.name).join(' ')}`.toLowerCase().includes(normalized)) : places;
    return filtered.slice(0, query.limit);
  }

  const values: unknown[] = [];
  const predicates: string[] = ['b.is_active = true'];
  if (query.q) {
    values.push(`%${query.q.trim()}%`);
    predicates.push(`(b.name ILIKE $${values.length} OR b.neighborhood ILIKE $${values.length} OR b.search_text ILIKE $${values.length})`);
  }
  const distanceSelect = query.lat != null && query.lng != null
    ? `ST_Distance(b.location, ST_SetSRID(ST_MakePoint($${values.length + 1}, $${values.length + 2}), 4326)::geography) / 1000 AS distance_km`
    : 'NULL::numeric AS distance_km';
  if (query.lat != null && query.lng != null) values.push(query.lng, query.lat);
  values.push(query.limit);
  const result = await pool.query(`
    SELECT b.id, b.name, b.neighborhood, b.open_until, b.rating, b.match_score, b.style,
      b.image_url, b.description, b.tags, ST_Y(b.location::geometry) AS latitude,
      ST_X(b.location::geometry) AS longitude, ${distanceSelect},
      COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name, 'rating', m.rating,
        'price', m.price, 'note', m.note)) FILTER (WHERE m.id IS NOT NULL), '[]') AS tacos
    FROM branches b LEFT JOIN menu_items m ON m.branch_id = b.id AND m.is_active = true
    WHERE ${predicates.join(' AND ')}
    GROUP BY b.id ORDER BY b.rating DESC LIMIT $${values.length}
  `, values);
  return result.rows.map(normalizePlace);
}

export async function findPlace(id: string): Promise<ApiPlace | undefined> {
  const fallback = places.find((place) => place.id === id);
  if (!pool) return fallback;
  const result = await pool.query(`
    SELECT b.id, b.name, b.neighborhood, b.open_until, b.rating, b.match_score, b.style,
      b.image_url, b.description, b.tags, ST_Y(b.location::geometry) AS latitude,
      ST_X(b.location::geometry) AS longitude, NULL::numeric AS distance_km,
      COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name, 'rating', m.rating,
        'price', m.price, 'note', m.note)) FILTER (WHERE m.id IS NOT NULL), '[]') AS tacos
    FROM branches b LEFT JOIN menu_items m ON m.branch_id = b.id AND m.is_active = true
    WHERE b.id = $1 AND b.is_active = true GROUP BY b.id
  `, [id]);
  return result.rows[0] ? normalizePlace(result.rows[0]) : undefined;
}

export async function createVisit(input: VisitInput) {
  const id = crypto.randomUUID();
  if (pool) {
    await pool.query('BEGIN');
    try {
      await pool.query('INSERT INTO visits (id, branch_id, rating) VALUES ($1, $2, $3)', [id, input.placeId, input.rating]);
      for (const tacoId of input.tacoIds) await pool.query('INSERT INTO visit_items (visit_id, menu_item_id) VALUES ($1, $2)', [id, tacoId]);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
  return { id, ...input, createdAt: new Date().toISOString(), status: 'recorded' };
}
