import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { places, type ApiPlace } from './data.js';

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })
  : null;

type DiscoverQuery = { q?: string; lat?: number; lng?: number; limit: number };
type VisitInput = { placeId: string; tacoIds: string[]; rating: number };
export type PublicUser = { id: string; email: string; displayName: string };

type LocalUser = PublicUser & { passwordHash: string };
const localUsers = new Map<string, LocalUser>();
const localVisits = new Map<string, { userId: string; placeId: string; tacoIds: string[]; rating: number; createdAt: string }>();

function publicUser(user: LocalUser): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

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
  return createVisitForUser(input, 'demo-user');
}

export async function createVisitForUser(input: VisitInput, userId: string) {
  const id = crypto.randomUUID();
  if (pool) {
    await pool.query('BEGIN');
    try {
      await pool.query('INSERT INTO visits (id, user_id, branch_id, rating) VALUES ($1, $2, $3, $4)', [id, userId, input.placeId, input.rating]);
      for (const tacoId of input.tacoIds) await pool.query('INSERT INTO visit_items (visit_id, menu_item_id) VALUES ($1, $2)', [id, tacoId]);
      await pool.query('COMMIT');
    } catch (error) {
      await pool.query('ROLLBACK');
      throw error;
    }
  }
  const createdAt = new Date().toISOString();
  localVisits.set(id, { userId, ...input, createdAt });
  return { id, ...input, createdAt, status: 'recorded' };
}

export async function registerUser(input: { email: string; password: string; displayName: string }): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (pool) {
    const existing = await pool.query('SELECT id FROM users WHERE email_lower = $1', [email]);
    if (existing.rowCount) throw new Error('EMAIL_TAKEN');
    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const result = await pool.query('INSERT INTO users (id, email, email_lower, password_hash, display_name) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, display_name', [id, input.email.trim(), email, passwordHash, displayName]);
    return { id: result.rows[0].id, email: result.rows[0].email, displayName: result.rows[0].display_name };
  }
  if ([...localUsers.values()].some((user) => user.email === email)) throw new Error('EMAIL_TAKEN');
  const user: LocalUser = { id: crypto.randomUUID(), email, displayName, passwordHash: await bcrypt.hash(input.password, 10) };
  localUsers.set(user.id, user);
  return publicUser(user);
}

export async function authenticateUser(input: { email: string; password: string }): Promise<PublicUser | undefined> {
  const email = input.email.trim().toLowerCase();
  if (pool) {
    const result = await pool.query('SELECT id, email, display_name, password_hash FROM users WHERE email_lower = $1 AND is_active = true', [email]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(input.password, row.password_hash))) return undefined;
    return { id: row.id, email: row.email, displayName: row.display_name };
  }
  const user = [...localUsers.values()].find((item) => item.email === email);
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) return undefined;
  return publicUser(user);
}

export async function findUserById(id: string): Promise<PublicUser | undefined> {
  if (pool) {
    const result = await pool.query('SELECT id, email, display_name FROM users WHERE id = $1 AND is_active = true', [id]);
    const row = result.rows[0];
    return row ? { id: row.id, email: row.email, displayName: row.display_name } : undefined;
  }
  const user = localUsers.get(id);
  return user ? publicUser(user) : undefined;
}

export async function getDiary(userId: string) {
  if (pool) {
    const result = await pool.query(`
      SELECT v.id, v.visited_at, v.rating, b.name AS place_name, b.neighborhood,
        COALESCE(string_agg(m.name, ', ' ORDER BY m.name), '') AS tacos, b.image_url
      FROM visits v JOIN branches b ON b.id = v.branch_id
      LEFT JOIN visit_items vi ON vi.visit_id = v.id
      LEFT JOIN menu_items m ON m.id = vi.menu_item_id
      WHERE v.user_id = $1 GROUP BY v.id, b.name, b.neighborhood, b.image_url
      ORDER BY v.visited_at DESC LIMIT 100
    `, [userId]);
    return result.rows;
  }
  return [...localVisits.entries()].filter(([, visit]) => visit.userId === userId).sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt)).map(([id, visit]) => {
    const place = places.find((item) => item.id === visit.placeId);
    const tacoNames = visit.tacoIds.map((tacoId) => place?.tacos.find((taco) => taco.id === tacoId)?.name ?? tacoId).join(', ');
    return { id, visited_at: visit.createdAt, rating: visit.rating, place_name: place?.name ?? visit.placeId, neighborhood: place?.neighborhood ?? '', tacos: tacoNames, image_url: place?.image ?? '' };
  });
}
