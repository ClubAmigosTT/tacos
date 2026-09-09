import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { lists as fixtureLists, places, type ApiList, type ApiListDetail, type ApiPlace, type ApiTaqueria, type FlavorProfile, type TasteProfile } from './data.js';

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
if (process.env.NODE_ENV === 'production' && !configuredDatabaseUrl) {
  throw new Error('DATABASE_URL is required in production');
}

const pool = configuredDatabaseUrl
  ? new Pool({ connectionString: configuredDatabaseUrl, max: 10, connectionTimeoutMillis: 5_000, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })
  : null;

type DiscoverQuery = { q?: string; lat?: number; lng?: number; limit: number };
type VisitInput = { placeId: string; tacoIds: string[]; rating: number; tacoRatings?: Record<string, number>; price?: number; note?: string; photoUrl?: string; latitude?: number; longitude?: number };
type ReportInput = { visitId: string; reason: 'spam' | 'inappropriate' | 'wrong_place' | 'other'; details?: string };
export type PublicUser = { id: string; email: string; displayName: string; role: 'user' | 'admin'; following?: boolean };
export type AdminReport = { id: string; visitId: string; reason: ReportInput['reason']; details: string; status: 'open' | 'reviewed' | 'dismissed'; createdAt: string; reporter: { id: string; displayName: string }; author: { id: string; displayName: string }; place: { id: string; name: string }; rating: number; visitedAt: string };

type LocalUser = PublicUser & { passwordHash: string; shareActivity: boolean };
const localUsers = new Map<string, LocalUser>();
const localVisits = new Map<string, { userId: string; placeId: string; tacoIds: string[]; tacoRatings?: Record<string, number>; rating: number; price?: number; note?: string; photoUrl?: string; latitude?: number; longitude?: number; createdAt: string; visibility: 'visible' | 'hidden' }>();
const localFollows = new Set<string>();
const localSavedPlaces = new Set<string>();
const localLists = new Map<string, { id: string; ownerId: string; title: string; description: string; visibility: 'public' | 'private'; coverImage: string; placeIds: string[]; createdAt: string }>();
const localReports = new Map<string, { id: string; reporterId: string; visitId: string; reason: ReportInput['reason']; details: string; status: 'open' | 'reviewed' | 'dismissed'; createdAt: string }>();
const localComments = new Map<string, { id: string; visitId: string; authorId: string; body: string; createdAt: string; visibility: 'visible' | 'hidden' }>();
const localListCollaborators = new Map<string, { listId: string; userId: string; role: 'editor' | 'viewer'; createdAt: string }>();
const localProductEvents: Array<{ eventName: string; userId?: string; anonymousId?: string; properties: Record<string, string | number | boolean | null>; createdAt: string }> = [];

const configuredAdminEmails = new Set((process.env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));

const defaultTaste: TasteProfile = {
  title: 'Pastor nocturno',
  description: 'Picante alto · precio sensible · explorador de lugares callejeros',
  tags: ['PASTOR 92%', 'PICANTE 84%', 'NOCHE 78%'],
  profile: { intensity: 86, spicy: 72, traditional: 94, texture: 88, value: 78 }
};

export async function getHealth() {
  if (!pool) return { status: 'ok' as const, database: 'memory' as const };
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      pool.query("SELECT 1, to_regclass('public.schema_migrations') AS schema, postgis_version() AS postgis"),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('HEALTH_TIMEOUT')), 3_000); })
    ]);
    if (!result.rows[0]?.schema || !result.rows[0]?.postgis) return { status: 'degraded' as const, database: 'postgres' as const, reason: 'schema_not_ready' as const };
    return { status: 'ok' as const, database: 'postgres' as const };
  } catch {
    return { status: 'degraded' as const, database: 'unavailable' as const };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function closeRepository() {
  if (pool) await pool.end();
}

export type MaintenanceResult = { database: 'postgres' | 'memory'; analyzed: boolean; purgedEvents: number };

/**
 * Keep the long-lived Render processes useful without coupling them to
 * request handling. Product events have a finite retention window; user
 * generated content is intentionally never touched by this job.
 */
export async function runNightlyMaintenance(): Promise<MaintenanceResult> {
  const retentionDays = 180;
  if (pool) {
    let analyzed = false;
    for (const table of ['branches', 'menu_items', 'visits', 'visit_items', 'product_events']) {
      try {
        await pool.query(`ANALYZE ${table}`);
        analyzed = true;
      } catch (error) {
        if ((error as { code?: string }).code !== '42P01') throw error;
      }
    }
    let purgedEvents = 0;
    try {
      const purged = await pool.query("DELETE FROM product_events WHERE created_at < now() - ($1::int * interval '1 day')", [retentionDays]);
      purgedEvents = purged.rowCount ?? 0;
    } catch (error) {
      if ((error as { code?: string }).code !== '42P01') throw error;
    }
    return { database: 'postgres', analyzed, purgedEvents };
  }
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  let purgedEvents = 0;
  for (let index = localProductEvents.length - 1; index >= 0; index -= 1) {
    if (Date.parse(localProductEvents[index].createdAt) < cutoff) {
      localProductEvents.splice(index, 1);
      purgedEvents += 1;
    }
  }
  return { database: 'memory', analyzed: false, purgedEvents };
}

const allowedEventPropertyKeys = new Set(['source', 'filter', 'query_length', 'place_id', 'list_id', 'duration_ms', 'role', 'visibility', 'result_count']);

function sanitizeEventProperties(properties: Record<string, unknown> | undefined) {
  return Object.fromEntries(Object.entries(properties ?? {})
    .filter(([key, value]) => allowedEventPropertyKeys.has(key) && (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value === null))
    .map(([key, value]) => [key, typeof value === 'string' ? value.slice(0, 64) : value])
    .slice(0, 12)) as Record<string, string | number | boolean | null>;
}

export async function recordProductEvent(input: { eventName: string; userId?: string; anonymousId?: string; properties?: Record<string, unknown> }) {
  const properties = sanitizeEventProperties(input.properties);
  if (pool) {
    await pool.query(`
      INSERT INTO product_events (event_name, user_id, anonymous_id, properties)
      VALUES ($1, $2, $3, $4::jsonb)
    `, [input.eventName, input.userId ?? null, input.anonymousId ?? null, JSON.stringify(properties)]);
    return;
  }
  localProductEvents.push({ eventName: input.eventName, userId: input.userId, anonymousId: input.anonymousId, properties, createdAt: new Date().toISOString() });
  if (localProductEvents.length > 500) localProductEvents.shift();
}

export type AdminAnalytics = {
  days: number;
  totalEvents: number;
  uniqueAudiences: number;
  byEvent: Array<{ eventName: string; count: number }>;
};

export async function getAdminAnalytics(days = 14): Promise<AdminAnalytics> {
  const windowDays = Math.min(Math.max(Math.trunc(days), 1), 90);
  if (pool) {
    const [totals, grouped] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total_events, COUNT(DISTINCT COALESCE(user_id, anonymous_id))::int AS unique_audiences FROM product_events WHERE created_at >= now() - ($1::int * interval '1 day')`, [windowDays]),
      pool.query(`SELECT event_name, COUNT(*)::int AS count FROM product_events WHERE created_at >= now() - ($1::int * interval '1 day') GROUP BY event_name ORDER BY count DESC, event_name LIMIT 20`, [windowDays])
    ]);
    return { days: windowDays, totalEvents: Number(totals.rows[0]?.total_events ?? 0), uniqueAudiences: Number(totals.rows[0]?.unique_audiences ?? 0), byEvent: grouped.rows.map((row) => ({ eventName: row.event_name, count: Number(row.count) })) };
  }
  const since = Date.now() - windowDays * 24 * 60 * 60 * 1000;
  const events = localProductEvents.filter((event) => Date.parse(event.createdAt) >= since);
  const counts = new Map<string, number>();
  const audiences = new Set<string>();
  for (const event of events) {
    counts.set(event.eventName, (counts.get(event.eventName) ?? 0) + 1);
    const audience = event.userId ?? event.anonymousId;
    if (audience) audiences.add(audience);
  }
  return { days: windowDays, totalEvents: events.length, uniqueAudiences: audiences.size, byEvent: [...counts.entries()].map(([eventName, count]) => ({ eventName, count })).sort((a, b) => b.count - a.count).slice(0, 20) };
}

function publicUser(user: LocalUser): PublicUser {
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role };
}

function normalizePlace(row: any): ApiPlace {
  const fallbackProfile: FlavorProfile = places.find((place) => place.id === row.id)?.flavorProfile ?? { intensity: 50, spicy: 50, traditional: 50, texture: 50, value: 50 };
  return {
    id: row.id,
    taqueriaId: row.taqueria_id ?? row.id,
    taqueriaName: row.taqueria_name ?? row.name,
    name: row.name,
    neighborhood: row.neighborhood,
    distance: row.distance_km == null ? 'cerca de ti' : `${Number(row.distance_km).toFixed(1)} km`,
    openUntil: row.open_until ?? '23:00',
    rating: Number(row.rating),
    reviewCount: row.review_count == null ? undefined : Number(row.review_count),
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

function haversineKm(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const earthRadiusKm = 6371;
  const latitudeDelta = (to.latitude - from.latitude) * Math.PI / 180;
  const longitudeDelta = (to.longitude - from.longitude) * Math.PI / 180;
  const latitudeA = from.latitude * Math.PI / 180;
  const latitudeB = to.latitude * Math.PI / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function normalizeSearchText(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

// Reputation is deliberately conservative: recent reviews matter, noisy
// ratings are discounted, and one prolific reviewer cannot dominate a branch.
// The Bayesian prior keeps low-volume places from jumping to the top of the
// map while the recency component lets a sustained change in quality surface.
const reputationJoin = `
      LEFT JOIN LATERAL (
        SELECT stats.review_count,
          CASE WHEN stats.review_count = 0 THEN b.rating
            ELSE LEAST(5::numeric, GREATEST(1::numeric,
              (((stats.effective_count * ((stats.average_rating * 0.65) + (stats.recent_rating * 0.35))) + (10 * COALESCE(b.rating, 4.2))) / (stats.effective_count + 10))
              - LEAST(0.25::numeric, stats.dispersion * 0.08)
              + LEAST(0.08::numeric, GREATEST(0::numeric, stats.recent_rating - stats.average_rating) * 0.12)
            ))
          END AS score
        FROM (
          SELECT COUNT(*)::numeric AS review_count,
            AVG(v.rating)::numeric AS average_rating,
            COALESCE(STDDEV_POP(v.rating), 0)::numeric AS dispersion,
            COALESCE(
              (
                SUM(v.rating * POWER(0.5::double precision,
                  GREATEST(0::double precision, EXTRACT(EPOCH FROM (now() - v.visited_at))::double precision / 15552000.0)))
                / NULLIF(SUM(POWER(0.5::double precision,
                  GREATEST(0::double precision, EXTRACT(EPOCH FROM (now() - v.visited_at))::double precision / 15552000.0))), 0)
              )::numeric,
              AVG(v.rating)::numeric,
              b.rating
            ) AS recent_rating,
            GREATEST(1::numeric, LEAST(COUNT(*)::numeric, GREATEST(1::numeric, COUNT(DISTINCT v.user_id)::numeric * 3))) AS effective_count
          FROM visits v
          WHERE v.branch_id = b.id AND v.visibility = 'visible'
        ) stats
      ) reviews ON true`;

const reputationSelect = `
      CASE WHEN COALESCE(reviews.review_count, 0) = 0 THEN b.rating ELSE reviews.score END AS rating,
      COALESCE(reviews.review_count, 0)::int AS review_count,`;

const tacoReputationSelect = `(
        SELECT CASE WHEN stats.review_count = 0 THEN m.rating
          ELSE LEAST(5::numeric, GREATEST(1::numeric,
            (((stats.effective_count * ((stats.average_rating * 0.65) + (stats.recent_rating * 0.35))) + (5 * COALESCE(m.rating, 4.2))) / (stats.effective_count + 5))
            - LEAST(0.25::numeric, stats.dispersion * 0.08)
            + LEAST(0.08::numeric, GREATEST(0::numeric, stats.recent_rating - stats.average_rating) * 0.12)
          ))
        END
        FROM (
          SELECT COUNT(*)::numeric AS review_count,
            AVG(vi.rating)::numeric AS average_rating,
            COALESCE(STDDEV_POP(vi.rating), 0)::numeric AS dispersion,
            COALESCE(
              (
                SUM(vi.rating * POWER(0.5::double precision,
                  GREATEST(0::double precision, EXTRACT(EPOCH FROM (now() - vv.visited_at))::double precision / 15552000.0)))
                / NULLIF(SUM(POWER(0.5::double precision,
                  GREATEST(0::double precision, EXTRACT(EPOCH FROM (now() - vv.visited_at))::double precision / 15552000.0))), 0)
              )::numeric,
              AVG(vi.rating)::numeric,
              m.rating
            ) AS recent_rating,
            GREATEST(1::numeric, LEAST(COUNT(*)::numeric, GREATEST(1::numeric, COUNT(DISTINCT vv.user_id)::numeric * 3))) AS effective_count
          FROM visit_items vi JOIN visits vv ON vv.id = vi.visit_id
          WHERE vi.menu_item_id = m.id AND vi.rating IS NOT NULL AND vv.visibility = 'visible'
        ) stats
      )`;

type LocalReview = { rating: number; userId: string; createdAt: string };

function localRobustScore(reviews: LocalReview[], priorStrength: number, fallback: number) {
  if (!reviews.length) return fallback;
  const average = reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length;
  const variance = reviews.reduce((sum, review) => sum + (review.rating - average) ** 2, 0) / reviews.length;
  const dispersion = Math.sqrt(variance);
  const now = Date.now();
  const weights = reviews.map((review) => 0.5 ** (Math.max(0, now - Date.parse(review.createdAt)) / (180 * 24 * 60 * 60 * 1000)));
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  const recent = reviews.reduce((sum, review, index) => sum + review.rating * weights[index], 0) / weightTotal;
  const effectiveCount = Math.max(1, Math.min(reviews.length, Math.max(1, new Set(reviews.map((review) => review.userId)).size * 3)));
  const priorMean = Math.max(1, Math.min(5, fallback));
  return Math.max(1, Math.min(5,
    ((effectiveCount * (average * 0.65 + recent * 0.35)) + (priorStrength * priorMean)) / (effectiveCount + priorStrength)
      - Math.min(0.25, dispersion * 0.08)
      + Math.min(0.08, Math.max(0, recent - average) * 0.12)
  ));
}

function localReputation(place: ApiPlace): ApiPlace {
  const visits = [...localVisits.values()].filter((visit) => visit.placeId === place.id && visit.visibility === 'visible');
  const reviews = visits.map((visit) => ({ rating: visit.rating, userId: visit.userId, createdAt: visit.createdAt }));
  const tacos = place.tacos.map((taco) => {
    const tacoReviews = visits.flatMap((visit) => {
      const rating = visit.tacoRatings?.[taco.id];
      return rating == null ? [] : [{ rating, userId: visit.userId, createdAt: visit.createdAt }];
    });
    return { ...taco, rating: Number(localRobustScore(tacoReviews, 5, taco.rating).toFixed(2)) };
  });
  return { ...place, rating: Number(localRobustScore(reviews, 10, place.rating).toFixed(2)), tacos, ...(reviews.length ? { reviewCount: reviews.length } : {}) };
}

export async function discoverPlaces(query: DiscoverQuery, userId?: string): Promise<ApiPlace[]> {
  let discovered: ApiPlace[];
  if (!pool) {
    const normalized = query.q?.trim() ? normalizeSearchText(query.q.trim()) : undefined;
    const filtered = normalized ? places.filter((place) => normalizeSearchText(`${place.name} ${place.neighborhood} ${place.style} ${place.tags.join(' ')} ${place.tacos.map((taco) => taco.name).join(' ')}`).includes(normalized)) : places;
    const scored = filtered.map(localReputation);
    discovered = query.lat == null || query.lng == null ? scored.slice(0, query.limit) : scored
      .map((place) => ({ ...place, distance: `${haversineKm({ latitude: query.lat!, longitude: query.lng! }, place.coordinates).toFixed(1)} km` }))
      .sort((a, b) => Number.parseFloat(a.distance) - Number.parseFloat(b.distance))
      .slice(0, query.limit);
  } else {
    const values: unknown[] = [];
    const predicates: string[] = ['b.is_active = true'];
    if (query.q) {
      values.push(`%${query.q.trim()}%`);
      predicates.push(`(unaccent(b.name) ILIKE unaccent($${values.length}) OR unaccent(b.neighborhood) ILIKE unaccent($${values.length}) OR unaccent(b.search_text) ILIKE unaccent($${values.length}) OR EXISTS (SELECT 1 FROM menu_items search_menu WHERE search_menu.branch_id = b.id AND search_menu.is_active = true AND unaccent(search_menu.name) ILIKE unaccent($${values.length})))`);
    }
    const distanceSelect = query.lat != null && query.lng != null
      ? `ST_Distance(b.location, ST_SetSRID(ST_MakePoint($${values.length + 1}, $${values.length + 2}), 4326)::geography) / 1000 AS distance_km`
      : 'NULL::numeric AS distance_km';
    if (query.lat != null && query.lng != null) values.push(query.lng, query.lat);
    values.push(query.limit);
    const orderBy = query.lat != null && query.lng != null ? 'distance_km ASC NULLS LAST, rating DESC' : 'rating DESC';
    const result = await pool.query(`
      SELECT b.id, b.taqueria_id, t.name AS taqueria_name, b.name, b.neighborhood, b.open_until,
      ${reputationSelect}
      b.match_score, b.style,
      b.image_url, b.description, b.tags, b.flavor_profile, ST_Y(b.location::geometry) AS latitude,
      ST_X(b.location::geometry) AS longitude, ${distanceSelect},
      COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name, 'rating', COALESCE((
        ${tacoReputationSelect}
      ), m.rating),
        'price', m.price, 'note', m.note)) FILTER (WHERE m.id IS NOT NULL), '[]') AS tacos
    FROM branches b JOIN taquerias t ON t.id = b.taqueria_id
      ${reputationJoin}
      LEFT JOIN menu_items m ON m.branch_id = b.id AND m.is_active = true
    WHERE ${predicates.join(' AND ')}
    GROUP BY b.id, t.name, reviews.review_count, reviews.score ORDER BY ${orderBy} LIMIT $${values.length}
    `, values);
    discovered = result.rows.map(normalizePlace);
  }
  if (!userId || !discovered.length) return discovered;
  // Keep discovery's geographic/textual result set intact while replacing
  // only the affinity fields with the same recommendation model used by the
  // home screen. No social or private profile data is returned here.
  const personalized = await getRecommendations(userId);
  const scores = new Map(personalized.map((place) => [place.id, place]));
  return discovered.map((place) => {
    const match = scores.get(place.id);
    return match ? { ...place, match: match.match, tasteMatch: match.tasteMatch, socialMatch: match.socialMatch, friendCount: match.friendCount } : place;
  });
}

function tokenise(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((token) => token.length > 2);
}

export async function getRecommendations(userId?: string): Promise<ApiPlace[]> {
  const candidates = await discoverPlaces({ limit: 50 });
  if (!userId) return candidates;

  const preferenceTokens = new Set<string>();
  const tasteSums: FlavorProfile = { intensity: 0, spicy: 0, traditional: 0, texture: 0, value: 0 };
  let tasteSamples = 0;
  const socialSignals = new Map<string, { average: number; friendCount: number }>();
  if (pool) {
    const history = await pool.query(`
      SELECT v.id AS visit_id, v.rating, b.name, b.style, b.tags, b.flavor_profile, m.name AS taco_name
      FROM visits v JOIN branches b ON b.id = v.branch_id
      LEFT JOIN visit_items vi ON vi.visit_id = v.id
      LEFT JOIN menu_items m ON m.id = vi.menu_item_id
      WHERE v.user_id = $1 AND v.rating >= 4 AND v.visibility = 'visible'
    `, [userId]);
    const seenVisits = new Set<string>();
    for (const row of history.rows) {
      if (!seenVisits.has(row.visit_id)) {
        seenVisits.add(row.visit_id);
        const profile = row.flavor_profile as Partial<FlavorProfile> | null;
        if (profile) {
          tasteSamples += 1;
          for (const key of Object.keys(tasteSums) as Array<keyof FlavorProfile>) tasteSums[key] += Number(profile[key] ?? 50);
        }
      }
      for (const value of [row.name, row.style, row.taco_name, ...(row.tags ?? [])]) for (const token of tokenise(String(value ?? ''))) preferenceTokens.add(token);
    }
    const social = await pool.query(`
      SELECT v.branch_id, AVG(v.rating)::numeric AS average_rating, COUNT(DISTINCT v.user_id)::int AS friend_count
      FROM follows f JOIN visits v ON v.user_id = f.followed_id
      JOIN users followed ON followed.id = v.user_id
      WHERE f.follower_id = $1 AND v.visibility = 'visible' AND followed.share_activity = true GROUP BY v.branch_id
    `, [userId]);
    for (const row of social.rows) socialSignals.set(row.branch_id, { average: Number(row.average_rating), friendCount: Number(row.friend_count) });
  } else {
    const followedIds = [...localFollows].filter((key) => key.startsWith(`${userId}:`)).map((key) => key.slice(userId.length + 1));
    const socialSums = new Map<string, { sum: number; count: number; users: Set<string> }>();
    for (const visit of localVisits.values()) {
      if (visit.userId === userId && visit.rating >= 4 && visit.visibility === 'visible') {
        const place = places.find((item) => item.id === visit.placeId);
        if (place) {
          tasteSamples += 1;
          for (const key of Object.keys(tasteSums) as Array<keyof FlavorProfile>) tasteSums[key] += place.flavorProfile[key];
        }
        for (const value of [place?.name, place?.style, ...(place?.tags ?? []), ...visit.tacoIds.map((id) => place?.tacos.find((taco) => taco.id === id)?.name)]) for (const token of tokenise(String(value ?? ''))) preferenceTokens.add(token);
      }
      if (followedIds.includes(visit.userId) && visit.visibility === 'visible' && localUsers.get(visit.userId)?.shareActivity !== false) {
        const current = socialSums.get(visit.placeId) ?? { sum: 0, count: 0, users: new Set<string>() };
        current.sum += visit.rating;
        current.count += 1;
        current.users.add(visit.userId);
        socialSums.set(visit.placeId, current);
      }
    }
    for (const [placeId, signal] of socialSums) socialSignals.set(placeId, { average: signal.sum / signal.count, friendCount: signal.users.size });
  }
  if (!preferenceTokens.size && !socialSignals.size) return candidates;
  return candidates.map((place) => {
    const placeTokens = new Set(tokenise([place.name, place.style, ...place.tags, ...place.tacos.map((taco) => taco.name)].join(' ')));
    const overlap = [...placeTokens].filter((token) => preferenceTokens.has(token)).length;
    const tasteMatch = tasteSamples ? Math.max(0, Math.min(99, Math.round(100 - (Object.keys(tasteSums) as Array<keyof FlavorProfile>).reduce((sum, key) => sum + Math.abs(place.flavorProfile[key] - tasteSums[key] / tasteSamples), 0) / 5))) : undefined;
    const personalMatch = Math.min(99, Math.round(place.match * 0.7 + (tasteMatch ?? place.match) * 0.3 + Math.min(12, overlap * 3)));
    const social = socialSignals.get(place.id);
    const socialMatch = social ? Math.min(99, Math.round(social.average * 20)) : undefined;
    const match = socialMatch == null ? personalMatch : Math.min(99, Math.round(personalMatch * 0.75 + socialMatch * 0.25));
    return { ...place, match, tasteMatch, socialMatch, friendCount: social?.friendCount };
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
      FROM visits v JOIN branches b ON b.id = v.branch_id WHERE v.user_id = $1 AND v.visibility = 'visible'
    `, [userId]);
    const row = result.rows[0];
    visits = Number(row?.visits ?? 0);
    if (visits) for (const key of Object.keys(sums) as Array<keyof FlavorProfile>) sums[key] = Number(row[key] ?? defaultTaste.profile[key]);
  } else {
    for (const visit of localVisits.values()) {
      if (visit.userId !== userId || visit.visibility !== 'visible') continue;
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

export async function findPlace(id: string, userId?: string): Promise<ApiPlace | undefined> {
  const fallback = places.find((place) => place.id === id);
  let found: ApiPlace | undefined;
  if (!pool) {
    found = fallback ? localReputation(fallback) : fallback;
  } else {
    const result = await pool.query(`
    SELECT b.id, b.taqueria_id, t.name AS taqueria_name, b.name, b.neighborhood, b.open_until,
      ${reputationSelect}
      b.match_score, b.style,
      b.image_url, b.description, b.tags, b.flavor_profile, ST_Y(b.location::geometry) AS latitude,
      ST_X(b.location::geometry) AS longitude, NULL::numeric AS distance_km,
      COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name, 'rating', COALESCE((
        ${tacoReputationSelect}
      ), m.rating),
        'price', m.price, 'note', m.note)) FILTER (WHERE m.id IS NOT NULL), '[]') AS tacos
    FROM branches b JOIN taquerias t ON t.id = b.taqueria_id
      ${reputationJoin}
      LEFT JOIN menu_items m ON m.branch_id = b.id AND m.is_active = true
    WHERE b.id = $1 AND b.is_active = true GROUP BY b.id, t.name, reviews.review_count, reviews.score
    `, [id]);
    found = result.rows[0] ? normalizePlace(result.rows[0]) : undefined;
  }
  if (!found || !userId) return found;
  const personalized = await getRecommendations(userId);
  const match = personalized.find((place) => place.id === id);
  return match ? { ...found, match: match.match, tasteMatch: match.tasteMatch, socialMatch: match.socialMatch, friendCount: match.friendCount } : found;
}

export type ApiBranchReview = {
  id: string;
  visitedAt: string;
  rating: number;
  note: string;
  photoUrl?: string | null;
  tacos: string;
  user: { id: string; displayName: string };
};

/**
 * Public branch reviews are sourced from visible visits and respect the
 * author's activity preference. The email and any private account fields are
 * intentionally excluded from this projection.
 */
export async function getBranchReviews(branchId: string): Promise<ApiBranchReview[] | undefined> {
  if (pool) {
    const branch = await pool.query('SELECT 1 FROM branches WHERE id = $1 AND is_active = true', [branchId]);
    if (!branch.rowCount) return undefined;
    const result = await pool.query(`
      SELECT v.id, v.visited_at, v.rating, v.note, v.photo_url,
        u.id AS user_id, u.display_name,
        COALESCE(string_agg(m.name, ', ' ORDER BY m.name), '') AS tacos
      FROM visits v
      JOIN users u ON u.id = v.user_id AND u.is_active = true AND u.share_activity = true
      LEFT JOIN visit_items vi ON vi.visit_id = v.id
      LEFT JOIN menu_items m ON m.id = vi.menu_item_id
      WHERE v.branch_id = $1 AND v.visibility = 'visible'
      GROUP BY v.id, v.visited_at, v.rating, v.note, v.photo_url, u.id, u.display_name
      ORDER BY v.visited_at DESC
      LIMIT 50
    `, [branchId]);
    return result.rows.map((row) => ({
      id: row.id,
      visitedAt: new Date(row.visited_at).toISOString(),
      rating: Number(row.rating),
      note: row.note ?? '',
      photoUrl: row.photo_url ?? null,
      tacos: row.tacos ?? '',
      user: { id: row.user_id, displayName: row.display_name }
    }));
  }

  if (!places.some((place) => place.id === branchId)) return undefined;
  return [...localVisits.entries()]
    .filter(([, visit]) => visit.placeId === branchId && visit.visibility === 'visible' && localUsers.get(visit.userId)?.shareActivity !== false)
    .sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
    .map(([id, visit]) => {
      const place = places.find((item) => item.id === visit.placeId);
      const tacos = visit.tacoIds.map((tacoId) => place?.tacos.find((taco) => taco.id === tacoId)?.name ?? tacoId).join(', ');
      const author = localUsers.get(visit.userId);
      return { id, visitedAt: visit.createdAt, rating: visit.rating, note: visit.note ?? '', photoUrl: visit.photoUrl ?? null, tacos, user: { id: visit.userId, displayName: author?.displayName ?? 'Cuenta eliminada' } };
    });
}

export async function getTaqueria(id: string): Promise<ApiTaqueria | undefined> {
  if (pool) {
    const parent = await pool.query(`
      SELECT t.id, t.name, t.slug, t.description, COUNT(b.id)::int AS branch_count
      FROM taquerias t LEFT JOIN branches b ON b.taqueria_id = t.id AND b.is_active = true
      WHERE t.id = $1 GROUP BY t.id
    `, [id]);
    if (!parent.rows[0]) return undefined;
    const branchRows = await pool.query('SELECT id FROM branches WHERE taqueria_id = $1 AND is_active = true ORDER BY neighborhood, name', [id]);
    const branches = (await Promise.all(branchRows.rows.map((row) => findPlace(row.id)))).filter((place): place is ApiPlace => Boolean(place));
    return { id: parent.rows[0].id, name: parent.rows[0].name, slug: parent.rows[0].slug, description: parent.rows[0].description, branchCount: Number(parent.rows[0].branch_count), branches };
  }
  const branches = places.filter((place) => (place.taqueriaId ?? place.id) === id);
  if (!branches.length) return undefined;
  const first = branches[0];
  return { id, name: first.taqueriaName ?? first.name, slug: id, description: `${first.name} y sus sucursales.`, branchCount: branches.length, branches };
}

export async function getSavedPlaceIds(userId: string): Promise<string[]> {
  if (pool) {
    const result = await pool.query('SELECT branch_id FROM saved_places WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    return result.rows.map((row) => row.branch_id);
  }
  return [...localSavedPlaces].filter((key) => key.startsWith(`${userId}:`)).map((key) => key.slice(userId.length + 1));
}

export async function savePlaceForUser(placeId: string, userId: string): Promise<'saved' | 'already_saved' | 'not_found'> {
  if (pool) {
    const branch = await pool.query('SELECT 1 FROM branches WHERE id = $1 AND is_active = true', [placeId]);
    if (!branch.rowCount) return 'not_found';
    const result = await pool.query('INSERT INTO saved_places (user_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING branch_id', [userId, placeId]);
    return result.rowCount ? 'saved' : 'already_saved';
  }
  if (!places.some((place) => place.id === placeId)) return 'not_found';
  const key = `${userId}:${placeId}`;
  if (localSavedPlaces.has(key)) return 'already_saved';
  localSavedPlaces.add(key);
  return 'saved';
}

export async function unsavePlaceForUser(placeId: string, userId: string): Promise<boolean> {
  if (pool) {
    const result = await pool.query('DELETE FROM saved_places WHERE user_id = $1 AND branch_id = $2', [userId, placeId]);
    return Boolean(result.rowCount);
  }
  return localSavedPlaces.delete(`${userId}:${placeId}`);
}

export async function createVisit(input: VisitInput) {
  return createVisitForUser(input, 'demo-user');
}

export async function createVisitForUser(input: VisitInput, userId: string) {
  const id = crypto.randomUUID();
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO visits (id, user_id, branch_id, rating, price, note, photo_url, visit_location)
        VALUES ($1, $2, $3, $4, $5, $6, $7,
          CASE WHEN $8::numeric IS NULL OR $9::numeric IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint($9::numeric, $8::numeric), 4326)::geography END)`,
        [id, userId, input.placeId, input.rating, input.price ?? null, input.note?.trim() ?? '', input.photoUrl ?? null, input.latitude ?? null, input.longitude ?? null]);
      for (const tacoId of input.tacoIds) await client.query('INSERT INTO visit_items (visit_id, menu_item_id, rating) VALUES ($1, $2, $3)', [id, tacoId, input.tacoRatings?.[tacoId] ?? null]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const createdAt = new Date().toISOString();
  if (!pool) localVisits.set(id, { userId, ...input, createdAt, visibility: 'visible' });
  return { id, ...input, createdAt, status: 'recorded' };
}

type VisitUpdateInput = { rating?: number; tacoRatings?: Record<string, number>; price?: number | null; note?: string };

export async function updateVisitForUser(visitId: string, input: VisitUpdateInput, userId: string): Promise<'not_found' | 'invalid_taco' | { id: string; status: 'updated' }> {
  if (pool) {
    const owned = await pool.query('SELECT id FROM visits WHERE id = $1 AND user_id = $2', [visitId, userId]);
    if (!owned.rowCount) return 'not_found';
    if (input.tacoRatings) {
      const selected = await pool.query('SELECT menu_item_id FROM visit_items WHERE visit_id = $1', [visitId]);
      const selectedIds = new Set(selected.rows.map((row) => row.menu_item_id));
      if (Object.keys(input.tacoRatings).some((tacoId) => !selectedIds.has(tacoId))) return 'invalid_taco';
    }
    const values: unknown[] = [visitId, userId];
    const assignments: string[] = [];
    if (input.rating !== undefined) { values.push(input.rating); assignments.push(`rating = $${values.length}`); }
    if (input.price !== undefined) { values.push(input.price); assignments.push(`price = $${values.length}`); }
    if (input.note !== undefined) { values.push(input.note.trim()); assignments.push(`note = $${values.length}`); }
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (assignments.length) await client.query(`UPDATE visits SET ${assignments.join(', ')}, updated_at = now() WHERE id = $1 AND user_id = $2`, values);
      if (input.tacoRatings) {
        for (const [tacoId, rating] of Object.entries(input.tacoRatings)) {
          await client.query('UPDATE visit_items SET rating = $3 WHERE visit_id = $1 AND menu_item_id = $2', [visitId, tacoId, rating]);
        }
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
    return { id: visitId, status: 'updated' };
  }
  const visit = localVisits.get(visitId);
  if (!visit || visit.userId !== userId) return 'not_found';
  if (input.tacoRatings && Object.keys(input.tacoRatings).some((tacoId) => !visit.tacoIds.includes(tacoId))) return 'invalid_taco';
  if (input.rating !== undefined) visit.rating = input.rating;
  if (input.price !== undefined) visit.price = input.price ?? undefined;
  if (input.note !== undefined) visit.note = input.note.trim();
  if (input.tacoRatings) visit.tacoRatings = { ...(visit.tacoRatings ?? {}), ...input.tacoRatings };
  return { id: visitId, status: 'updated' };
}

export async function deleteVisitForUser(visitId: string, userId: string): Promise<boolean> {
  if (pool) {
    const result = await pool.query('DELETE FROM visits WHERE id = $1 AND user_id = $2', [visitId, userId]);
    return Boolean(result.rowCount);
  }
  const visit = localVisits.get(visitId);
  if (!visit || visit.userId !== userId) return false;
  localVisits.delete(visitId);
  for (const [commentId, comment] of localComments.entries()) if (comment.visitId === visitId) localComments.delete(commentId);
  for (const [reportId, report] of localReports.entries()) if (report.visitId === visitId) localReports.delete(reportId);
  return true;
}

export async function registerUser(input: { email: string; password: string; displayName: string }): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  const displayName = input.displayName.trim();
  if (pool) {
    const existing = await pool.query('SELECT id FROM users WHERE email_lower = $1', [email]);
    if (existing.rowCount) throw new Error('EMAIL_TAKEN');
    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const role = configuredAdminEmails.has(email) ? 'admin' : 'user';
    const result = await pool.query('INSERT INTO users (id, email, email_lower, password_hash, display_name, role) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, email, display_name, role', [id, input.email.trim(), email, passwordHash, displayName, role]);
    return { id: result.rows[0].id, email: result.rows[0].email, displayName: result.rows[0].display_name, role: result.rows[0].role };
  }
  if ([...localUsers.values()].some((user) => user.email === email)) throw new Error('EMAIL_TAKEN');
  const user: LocalUser = { id: crypto.randomUUID(), email, displayName, role: configuredAdminEmails.has(email) ? 'admin' : 'user', passwordHash: await bcrypt.hash(input.password, 10), shareActivity: true };
  localUsers.set(user.id, user);
  return publicUser(user);
}

export async function authenticateUser(input: { email: string; password: string }): Promise<PublicUser | undefined> {
  const email = input.email.trim().toLowerCase();
  if (pool) {
    const result = await pool.query('SELECT id, email, display_name, password_hash, role FROM users WHERE email_lower = $1 AND is_active = true', [email]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(input.password, row.password_hash))) return undefined;
    return { id: row.id, email: row.email, displayName: row.display_name, role: row.role };
  }
  const user = [...localUsers.values()].find((item) => item.email === email);
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) return undefined;
  return publicUser(user);
}

export async function findUserById(id: string): Promise<PublicUser | undefined> {
  if (pool) {
    const result = await pool.query('SELECT id, email, display_name, role FROM users WHERE id = $1 AND is_active = true', [id]);
    const row = result.rows[0];
    return row ? { id: row.id, email: row.email, displayName: row.display_name, role: row.role } : undefined;
  }
  const user = localUsers.get(id);
  return user ? publicUser(user) : undefined;
}

export async function getPrivacyForUser(userId: string): Promise<{ shareActivity: boolean } | undefined> {
  if (pool) {
    const result = await pool.query('SELECT share_activity FROM users WHERE id = $1 AND is_active = true', [userId]);
    return result.rows[0] ? { shareActivity: Boolean(result.rows[0].share_activity) } : undefined;
  }
  const user = localUsers.get(userId);
  return user ? { shareActivity: user.shareActivity } : undefined;
}

export async function updatePrivacyForUser(userId: string, input: { shareActivity: boolean }): Promise<{ shareActivity: boolean } | undefined> {
  if (pool) {
    const result = await pool.query('UPDATE users SET share_activity = $2, updated_at = now() WHERE id = $1 AND is_active = true RETURNING share_activity', [userId, input.shareActivity]);
    return result.rows[0] ? { shareActivity: Boolean(result.rows[0].share_activity) } : undefined;
  }
  const user = localUsers.get(userId);
  if (!user) return undefined;
  user.shareActivity = input.shareActivity;
  return { shareActivity: user.shareActivity };
}

export async function updateUserProfileForUser(userId: string, input: { displayName: string }): Promise<PublicUser | undefined> {
  const displayName = input.displayName.trim();
  if (pool) {
    const result = await pool.query('UPDATE users SET display_name = $2, updated_at = now() WHERE id = $1 AND is_active = true RETURNING id, email, display_name, role', [userId, displayName]);
    const row = result.rows[0];
    return row ? { id: row.id, email: row.email, displayName: row.display_name, role: row.role } : undefined;
  }
  const user = localUsers.get(userId);
  if (!user) return undefined;
  user.displayName = displayName;
  return publicUser(user);
}

export async function getUserProfile(userId: string, viewerId?: string) {
  const user = await findUserById(userId);
  if (!user) return undefined;
  let following = false;
  if (viewerId && viewerId !== userId) {
    if (pool) {
      const relation = await pool.query('SELECT 1 FROM follows WHERE follower_id = $1 AND followed_id = $2', [viewerId, userId]);
      following = Boolean(relation.rowCount);
    } else {
      following = localFollows.has(`${viewerId}:${userId}`);
    }
  }
  // Public profile aggregates are activity signals too. A user may still
  // inspect their own complete diary, but other viewers should see a neutral
  // profile when that user disabled social activity sharing.
  const privacy = await getPrivacyForUser(userId);
  const canViewActivity = viewerId === userId || privacy?.shareActivity !== false;
  const entries = canViewActivity ? await getDiary(userId, false) : [];
  const ratings = entries.map((entry) => Number(entry.rating)).filter(Number.isFinite);
  const allLists = await getLists(viewerId === userId ? userId : viewerId);
  const lists = allLists.filter((list) => list.owner.id === userId && (list.visibility !== 'private' || viewerId === userId));
  return {
    user: { id: user.id, displayName: user.displayName, following },
    stats: { visits: entries.length, averageRating: ratings.length ? Number((ratings.reduce((sum, rating) => sum + rating, 0) / ratings.length).toFixed(2)) : null, listCount: lists.length },
    taste: canViewActivity ? await getTasteProfile(userId) : { ...defaultTaste, profile: { ...defaultTaste.profile }, tags: [...defaultTaste.tags] },
    lists
  };
}

export async function getDiary(userId: string, includeHidden = true) {
  if (pool) {
    const visibilityFilter = includeHidden ? '' : " AND v.visibility = 'visible'";
    const result = await pool.query(`
      SELECT v.id, v.visited_at, v.rating, v.price, v.note, v.photo_url, b.name AS place_name, b.neighborhood,
        COALESCE(string_agg(m.name, ', ' ORDER BY m.name), '') AS tacos,
      COALESCE(json_object_agg(m.id, vi.rating) FILTER (WHERE m.id IS NOT NULL), '{}'::json) AS taco_ratings,
        COALESCE(v.photo_url, b.image_url) AS image_url
      FROM visits v JOIN branches b ON b.id = v.branch_id
      LEFT JOIN visit_items vi ON vi.visit_id = v.id
      LEFT JOIN menu_items m ON m.id = vi.menu_item_id
      WHERE v.user_id = $1${visibilityFilter} GROUP BY v.id, v.price, v.note, v.photo_url, b.name, b.neighborhood, b.image_url
      ORDER BY v.visited_at DESC LIMIT 100
    `, [userId]);
    return result.rows;
  }
  return [...localVisits.entries()].filter(([, visit]) => visit.userId === userId && (includeHidden || visit.visibility === 'visible')).sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt)).map(([id, visit]) => {
    const place = places.find((item) => item.id === visit.placeId);
    const tacoNames = visit.tacoIds.map((tacoId) => place?.tacos.find((taco) => taco.id === tacoId)?.name ?? tacoId).join(', ');
    return { id, visited_at: visit.createdAt, rating: visit.rating, price: visit.price ?? null, note: visit.note ?? '', photo_url: visit.photoUrl ?? null, place_name: place?.name ?? visit.placeId, neighborhood: place?.neighborhood ?? '', tacos: tacoNames, taco_ratings: visit.tacoRatings ?? {}, image_url: visit.photoUrl ?? place?.image ?? '' };
  });
}

type ListRole = 'owner' | 'editor' | 'viewer';

async function getListRole(listId: string, userId: string): Promise<ListRole | undefined> {
  if (pool) {
    const result = await pool.query(`
      SELECT l.owner_id, lc.role
      FROM lists l LEFT JOIN list_collaborators lc ON lc.list_id = l.id AND lc.user_id = $2
      WHERE l.id = $1
    `, [listId, userId]);
    const row = result.rows[0];
    if (!row) return undefined;
    if (row.owner_id === userId) return 'owner';
    return row.role === 'editor' || row.role === 'viewer' ? row.role : undefined;
  }
  const list = localLists.get(listId);
  if (!list) return undefined;
  if (list.ownerId === userId) return 'owner';
  const collaborator = localListCollaborators.get(`${listId}:${userId}`);
  return collaborator?.role;
}

async function getListCollaborators(listId: string): Promise<Array<{ id: string; displayName: string; role: 'editor' | 'viewer' }>> {
  if (pool) {
    const result = await pool.query(`
      SELECT u.id, u.display_name, lc.role
      FROM list_collaborators lc JOIN users u ON u.id = lc.user_id
      WHERE lc.list_id = $1 ORDER BY lc.created_at ASC
    `, [listId]);
    return result.rows.map((row) => ({ id: row.id, displayName: row.display_name, role: row.role }));
  }
  return [...localListCollaborators.values()]
    .filter((collaborator) => collaborator.listId === listId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((collaborator) => ({ id: collaborator.userId, displayName: localUsers.get(collaborator.userId)?.displayName ?? 'Cuenta eliminada', role: collaborator.role }));
}

function normalizeList(row: any): ApiList {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? '',
    owner: { id: row.owner_id, displayName: row.owner_name },
    itemCount: Number(row.item_count ?? 0),
    visitedCount: Number(row.visited_count ?? 0),
    coverImage: row.cover_image_url ?? places[0].image,
    visibility: row.visibility ?? 'public',
    collaboratorCount: Number(row.collaborator_count ?? 0),
    canEdit: Boolean(row.can_edit)
  };
}

export async function getLists(userId?: string): Promise<ApiList[]> {
  if (pool) {
    const result = await pool.query(`
      SELECT l.id, l.title, l.description, l.visibility, l.owner_id, u.display_name AS owner_name,
        COUNT(li.branch_id)::int AS item_count,
        (SELECT COUNT(*)::int FROM list_collaborators all_collaborators WHERE all_collaborators.list_id = l.id) AS collaborator_count,
        (l.owner_id = $1 OR EXISTS (SELECT 1 FROM list_collaborators me WHERE me.list_id = l.id AND me.user_id = $1 AND me.role = 'editor')) AS can_edit,
        COUNT(DISTINCT li.branch_id) FILTER (WHERE EXISTS (
          SELECT 1 FROM visits vv WHERE vv.user_id = $1 AND vv.branch_id = li.branch_id AND vv.visibility = 'visible'
        ))::int AS visited_count,
        COALESCE(l.cover_image_url, MIN(b.image_url)) AS cover_image_url
      FROM lists l JOIN users u ON u.id = l.owner_id
      LEFT JOIN list_items li ON li.list_id = l.id
      LEFT JOIN branches b ON b.id = li.branch_id
      WHERE l.visibility = 'public' OR l.owner_id = $1 OR EXISTS (SELECT 1 FROM list_collaborators viewer WHERE viewer.list_id = l.id AND viewer.user_id = $1)
      GROUP BY l.id, u.display_name
      ORDER BY l.updated_at DESC LIMIT 100
    `, [userId ?? null]);
    return result.rows.map(normalizeList);
  }
  // Keep the in-memory fallback aligned with PostgreSQL: every public list is
  // discoverable, while private lists are only returned to their owner.
  const visible = [...localLists.values()].filter((list) => list.visibility === 'public' || list.ownerId === userId || (userId ? localListCollaborators.has(`${list.id}:${userId}`) : false));
  const mapped = visible.map((list) => {
    const owner = localUsers.get(list.ownerId);
    const visitedCount = list.placeIds.filter((placeId) => [...localVisits.values()].some((visit) => visit.userId === userId && visit.placeId === placeId && visit.visibility === 'visible')).length;
    const collaboratorCount = [...localListCollaborators.values()].filter((collaborator) => collaborator.listId === list.id).length;
    const canEdit = list.ownerId === userId || [...localListCollaborators.values()].some((collaborator) => collaborator.listId === list.id && collaborator.userId === userId && collaborator.role === 'editor');
    return { id: list.id, title: list.title, description: list.description, owner: { id: list.ownerId, displayName: owner?.displayName ?? 'Tacos' }, itemCount: list.placeIds.length, visitedCount, coverImage: list.coverImage, visibility: list.visibility, collaboratorCount, canEdit } satisfies ApiList;
  });
  return [...fixtureLists, ...mapped];
}

export async function getListDetails(listId: string, userId?: string): Promise<ApiListDetail | undefined> {
  if (pool) {
    const listResult = await pool.query(`
        SELECT l.id, l.title, l.description, l.visibility, l.owner_id, u.display_name AS owner_name,
        COUNT(li.branch_id)::int AS item_count,
        (SELECT COUNT(*)::int FROM list_collaborators all_collaborators WHERE all_collaborators.list_id = l.id) AS collaborator_count,
        (l.owner_id = $2 OR EXISTS (SELECT 1 FROM list_collaborators me WHERE me.list_id = l.id AND me.user_id = $2 AND me.role = 'editor')) AS can_edit,
        COALESCE(SUM(CASE WHEN EXISTS (
          SELECT 1 FROM visits vv WHERE vv.user_id = $2 AND vv.branch_id = li.branch_id AND vv.visibility = 'visible'
        ) THEN 1 ELSE 0 END), 0)::int AS visited_count,
        COALESCE(l.cover_image_url, MIN(b.image_url)) AS cover_image_url
      FROM lists l JOIN users u ON u.id = l.owner_id
      LEFT JOIN list_items li ON li.list_id = l.id
      LEFT JOIN branches b ON b.id = li.branch_id
      WHERE l.id = $1 AND (l.visibility = 'public' OR l.owner_id = $2 OR EXISTS (SELECT 1 FROM list_collaborators viewer WHERE viewer.list_id = l.id AND viewer.user_id = $2))
      GROUP BY l.id, u.display_name
    `, [listId, userId ?? null]);
    if (!listResult.rows[0]) return undefined;
    const itemResult = await pool.query('SELECT branch_id, note, position FROM list_items WHERE list_id = $1 ORDER BY position, created_at', [listId]);
    const items = (await Promise.all(itemResult.rows.map(async (row) => ({ branchId: row.branch_id, note: row.note ?? '', position: Number(row.position), place: await findPlace(row.branch_id) })))).filter((item): item is { branchId: string; note: string; position: number; place: ApiPlace } => Boolean(item.place));
    return { ...normalizeList(listResult.rows[0]), collaborators: await getListCollaborators(listId), items };
  }
  const local = localLists.get(listId);
  if (local && (local.visibility === 'public' || local.ownerId === userId || (userId ? localListCollaborators.has(`${local.id}:${userId}`) : false))) {
    const owner = localUsers.get(local.ownerId);
    const visitedCount = local.placeIds.filter((placeId) => [...localVisits.values()].some((visit) => visit.userId === userId && visit.placeId === placeId && visit.visibility === 'visible')).length;
    const collaborators = await getListCollaborators(local.id);
    const canEdit = local.ownerId === userId || collaborators.some((collaborator) => collaborator.id === userId && collaborator.role === 'editor');
    return {
      id: local.id,
      title: local.title,
      description: local.description,
      owner: { id: local.ownerId, displayName: owner?.displayName ?? 'Tacos' },
      itemCount: local.placeIds.length,
      visitedCount,
      coverImage: local.coverImage,
      visibility: local.visibility,
      collaboratorCount: collaborators.length,
      canEdit,
      collaborators,
      items: local.placeIds.map((placeId, position) => { const place = places.find((item) => item.id === placeId); return place ? { branchId: placeId, note: '', position, place } : undefined; }).filter((item): item is { branchId: string; note: string; position: number; place: ApiPlace } => Boolean(item))
    };
  }
  const fixture = fixtureLists.find((item) => item.id === listId);
  return fixture ? { ...fixture, items: [] } : undefined;
}

export async function createListForUser(input: { title: string; description?: string; visibility?: 'public' | 'private' }, userId: string): Promise<ApiList> {
  const id = crypto.randomUUID();
  const title = input.title.trim();
  const description = input.description?.trim() ?? '';
  const visibility = input.visibility ?? 'public';
  if (pool) {
    await pool.query('INSERT INTO lists (id, owner_id, title, description, visibility) VALUES ($1, $2, $3, $4, $5)', [id, userId, title, description, visibility]);
    const created = await pool.query(`
      SELECT l.id, l.title, l.description, l.visibility, l.owner_id, u.display_name AS owner_name,
        0::int AS item_count, 0::int AS visited_count, NULL::text AS cover_image_url,
        0::int AS collaborator_count, true AS can_edit
      FROM lists l JOIN users u ON u.id = l.owner_id WHERE l.id = $1
    `, [id]);
    return normalizeList(created.rows[0]);
  }
  const createdAt = new Date().toISOString();
  localLists.set(id, { id, ownerId: userId, title, description, visibility, coverImage: places[0].image, placeIds: [], createdAt });
  const owner = localUsers.get(userId);
  return { id, title, description, owner: { id: userId, displayName: owner?.displayName ?? 'Tacos' }, itemCount: 0, visitedCount: 0, coverImage: places[0].image, visibility, collaboratorCount: 0, canEdit: true };
}

export async function updateListForUser(listId: string, input: { title?: string; description?: string; visibility?: 'public' | 'private' }, userId: string): Promise<ApiListDetail | undefined> {
  if (pool) {
    const values: unknown[] = [listId, userId];
    const assignments: string[] = [];
    if (input.title !== undefined) { values.push(input.title.trim()); assignments.push(`title = $${values.length}`); }
    if (input.description !== undefined) { values.push(input.description.trim()); assignments.push(`description = $${values.length}`); }
    if (input.visibility !== undefined) { values.push(input.visibility); assignments.push(`visibility = $${values.length}`); }
    if (assignments.length) {
      const updated = await pool.query(`UPDATE lists SET ${assignments.join(', ')}, updated_at = now() WHERE id = $1 AND owner_id = $2 RETURNING id`, values);
      if (!updated.rowCount) return undefined;
    }
    return getListDetails(listId, userId);
  }
  const list = localLists.get(listId);
  if (!list || list.ownerId !== userId) return undefined;
  if (input.title !== undefined) list.title = input.title.trim();
  if (input.description !== undefined) list.description = input.description.trim();
  if (input.visibility !== undefined) list.visibility = input.visibility;
  const detail = await getListDetails(listId, userId);
  return detail;
}

type CollaboratorResult = 'added' | 'already' | 'not_found' | 'not_allowed' | 'self';

export async function addListCollaborator(listId: string, collaboratorId: string, role: 'editor' | 'viewer', ownerId: string): Promise<CollaboratorResult> {
  if (pool) {
    const list = await pool.query('SELECT owner_id FROM lists WHERE id = $1', [listId]);
    if (!list.rowCount) return 'not_found';
    if (list.rows[0].owner_id !== ownerId) return 'not_allowed';
    if (list.rows[0].owner_id === collaboratorId) return 'self';
    const target = await pool.query('SELECT 1 FROM users WHERE id = $1 AND is_active = true', [collaboratorId]);
    if (!target.rowCount) return 'not_found';
    const existing = await pool.query('SELECT 1 FROM list_collaborators WHERE list_id = $1 AND user_id = $2', [listId, collaboratorId]);
    if (existing.rowCount) {
      await pool.query('UPDATE list_collaborators SET role = $3 WHERE list_id = $1 AND user_id = $2', [listId, collaboratorId, role]);
      await pool.query('UPDATE lists SET updated_at = now() WHERE id = $1', [listId]);
      return 'already';
    }
    await pool.query('INSERT INTO list_collaborators (list_id, user_id, role) VALUES ($1, $2, $3)', [listId, collaboratorId, role]);
    await pool.query('UPDATE lists SET updated_at = now() WHERE id = $1', [listId]);
    return 'added';
  }
  const list = localLists.get(listId);
  if (!list) return 'not_found';
  if (list.ownerId !== ownerId) return 'not_allowed';
  if (list.ownerId === collaboratorId) return 'self';
  if (!localUsers.has(collaboratorId)) return 'not_found';
  const key = `${listId}:${collaboratorId}`;
  const already = localListCollaborators.has(key);
  localListCollaborators.set(key, { listId, userId: collaboratorId, role, createdAt: localListCollaborators.get(key)?.createdAt ?? new Date().toISOString() });
  return already ? 'already' : 'added';
}

export async function removeListCollaborator(listId: string, collaboratorId: string, ownerId: string): Promise<'removed' | 'not_found' | 'not_allowed'> {
  if (pool) {
    const list = await pool.query('SELECT owner_id FROM lists WHERE id = $1', [listId]);
    if (!list.rowCount) return 'not_found';
    if (list.rows[0].owner_id !== ownerId) return 'not_allowed';
    const result = await pool.query('DELETE FROM list_collaborators WHERE list_id = $1 AND user_id = $2', [listId, collaboratorId]);
    if (!result.rowCount) return 'not_found';
    await pool.query('UPDATE lists SET updated_at = now() WHERE id = $1', [listId]);
    return 'removed';
  }
  const list = localLists.get(listId);
  if (!list) return 'not_found';
  if (list.ownerId !== ownerId) return 'not_allowed';
  return localListCollaborators.delete(`${listId}:${collaboratorId}`) ? 'removed' : 'not_found';
}

export async function addListItemForUser(listId: string, placeId: string, userId: string, note = ''): Promise<boolean> {
  if (pool) {
    const role = await getListRole(listId, userId);
    if (role !== 'owner' && role !== 'editor') return false;
    const branch = await pool.query('SELECT 1 FROM branches WHERE id = $1 AND is_active = true', [placeId]);
    if (!branch.rowCount) return false;
    await pool.query(`
      INSERT INTO list_items (list_id, branch_id, position, note)
      VALUES ($1, $2, COALESCE((SELECT MAX(position) + 1 FROM list_items WHERE list_id = $1), 0), $3)
      ON CONFLICT (list_id, branch_id) DO UPDATE SET note = EXCLUDED.note
    `, [listId, placeId, note.trim()]);
    await pool.query('UPDATE lists SET updated_at = now() WHERE id = $1', [listId]);
    return true;
  }
  const list = localLists.get(listId);
  const role = list ? await getListRole(listId, userId) : undefined;
  if (!list || (role !== 'owner' && role !== 'editor') || !places.some((place) => place.id === placeId)) return false;
  if (!list.placeIds.includes(placeId)) list.placeIds.push(placeId);
  return true;
}

export async function removeListItemForUser(listId: string, placeId: string, userId: string): Promise<boolean> {
  if (pool) {
    const role = await getListRole(listId, userId);
    if (role !== 'owner' && role !== 'editor') return false;
    const removed = await pool.query('DELETE FROM list_items WHERE list_id = $1 AND branch_id = $2', [listId, placeId]);
    if (removed.rowCount) await pool.query('UPDATE lists SET updated_at = now() WHERE id = $1', [listId]);
    return Boolean(removed.rowCount);
  }
  const list = localLists.get(listId);
  const role = list ? await getListRole(listId, userId) : undefined;
  if (!list || (role !== 'owner' && role !== 'editor')) return false;
  const index = list.placeIds.indexOf(placeId);
  if (index === -1) return false;
  list.placeIds.splice(index, 1);
  return true;
}

export async function searchUsers(query: string, currentUserId?: string): Promise<PublicUser[]> {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  if (pool) {
    const result = await pool.query(`
      SELECT u.id, u.email, u.display_name, u.role,
        EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $1 AND f.followed_id = u.id) AS following
      FROM users u
      WHERE u.is_active = true AND u.id <> $1 AND (u.display_name ILIKE $2 OR u.email ILIKE $2)
      ORDER BY display_name LIMIT 20
    `, [currentUserId ?? '', `%${normalized}%`]);
    return result.rows.map((row) => ({ id: row.id, email: row.email, displayName: row.display_name, role: row.role, following: Boolean(row.following) }));
  }
  return [...localUsers.values()].filter((user) => user.id !== currentUserId && `${user.displayName} ${user.email}`.toLowerCase().includes(normalized)).slice(0, 20).map((user) => ({ ...publicUser(user), following: currentUserId ? localFollows.has(`${currentUserId}:${user.id}`) : false }));
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
      SELECT v.id, v.visited_at, v.rating, v.note, u.id AS user_id, u.display_name,
        b.id AS place_id, b.name AS place_name, b.neighborhood, COALESCE(v.photo_url, b.image_url) AS image_url,
        COALESCE(string_agg(m.name, ', ' ORDER BY m.name), '') AS tacos,
        (SELECT COUNT(*)::int FROM visit_comments c WHERE c.visit_id = v.id AND c.visibility = 'visible') AS comment_count
      FROM follows f JOIN visits v ON v.user_id = f.followed_id
      JOIN users u ON u.id = v.user_id JOIN branches b ON b.id = v.branch_id
      LEFT JOIN visit_items vi ON vi.visit_id = v.id LEFT JOIN menu_items m ON m.id = vi.menu_item_id
      WHERE f.follower_id = $1 AND v.visibility = 'visible' AND u.share_activity = true GROUP BY v.id, v.photo_url, v.note, u.id, b.id ORDER BY v.visited_at DESC LIMIT 50
    `, [userId]);
    return result.rows;
  }
  const followed = [...localFollows].filter((key) => key.startsWith(`${userId}:`)).map((key) => key.slice(userId.length + 1));
  return [...localVisits.entries()].filter(([, visit]) => followed.includes(visit.userId) && visit.visibility === 'visible' && localUsers.get(visit.userId)?.shareActivity !== false).sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt)).map(([id, visit]) => {
    const place = places.find((item) => item.id === visit.placeId);
    const user = localUsers.get(visit.userId);
    const tacos = visit.tacoIds.map((tacoId) => place?.tacos.find((taco) => taco.id === tacoId)?.name ?? tacoId).join(', ');
    return { id, visited_at: visit.createdAt, rating: visit.rating, note: visit.note ?? '', user_id: visit.userId, display_name: user?.displayName ?? 'Tacos', place_id: visit.placeId, place_name: place?.name ?? visit.placeId, neighborhood: place?.neighborhood ?? '', image_url: visit.photoUrl ?? place?.image ?? '', tacos, comment_count: [...localComments.values()].filter((comment) => comment.visitId === id && comment.visibility === 'visible').length };
  });
}

type VisitComment = { id: string; body: string; createdAt: string; author: { id: string; displayName: string }; own: boolean };
export type AdminComment = { id: string; visitId: string; body: string; visibility: 'visible' | 'hidden'; createdAt: string; author: { id: string; displayName: string }; place: { id: string; name: string } };

async function canViewVisitComments(visitId: string, userId: string) {
  if (pool) {
    const result = await pool.query(`
      SELECT v.id
      FROM visits v JOIN users author ON author.id = v.user_id
      WHERE v.id = $1 AND v.visibility = 'visible'
        AND (v.user_id = $2 OR (author.share_activity = true AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $2 AND f.followed_id = v.user_id)))
    `, [visitId, userId]);
    return Boolean(result.rowCount);
  }
  const visit = localVisits.get(visitId);
  if (!visit || visit.visibility !== 'visible') return false;
  return visit.userId === userId || (localUsers.get(visit.userId)?.shareActivity !== false && localFollows.has(`${userId}:${visit.userId}`));
}

export async function getVisitComments(visitId: string, userId: string): Promise<VisitComment[] | undefined> {
  if (!(await canViewVisitComments(visitId, userId))) return undefined;
  if (pool) {
    const result = await pool.query(`
      SELECT c.id, c.body, c.created_at, u.id AS author_id, u.display_name
      FROM visit_comments c JOIN users u ON u.id = c.author_id
      WHERE c.visit_id = $1 AND c.visibility = 'visible'
      ORDER BY c.created_at ASC LIMIT 100
    `, [visitId]);
    return result.rows.map((row) => ({ id: row.id, body: row.body, createdAt: row.created_at, author: { id: row.author_id, displayName: row.display_name }, own: row.author_id === userId }));
  }
  return [...localComments.values()].filter((comment) => comment.visitId === visitId && comment.visibility === 'visible').sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((comment) => ({ id: comment.id, body: comment.body, createdAt: comment.createdAt, author: { id: comment.authorId, displayName: localUsers.get(comment.authorId)?.displayName ?? 'Tacos' }, own: comment.authorId === userId }));
}

export async function createVisitComment(visitId: string, body: string, userId: string): Promise<VisitComment | undefined> {
  if (!(await canViewVisitComments(visitId, userId))) return undefined;
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  if (pool) {
    const result = await pool.query(`
      INSERT INTO visit_comments (id, visit_id, author_id, body) VALUES ($1, $2, $3, $4)
      RETURNING id, body, created_at
    `, [id, visitId, userId, body.trim()]);
    const row = result.rows[0];
    return { id: row.id, body: row.body, createdAt: row.created_at, author: { id: userId, displayName: (await findUserById(userId))?.displayName ?? 'Tacos' }, own: true };
  }
  localComments.set(id, { id, visitId, authorId: userId, body: body.trim(), createdAt, visibility: 'visible' });
  return { id, body: body.trim(), createdAt, author: { id: userId, displayName: localUsers.get(userId)?.displayName ?? 'Tacos' }, own: true };
}

export async function deleteVisitComment(commentId: string, userId: string): Promise<boolean> {
  if (pool) {
    const result = await pool.query('DELETE FROM visit_comments WHERE id = $1 AND author_id = $2', [commentId, userId]);
    return Boolean(result.rowCount);
  }
  const comment = localComments.get(commentId);
  if (!comment || comment.authorId !== userId) return false;
  localComments.delete(commentId);
  return true;
}

export async function getAdminComments(visibility: 'visible' | 'hidden' | 'all' = 'visible'): Promise<AdminComment[]> {
  if (pool) {
    const result = await pool.query(`
      SELECT c.id, c.visit_id, c.body, c.visibility, c.created_at,
        u.id AS author_id, u.display_name AS author_name,
        b.id AS place_id, b.name AS place_name
      FROM visit_comments c
      JOIN users u ON u.id = c.author_id
      JOIN visits v ON v.id = c.visit_id
      JOIN branches b ON b.id = v.branch_id
      ${visibility === 'all' ? '' : 'WHERE c.visibility = $1'}
      ORDER BY c.created_at DESC LIMIT 100
    `, visibility === 'all' ? [] : [visibility]);
    return result.rows.map((row) => ({ id: row.id, visitId: row.visit_id, body: row.body, visibility: row.visibility, createdAt: row.created_at, author: { id: row.author_id, displayName: row.author_name }, place: { id: row.place_id, name: row.place_name } }));
  }
  return [...localComments.values()]
    .filter((comment) => visibility === 'all' || comment.visibility === visibility)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((comment) => {
      const visit = localVisits.get(comment.visitId);
      const place = visit ? places.find((item) => item.id === visit.placeId) : undefined;
      const author = localUsers.get(comment.authorId);
      return { id: comment.id, visitId: comment.visitId, body: comment.body, visibility: comment.visibility, createdAt: comment.createdAt, author: { id: comment.authorId, displayName: author?.displayName ?? 'Cuenta eliminada' }, place: { id: place?.id ?? visit?.placeId ?? '', name: place?.name ?? 'Lugar desconocido' } } satisfies AdminComment;
    });
}

export async function reviewAdminComment(commentId: string, action: 'hide' | 'restore'): Promise<boolean> {
  if (pool) {
    const result = await pool.query('UPDATE visit_comments SET visibility = $2 WHERE id = $1 RETURNING id', [commentId, action === 'hide' ? 'hidden' : 'visible']);
    return Boolean(result.rowCount);
  }
  const comment = localComments.get(commentId);
  if (!comment) return false;
  comment.visibility = action === 'hide' ? 'hidden' : 'visible';
  return true;
}

export async function reportVisitForUser(input: ReportInput, reporterId: string): Promise<'created' | 'duplicate' | 'not_found'> {
  if (pool) {
    const visit = await pool.query('SELECT id FROM visits WHERE id = $1 AND user_id <> $2 AND visibility = \'visible\'', [input.visitId, reporterId]);
    if (!visit.rowCount) return 'not_found';
    const result = await pool.query(`
      INSERT INTO reports (id, reporter_id, visit_id, reason, details)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (reporter_id, visit_id) DO NOTHING
      RETURNING id
    `, [crypto.randomUUID(), reporterId, input.visitId, input.reason, input.details?.trim() ?? '']);
    return result.rowCount ? 'created' : 'duplicate';
  }
  const visit = localVisits.get(input.visitId);
  if (!visit || visit.userId === reporterId) return 'not_found';
  const key = `${reporterId}:${input.visitId}`;
  if (localReports.has(key)) return 'duplicate';
  localReports.set(key, { id: crypto.randomUUID(), reporterId, visitId: input.visitId, reason: input.reason, details: input.details?.trim() ?? '', status: 'open', createdAt: new Date().toISOString() });
  return 'created';
}

export async function getAdminReports(status: 'open' | 'reviewed' | 'dismissed' | 'all' = 'open'): Promise<AdminReport[]> {
  if (pool) {
    const result = await pool.query(`
      SELECT r.id, r.visit_id, r.reason, r.details, r.status, r.created_at,
        reporter.id AS reporter_id, reporter.display_name AS reporter_name,
        author.id AS author_id, author.display_name AS author_name,
        b.id AS place_id, b.name AS place_name, v.rating, v.visited_at
      FROM reports r
      JOIN users reporter ON reporter.id = r.reporter_id
      JOIN visits v ON v.id = r.visit_id
      LEFT JOIN users author ON author.id = v.user_id
      JOIN branches b ON b.id = v.branch_id
      ${status === 'all' ? '' : 'WHERE r.status = $1'}
      ORDER BY r.created_at DESC LIMIT 100
    `, status === 'all' ? [] : [status]);
    return result.rows.map((row) => ({
      id: row.id,
      visitId: row.visit_id,
      reason: row.reason,
      details: row.details ?? '',
      status: row.status,
      createdAt: row.created_at,
      reporter: { id: row.reporter_id, displayName: row.reporter_name },
      author: { id: row.author_id ?? '', displayName: row.author_name ?? 'Cuenta eliminada' },
      place: { id: row.place_id, name: row.place_name },
      rating: Number(row.rating),
      visitedAt: row.visited_at
    }));
  }
  return [...localReports.values()]
    .filter((report) => status === 'all' || report.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((report) => {
      const visit = localVisits.get(report.visitId);
      const reporter = localUsers.get(report.reporterId);
      const author = visit ? localUsers.get(visit.userId) : undefined;
      const place = visit ? places.find((item) => item.id === visit.placeId) : undefined;
      if (!visit || !place) return undefined;
      return { id: report.id, visitId: report.visitId, reason: report.reason, details: report.details, status: report.status, createdAt: report.createdAt, reporter: { id: report.reporterId, displayName: reporter?.displayName ?? 'Cuenta eliminada' }, author: { id: visit.userId, displayName: author?.displayName ?? 'Cuenta eliminada' }, place: { id: place.id, name: place.name }, rating: visit.rating, visitedAt: visit.createdAt } satisfies AdminReport;
    })
    .filter((report): report is AdminReport => Boolean(report));
}

export async function reviewAdminReport(reportId: string, action: 'hide' | 'dismiss'): Promise<boolean> {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (action === 'hide') await client.query("UPDATE visits SET visibility = 'hidden' WHERE id = (SELECT visit_id FROM reports WHERE id = $1)", [reportId]);
      const result = await client.query('UPDATE reports SET status = $2 WHERE id = $1 RETURNING id', [reportId, action === 'hide' ? 'reviewed' : 'dismissed']);
      await client.query('COMMIT');
      return Boolean(result.rowCount);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const report = [...localReports.values()].find((item) => item.id === reportId);
  if (!report) return false;
  report.status = action === 'hide' ? 'reviewed' : 'dismissed';
  if (action === 'hide') {
    const visit = localVisits.get(report.visitId);
    if (visit) visit.visibility = 'hidden';
  }
  return true;
}
