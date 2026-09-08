import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { lists as fixtureLists, places, type ApiList, type ApiPlace, type FlavorProfile, type TasteProfile } from './data.js';

const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, max: 10, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })
  : null;

type DiscoverQuery = { q?: string; lat?: number; lng?: number; limit: number };
type VisitInput = { placeId: string; tacoIds: string[]; rating: number; tacoRatings?: Record<string, number>; price?: number; note?: string; photoUrl?: string; latitude?: number; longitude?: number };
export type PublicUser = { id: string; email: string; displayName: string };

type LocalUser = PublicUser & { passwordHash: string };
const localUsers = new Map<string, LocalUser>();
const localVisits = new Map<string, { userId: string; placeId: string; tacoIds: string[]; tacoRatings?: Record<string, number>; rating: number; price?: number; note?: string; photoUrl?: string; latitude?: number; longitude?: number; createdAt: string }>();
const localFollows = new Set<string>();
const localLists = new Map<string, { id: string; ownerId: string; title: string; description: string; visibility: 'public' | 'private'; coverImage: string; placeIds: string[]; createdAt: string }>();

const defaultTaste: TasteProfile = {
  title: 'Pastor nocturno',
  description: 'Picante alto · precio sensible · explorador de lugares callejeros',
  tags: ['PASTOR 92%', 'PICANTE 84%', 'NOCHE 78%'],
  profile: { intensity: 86, spicy: 72, traditional: 94, texture: 88, value: 78 }
};

function publicUser(user: LocalUser): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName };
}

function normalizePlace(row: any): ApiPlace {
  const fallbackProfile: FlavorProfile = places.find((place) => place.id === row.id)?.flavorProfile ?? { intensity: 50, spicy: 50, traditional: 50, texture: 50, value: 50 };
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
    flavorProfile: { ...fallbackProfile, ...(row.flavor_profile ?? {}) },
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
    SELECT b.id, b.name, b.neighborhood, b.open_until,
      CASE WHEN COALESCE(reviews.review_count, 0) = 0 THEN b.rating
        ELSE ((reviews.review_count * reviews.average_rating) + (10 * 4.2)) / (reviews.review_count + 10) END AS rating,
      b.match_score, b.style,
      b.image_url, b.description, b.tags, b.flavor_profile, ST_Y(b.location::geometry) AS latitude,
      ST_X(b.location::geometry) AS longitude, ${distanceSelect},
      COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name, 'rating', COALESCE((
        SELECT ((COUNT(*) * AVG(vi.rating)) + (5 * 4.2)) / (COUNT(*) + 5)
        FROM visit_items vi WHERE vi.menu_item_id = m.id AND vi.rating IS NOT NULL
      ), m.rating),
        'price', m.price, 'note', m.note)) FILTER (WHERE m.id IS NOT NULL), '[]') AS tacos
    FROM branches b
      LEFT JOIN LATERAL (SELECT COUNT(*)::numeric AS review_count, AVG(v.rating)::numeric AS average_rating
        FROM visits v WHERE v.branch_id = b.id) reviews ON true
      LEFT JOIN menu_items m ON m.branch_id = b.id AND m.is_active = true
    WHERE ${predicates.join(' AND ')}
    GROUP BY b.id, reviews.review_count, reviews.average_rating ORDER BY rating DESC LIMIT $${values.length}
  `, values);
  return result.rows.map(normalizePlace);
}

function tokenise(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((token) => token.length > 2);
}

export async function getRecommendations(userId?: string): Promise<ApiPlace[]> {
  const candidates = await discoverPlaces({ limit: 50 });
  if (!userId) return candidates;

  const preferenceTokens = new Set<string>();
  if (pool) {
    const history = await pool.query(`
      SELECT v.rating, b.name, b.style, b.tags, m.name AS taco_name
      FROM visits v JOIN branches b ON b.id = v.branch_id
      LEFT JOIN visit_items vi ON vi.visit_id = v.id
      LEFT JOIN menu_items m ON m.id = vi.menu_item_id
      WHERE v.user_id = $1 AND v.rating >= 4
    `, [userId]);
    for (const row of history.rows) {
      for (const value of [row.name, row.style, row.taco_name, ...(row.tags ?? [])]) for (const token of tokenise(String(value ?? ''))) preferenceTokens.add(token);
    }
  } else {
    for (const visit of localVisits.values()) {
      if (visit.userId !== userId || visit.rating < 4) continue;
      const place = places.find((item) => item.id === visit.placeId);
      for (const value of [place?.name, place?.style, ...(place?.tags ?? []), ...visit.tacoIds.map((id) => place?.tacos.find((taco) => taco.id === id)?.name)]) for (const token of tokenise(String(value ?? ''))) preferenceTokens.add(token);
    }
  }
  if (!preferenceTokens.size) return candidates;
  return candidates.map((place) => {
    const placeTokens = new Set(tokenise([place.name, place.style, ...place.tags, ...place.tacos.map((taco) => taco.name)].join(' ')));
    const overlap = [...placeTokens].filter((token) => preferenceTokens.has(token)).length;
    const personalMatch = Math.min(99, Math.round(place.match + Math.min(15, overlap * 4)));
    return { ...place, match: personalMatch };
  }).sort((a, b) => b.match - a.match || b.rating - a.rating);
}

export async function getTasteProfile(userId: string): Promise<TasteProfile> {
  let visits = 0;
  const sums: FlavorProfile = { intensity: 0, spicy: 0, traditional: 0, texture: 0, value: 0 };
  if (pool) {
    const result = await pool.query(`
      SELECT COUNT(*)::int AS visits,
        AVG((b.flavor_profile->>'intensity')::numeric) AS intensity,
        AVG((b.flavor_profile->>'spicy')::numeric) AS spicy,
        AVG((b.flavor_profile->>'traditional')::numeric) AS traditional,
        AVG((b.flavor_profile->>'texture')::numeric) AS texture,
        AVG((b.flavor_profile->>'value')::numeric) AS value
      FROM visits v JOIN branches b ON b.id = v.branch_id WHERE v.user_id = $1
    `, [userId]);
    const row = result.rows[0];
    visits = Number(row?.visits ?? 0);
    if (visits) for (const key of Object.keys(sums) as Array<keyof FlavorProfile>) sums[key] = Number(row[key] ?? defaultTaste.profile[key]);
  } else {
    for (const visit of localVisits.values()) {
      if (visit.userId !== userId) continue;
      const place = places.find((item) => item.id === visit.placeId);
      if (!place) continue;
      visits += 1;
      for (const key of Object.keys(sums) as Array<keyof FlavorProfile>) sums[key] += place.flavorProfile[key];
    }
  }
  if (!visits) return { ...defaultTaste, profile: { ...defaultTaste.profile }, tags: [...defaultTaste.tags] };
  const profile = Object.fromEntries((Object.keys(sums) as Array<keyof FlavorProfile>).map((key) => [key, Math.round(sums[key] / visits)])) as FlavorProfile;
  const title = profile.spicy >= 70 ? 'Pastor nocturno' : profile.value >= 80 ? 'Explorador de barrio' : profile.traditional >= 75 ? 'Clásico con criterio' : 'Curioso de la ciudad';
  const description = (profile.spicy >= 70 ? 'Picante alto' : 'Picante moderado') + ' · ' + (profile.value >= 75 ? 'precio sensible' : 'buscas equilibrio') + ' · ' + (profile.traditional >= 75 ? 'clásicos' : 'nuevos estilos');
  const tags = [Math.round(profile.traditional) + '% CLÁSICO', Math.round(profile.spicy) + '% PICANTE', Math.round(profile.value) + '% VALOR'];
  return { title, description, tags, profile };
}

export async function findPlace(id: string): Promise<ApiPlace | undefined> {
  const fallback = places.find((place) => place.id === id);
  if (!pool) return fallback;
  const result = await pool.query(`
    SELECT b.id, b.name, b.neighborhood, b.open_until,
      CASE WHEN COALESCE(reviews.review_count, 0) = 0 THEN b.rating
        ELSE ((reviews.review_count * reviews.average_rating) + (10 * 4.2)) / (reviews.review_count + 10) END AS rating,
      b.match_score, b.style,
      b.image_url, b.description, b.tags, b.flavor_profile, ST_Y(b.location::geometry) AS latitude,
      ST_X(b.location::geometry) AS longitude, NULL::numeric AS distance_km,
      COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name, 'rating', COALESCE((
        SELECT ((COUNT(*) * AVG(vi.rating)) + (5 * 4.2)) / (COUNT(*) + 5)
        FROM visit_items vi WHERE vi.menu_item_id = m.id AND vi.rating IS NOT NULL
      ), m.rating),
        'price', m.price, 'note', m.note)) FILTER (WHERE m.id IS NOT NULL), '[]') AS tacos
    FROM branches b
      LEFT JOIN LATERAL (SELECT COUNT(*)::numeric AS review_count, AVG(v.rating)::numeric AS average_rating
        FROM visits v WHERE v.branch_id = b.id) reviews ON true
      LEFT JOIN menu_items m ON m.branch_id = b.id AND m.is_active = true
    WHERE b.id = $1 AND b.is_active = true GROUP BY b.id, reviews.review_count, reviews.average_rating
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
      await pool.query(`INSERT INTO visits (id, user_id, branch_id, rating, price, note, photo_url, visit_location)
        VALUES ($1, $2, $3, $4, $5, $6, $7,
          CASE WHEN $8::numeric IS NULL OR $9::numeric IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint($9::numeric, $8::numeric), 4326)::geography END)`,
        [id, userId, input.placeId, input.rating, input.price ?? null, input.note?.trim() ?? '', input.photoUrl ?? null, input.latitude ?? null, input.longitude ?? null]);
      for (const tacoId of input.tacoIds) await pool.query('INSERT INTO visit_items (visit_id, menu_item_id, rating) VALUES ($1, $2, $3)', [id, tacoId, input.tacoRatings?.[tacoId] ?? null]);
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
      SELECT v.id, v.visited_at, v.rating, v.price, v.note, v.photo_url, b.name AS place_name, b.neighborhood,
        COALESCE(string_agg(m.name, ', ' ORDER BY m.name), '') AS tacos,
      COALESCE(json_object_agg(m.id, vi.rating) FILTER (WHERE m.id IS NOT NULL), '{}'::json) AS taco_ratings,
        COALESCE(v.photo_url, b.image_url) AS image_url
      FROM visits v JOIN branches b ON b.id = v.branch_id
      LEFT JOIN visit_items vi ON vi.visit_id = v.id
      LEFT JOIN menu_items m ON m.id = vi.menu_item_id
      WHERE v.user_id = $1 GROUP BY v.id, v.price, v.note, v.photo_url, b.name, b.neighborhood, b.image_url
      ORDER BY v.visited_at DESC LIMIT 100
    `, [userId]);
    return result.rows;
  }
  return [...localVisits.entries()].filter(([, visit]) => visit.userId === userId).sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt)).map(([id, visit]) => {
    const place = places.find((item) => item.id === visit.placeId);
    const tacoNames = visit.tacoIds.map((tacoId) => place?.tacos.find((taco) => taco.id === tacoId)?.name ?? tacoId).join(', ');
    return { id, visited_at: visit.createdAt, rating: visit.rating, price: visit.price ?? null, note: visit.note ?? '', photo_url: visit.photoUrl ?? null, place_name: place?.name ?? visit.placeId, neighborhood: place?.neighborhood ?? '', tacos: tacoNames, taco_ratings: visit.tacoRatings ?? {}, image_url: visit.photoUrl ?? place?.image ?? '' };
  });
}

function normalizeList(row: any): ApiList {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    owner: { id: row.owner_id, displayName: row.owner_name },
    itemCount: Number(row.item_count ?? 0),
    visitedCount: Number(row.visited_count ?? 0),
    coverImage: row.cover_image_url ?? places[0].image
  };
}

export async function getLists(userId?: string): Promise<ApiList[]> {
  if (pool) {
    const result = await pool.query(`
      SELECT l.id, l.title, l.description, l.owner_id, u.display_name AS owner_name,
        COUNT(li.branch_id)::int AS item_count,
        COALESCE(SUM(CASE WHEN EXISTS (
          SELECT 1 FROM visits vv WHERE vv.user_id = $1 AND vv.branch_id = li.branch_id
        ) THEN 1 ELSE 0 END), 0)::int AS visited_count,
        COALESCE(l.cover_image_url, MIN(b.image_url)) AS cover_image_url
      FROM lists l JOIN users u ON u.id = l.owner_id
      LEFT JOIN list_items li ON li.list_id = l.id
      LEFT JOIN branches b ON b.id = li.branch_id
      WHERE l.visibility = 'public' OR l.owner_id = $1
      GROUP BY l.id, u.display_name
      ORDER BY l.updated_at DESC LIMIT 100
    `, [userId ?? null]);
    return result.rows.map(normalizeList);
  }
  const own = userId ? [...localLists.values()].filter((list) => list.ownerId === userId && list.visibility === 'private') : [];
  const userLists = [...localLists.values()].filter((list) => list.ownerId === userId && list.visibility === 'public');
  const mapped = [...userLists, ...own].map((list) => {
    const owner = localUsers.get(list.ownerId);
    const visitedCount = list.placeIds.filter((placeId) => [...localVisits.values()].some((visit) => visit.userId === userId && visit.placeId === placeId)).length;
    return { id: list.id, title: list.title, description: list.description, owner: { id: list.ownerId, displayName: owner?.displayName ?? 'Tacos' }, itemCount: list.placeIds.length, visitedCount, coverImage: list.coverImage } satisfies ApiList;
  });
  return [...fixtureLists, ...mapped];
}

export async function createListForUser(input: { title: string; description?: string; visibility?: 'public' | 'private' }, userId: string): Promise<ApiList> {
  const id = crypto.randomUUID();
  const title = input.title.trim();
  const description = input.description?.trim() ?? '';
  const visibility = input.visibility ?? 'public';
  if (pool) {
    await pool.query('INSERT INTO lists (id, owner_id, title, description, visibility) VALUES ($1, $2, $3, $4, $5)', [id, userId, title, description, visibility]);
    const created = await pool.query(`
      SELECT l.id, l.title, l.description, l.owner_id, u.display_name AS owner_name,
        0::int AS item_count, 0::int AS visited_count, NULL::text AS cover_image_url
      FROM lists l JOIN users u ON u.id = l.owner_id WHERE l.id = $1
    `, [id]);
    return normalizeList(created.rows[0]);
  }
  const createdAt = new Date().toISOString();
  localLists.set(id, { id, ownerId: userId, title, description, visibility, coverImage: places[0].image, placeIds: [], createdAt });
  const owner = localUsers.get(userId);
  return { id, title, description, owner: { id: userId, displayName: owner?.displayName ?? 'Tacos' }, itemCount: 0, visitedCount: 0, coverImage: places[0].image };
}

export async function addListItemForUser(listId: string, placeId: string, userId: string, note = ''): Promise<boolean> {
  if (pool) {
    const owned = await pool.query('SELECT 1 FROM lists WHERE id = $1 AND owner_id = $2', [listId, userId]);
    if (!owned.rowCount) return false;
    await pool.query(`
      INSERT INTO list_items (list_id, branch_id, position, note)
      VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM list_items WHERE list_id = $1), 0), $3)
      ON CONFLICT (list_id, branch_id) DO UPDATE SET note = EXCLUDED.note
    `, [listId, placeId, note.trim()]);
    await pool.query('UPDATE lists SET updated_at = now() WHERE id = $1', [listId]);
    return true;
  }
  const list = localLists.get(listId);
  if (!list || list.ownerId !== userId || !places.some((place) => place.id === placeId)) return false;
  if (!list.placeIds.includes(placeId)) list.placeIds.push(placeId);
  return true;
}

export async function searchUsers(query: string, currentUserId?: string): Promise<PublicUser[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  if (pool) {
    const result = await pool.query(`
      SELECT id, email, display_name FROM users
      WHERE is_active = true AND id <> $1 AND (display_name ILIKE $2 OR email ILIKE $2)
      ORDER BY display_name LIMIT 20
    `, [currentUserId ?? '', `%${normalized}%`]);
    return result.rows.map((row) => ({ id: row.id, email: row.email, displayName: row.display_name }));
  }
  return [...localUsers.values()].filter((user) => user.id !== currentUserId && `${user.displayName} ${user.email}`.toLowerCase().includes(normalized)).slice(0, 20).map(publicUser);
}

export async function followUser(followerId: string, followedId: string): Promise<'ok' | 'not_found' | 'self'> {
  if (followerId === followedId) return 'self';
  if (pool) {
    const target = await pool.query('SELECT 1 FROM users WHERE id = $1 AND is_active = true', [followedId]);
    if (!target.rowCount) return 'not_found';
    await pool.query('INSERT INTO follows (follower_id, followed_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [followerId, followedId]);
    return 'ok';
  }
  if (!localUsers.has(followedId)) return 'not_found';
  localFollows.add(`${followerId}:${followedId}`);
  return 'ok';
}

export async function unfollowUser(followerId: string, followedId: string) {
  if (pool) await pool.query('DELETE FROM follows WHERE follower_id = $1 AND followed_id = $2', [followerId, followedId]);
  localFollows.delete(`${followerId}:${followedId}`);
}

export async function getFeed(userId: string) {
  if (pool) {
    const result = await pool.query(`
      SELECT v.id, v.visited_at, v.rating, u.id AS user_id, u.display_name,
        b.id AS place_id, b.name AS place_name, b.neighborhood, COALESCE(v.photo_url, b.image_url) AS image_url,
        COALESCE(string_agg(m.name, ', ' ORDER BY m.name), '') AS tacos
      FROM follows f JOIN visits v ON v.user_id = f.followed_id
      JOIN users u ON u.id = v.user_id JOIN branches b ON b.id = v.branch_id
      LEFT JOIN visit_items vi ON vi.visit_id = v.id LEFT JOIN menu_items m ON m.id = vi.menu_item_id
      WHERE f.follower_id = $1 GROUP BY v.id, v.photo_url, u.id, b.id ORDER BY v.visited_at DESC LIMIT 50
    `, [userId]);
    return result.rows;
  }
  const followed = [...localFollows].filter((key) => key.startsWith(`${userId}:`)).map((key) => key.slice(userId.length + 1));
  return [...localVisits.entries()].filter(([, visit]) => followed.includes(visit.userId)).sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt)).map(([id, visit]) => {
    const place = places.find((item) => item.id === visit.placeId);
    const user = localUsers.get(visit.userId);
    const tacos = visit.tacoIds.map((tacoId) => place?.tacos.find((taco) => taco.id === tacoId)?.name ?? tacoId).join(', ');
    return { id, visited_at: visit.createdAt, rating: visit.rating, user_id: visit.userId, display_name: user?.displayName ?? 'Tacos', place_id: visit.placeId, place_name: place?.name ?? visit.placeId, neighborhood: place?.neighborhood ?? '', image_url: visit.photoUrl ?? place?.image ?? '', tacos };
  });
}
