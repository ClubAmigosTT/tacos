import { Pool } from 'pg';
import bcrypt from 'bcryptjs';
import { createHash } from 'node:crypto';
import { lists as fixtureLists, places, type ApiList, type ApiListDetail, type ApiPhoto, type ApiPlace, type ApiTaqueria, type CategoryRatings, type FlavorProfile, type RatingBreakdown, type RatingCategory, type TasteProfile } from './data.js';
import { isOpenNow } from './hours.js';

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
if (process.env.NODE_ENV === 'production' && !configuredDatabaseUrl) {
  throw new Error('DATABASE_URL is required in production');
}

const pool = configuredDatabaseUrl
  ? new Pool({ connectionString: configuredDatabaseUrl, max: 10, connectionTimeoutMillis: 5_000, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined })
  : null;
const allowDemoCatalog = process.env.ALLOW_DEMO_CATALOG?.trim().toLowerCase() === 'true' || process.env.NODE_ENV === 'test';
const demoPlaceIds = new Set(places.map((place) => place.id));

function localCatalogPlaces() {
  return allowDemoCatalog ? places : places.filter((place) => !demoPlaceIds.has(place.id));
}

type DiscoverQuery = { q?: string; lat?: number; lng?: number; radiusKm?: number; offset?: number; openNow?: boolean; limit: number };
type VisitInput = { placeId: string; tacoIds: string[]; rating: number; tacoRatings?: Record<string, number>; categoryRatings?: CategoryRatings; price?: number; note?: string; photoUrl?: string; latitude?: number; longitude?: number };
type ReportInput = { visitId: string; reason: 'spam' | 'inappropriate' | 'wrong_place' | 'other'; details?: string };
export type PublicUser = { id: string; email: string; displayName: string; role: 'user' | 'admin'; following?: boolean; emailVerified?: boolean };
export type AdminReport = { id: string; visitId: string; reason: ReportInput['reason']; details: string; status: 'open' | 'reviewed' | 'dismissed'; createdAt: string; reporter: { id: string; displayName: string }; author: { id: string; displayName: string }; place: { id: string; name: string }; rating: number; visitedAt: string };
export type BranchPhotoStatus = 'pending' | 'approved' | 'rejected' | 'removed';
export type BranchPhotoSourceType = 'catalog' | 'community' | 'owner';
export type AdminBranchPhoto = {
  id: string;
  branchId: string;
  url: string;
  sourceUrl?: string;
  license: string;
  attribution: string;
  sourceType: BranchPhotoSourceType;
  status: BranchPhotoStatus;
  isPrimary: boolean;
  moderationNote: string;
  createdAt: string;
  updatedAt: string;
  uploader?: { id: string; displayName: string };
  place: { id: string; name: string; neighborhood: string };
};

type LocalUser = PublicUser & { passwordHash: string; shareActivity: boolean; emailVerifiedAt?: string };
const localUsers = new Map<string, LocalUser>();
const localSessions = new Map<string, { id: string; userId: string; tokenHash: string; createdAt: string; expiresAt: string; revokedAt?: string; userAgent?: string; ip?: string }>();
const localVerificationTokens = new Map<string, { userId: string; tokenHash: string; expiresAt: string }>();
const localPasswordResetTokens = new Map<string, { userId: string; tokenHash: string; expiresAt: string }>();
const localAuthRateLimits = new Map<string, { windowStartedAt: number; attempts: number }>();
const localVisits = new Map<string, { userId: string; placeId: string; tacoIds: string[]; tacoRatings?: Record<string, number>; categoryRatings?: CategoryRatings; rating: number; price?: number; note?: string; photoUrl?: string; latitude?: number; longitude?: number; createdAt: string; visibility: 'visible' | 'hidden' }>();
const localFollows = new Set<string>();
const localSavedPlaces = new Set<string>();
const localLists = new Map<string, { id: string; ownerId: string; title: string; description: string; visibility: 'public' | 'private'; coverImage: string; placeIds: string[]; createdAt: string }>();
const localReports = new Map<string, { id: string; reporterId: string; visitId: string; reason: ReportInput['reason']; details: string; status: 'open' | 'reviewed' | 'dismissed'; createdAt: string }>();
const localComments = new Map<string, { id: string; visitId: string; authorId: string; body: string; createdAt: string; visibility: 'visible' | 'hidden' }>();
const localListCollaborators = new Map<string, { listId: string; userId: string; role: 'editor' | 'viewer'; createdAt: string }>();
const localProductEvents: Array<{ eventName: string; userId?: string; anonymousId?: string; properties: Record<string, string | number | boolean | null>; createdAt: string }> = [];
const localCatalogProposals = new Map<string, { id: string; proposerId: string; kind: CatalogProposalKind; branchId?: string; payload: Record<string, unknown>; evidenceUrl?: string; status: CatalogProposalStatus; reviewNote: string; reviewedBy?: string; createdAt: string; updatedAt: string }>();
const localBranchPhotos = new Map<string, {
  id: string;
  branchId: string;
  url: string;
  sourceUrl?: string;
  license: string;
  attribution: string;
  sourceType: 'catalog' | 'community' | 'owner';
  status: 'pending' | 'approved' | 'rejected' | 'removed';
  uploadedBy?: string;
  uploaderName?: string;
  isPrimary: boolean;
  moderationNote: string;
  createdAt: string;
  updatedAt: string;
}>();

export type CatalogProposalKind = 'branch' | 'menu_item' | 'correction';
export type CatalogProposalStatus = 'pending' | 'approved' | 'rejected';
export type CatalogProposal = {
  id: string;
  kind: CatalogProposalKind;
  branchId?: string;
  payload: Record<string, unknown>;
  evidenceUrl?: string;
  status: CatalogProposalStatus;
  reviewNote: string;
  createdAt: string;
  updatedAt: string;
  proposer?: { id: string; displayName: string };
  reviewer?: { id: string; displayName: string };
};

function sha256(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

function authWindow(now = Date.now()) {
  return Math.floor(now / (15 * 60 * 1000)) * 15 * 60 * 1000;
}

export type AuthSession = { id: string; userId: string; createdAt: string; expiresAt: string; revokedAt?: string; userAgent?: string; ip?: string };

export async function createSession(userId: string, metadata: { userAgent?: string; ip?: string } = {}): Promise<AuthSession> {
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  if (pool) {
    const result = await pool.query(`
      INSERT INTO auth_sessions (id, user_id, token_hash, expires_at, user_agent, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id, user_id, created_at, expires_at, revoked_at, user_agent, ip_address
    `, [id, userId, sha256(id), expiresAt, metadata.userAgent ?? null, metadata.ip ?? null]);
    const row = result.rows[0];
    return { id: row.id, userId: row.user_id, createdAt: row.created_at.toISOString?.() ?? row.created_at, expiresAt: row.expires_at.toISOString?.() ?? row.expires_at, revokedAt: row.revoked_at?.toISOString?.() ?? row.revoked_at, userAgent: row.user_agent, ip: row.ip_address };
  }
  const session = { id, userId, tokenHash: sha256(id), createdAt, expiresAt, userAgent: metadata.userAgent, ip: metadata.ip };
  localSessions.set(id, session);
  return session;
}

export async function isSessionActive(sessionId: string, userId: string) {
  if (pool) {
    const result = await pool.query(`SELECT 1 FROM auth_sessions WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL AND expires_at > now()`, [sessionId, userId]);
    return Boolean(result.rowCount);
  }
  const session = localSessions.get(sessionId);
  return Boolean(session && session.userId === userId && !session.revokedAt && Date.parse(session.expiresAt) > Date.now());
}

export async function revokeSession(sessionId: string, userId: string) {
  if (pool) {
    const result = await pool.query(`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL`, [sessionId, userId]);
    return Boolean(result.rowCount);
  }
  const session = localSessions.get(sessionId);
  if (!session || session.userId !== userId) return false;
  session.revokedAt = new Date().toISOString();
  return true;
}

export async function revokeAllSessions(userId: string, exceptSessionId?: string) {
  if (pool) {
    const result = await pool.query(`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, now()) WHERE user_id = $1 AND revoked_at IS NULL ${exceptSessionId ? 'AND id <> $2' : ''}`, exceptSessionId ? [userId, exceptSessionId] : [userId]);
    return result.rowCount ?? 0;
  }
  let count = 0;
  for (const session of localSessions.values()) {
    if (session.userId === userId && session.id !== exceptSessionId && !session.revokedAt) { session.revokedAt = new Date().toISOString(); count += 1; }
  }
  return count;
}

export async function listSessions(userId: string): Promise<AuthSession[]> {
  if (pool) {
    const result = await pool.query(`SELECT id, user_id, created_at, expires_at, revoked_at, user_agent, ip_address FROM auth_sessions WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now() ORDER BY created_at DESC`, [userId]);
    return result.rows.map((row) => ({ id: row.id, userId: row.user_id, createdAt: row.created_at.toISOString?.() ?? row.created_at, expiresAt: row.expires_at.toISOString?.() ?? row.expires_at, revokedAt: row.revoked_at?.toISOString?.() ?? row.revoked_at, userAgent: row.user_agent, ip: row.ip_address }));
  }
  return [...localSessions.values()].filter((session) => session.userId === userId && !session.revokedAt && Date.parse(session.expiresAt) > Date.now()).map(({ tokenHash: _tokenHash, ...session }) => session);
}

export async function consumeAuthRateLimit(key: string, limit = 10): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const windowMs = 15 * 60 * 1000;
  if (pool) {
    const result = await pool.query(`
      INSERT INTO auth_rate_limits (key, window_started_at, attempts)
      VALUES ($1, now(), 1)
      ON CONFLICT (key) DO UPDATE SET
        attempts = CASE WHEN auth_rate_limits.window_started_at <= now() - interval '15 minutes' THEN 1 ELSE auth_rate_limits.attempts + 1 END,
        window_started_at = CASE WHEN auth_rate_limits.window_started_at <= now() - interval '15 minutes' THEN now() ELSE auth_rate_limits.window_started_at END,
        updated_at = now()
      RETURNING attempts, EXTRACT(EPOCH FROM (window_started_at + interval '15 minutes' - now()))::int AS retry_after
    `, [key]);
    const row = result.rows[0];
    return { allowed: Number(row.attempts) <= limit, retryAfterSeconds: Math.max(1, Number(row.retry_after ?? 900)) };
  }
  const now = Date.now();
  const current = localAuthRateLimits.get(key);
  if (!current || now - current.windowStartedAt >= windowMs) {
    localAuthRateLimits.set(key, { windowStartedAt: authWindow(now), attempts: 1 });
    return { allowed: true, retryAfterSeconds: 900 };
  }
  current.attempts += 1;
  return { allowed: current.attempts <= limit, retryAfterSeconds: Math.max(1, Math.ceil((current.windowStartedAt + windowMs - now) / 1000)) };
}

const configuredAdminEmails = new Set((process.env.ADMIN_EMAILS ?? '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));

const defaultTaste: TasteProfile = {
  title: 'Tu gusto se está formando',
  description: 'Registra algunas visitas para descubrir tu perfil de sabor.',
  tags: ['SIN DATOS', 'EXPLORA', 'REGISTRA'],
  profile: { intensity: 50, spicy: 50, traditional: 50, texture: 50, value: 50 },
  hasData: false
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
    try {
      await pool.query("DELETE FROM auth_rate_limits WHERE updated_at < now() - interval '2 days'");
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
  return { id: user.id, email: user.email, displayName: user.displayName, role: user.role, emailVerified: Boolean(user.emailVerifiedAt) };
}

const ratingCategoryColumns: Record<RatingCategory, string> = {
  tortilla: 'tortilla_rating',
  service: 'service_rating',
  price: 'price_rating',
  meat: 'meat_rating',
  salsas: 'salsas_rating'
};
const ratingCategoryKeys = Object.keys(ratingCategoryColumns) as RatingCategory[];

function nullableNumber(value: unknown) {
  return value == null ? null : Number(value);
}

function normalizeRatingBreakdown(value: any): RatingBreakdown | undefined {
  if (!value) return undefined;
  return {
    tortilla: nullableNumber(value.tortilla),
    service: nullableNumber(value.service),
    price: nullableNumber(value.price),
    meat: nullableNumber(value.meat),
    salsas: nullableNumber(value.salsas)
  };
}

function normalizePlace(row: any): ApiPlace {
  const fallbackProfile: FlavorProfile = places.find((place) => place.id === row.id)?.flavorProfile ?? { intensity: 50, spicy: 50, traditional: 50, texture: 50, value: 50 };
  return {
    id: row.id,
    taqueriaId: row.taqueria_id ?? row.id,
    taqueriaName: row.taqueria_name ?? row.name,
    name: row.name,
    neighborhood: row.neighborhood,
    address: row.address ?? undefined,
    phone: row.phone ?? undefined,
    weeklyHours: row.weekly_hours && Object.keys(row.weekly_hours).length ? row.weekly_hours : undefined,
    hoursKnown: row.source_name && row.source_name !== 'demo' ? Boolean(row.weekly_hours && Object.keys(row.weekly_hours).length) : undefined,
    priceMin: row.price_min == null ? undefined : Number(row.price_min),
    priceMax: row.price_max == null ? undefined : Number(row.price_max),
    source: row.source_name ? { name: row.source_name, url: row.source_url ?? undefined, license: row.source_license ?? row.image_license ?? undefined, attribution: row.source_attribution ?? row.image_attribution ?? undefined, updatedAt: row.source_updated_at?.toISOString?.() ?? row.source_updated_at ?? undefined } : undefined,
    catalogStatus: row.catalog_status === 'needs_review' ? 'needs_review' : 'active',
    distance: row.distance_km == null ? 'cerca de ti' : `${Number(row.distance_km).toFixed(1)} km`,
    openUntil: row.open_until ?? '23:00',
    rating: Number(row.rating),
    reviewCount: row.review_count == null ? undefined : Number(row.review_count),
    ratingBreakdown: normalizeRatingBreakdown(row.rating_breakdown),
    match: row.match_score == null ? undefined : Number(row.match_score),
    style: row.style,
    coordinates: { latitude: Number(row.latitude), longitude: Number(row.longitude) },
    image: row.image_url,
    description: row.description,
    tags: row.tags ?? [],
    flavorProfile: { ...fallbackProfile, ...(row.flavor_profile ?? {}) },
    tacos: (row.tacos ?? []).map((taco: any) => ({ id: taco.id, name: taco.name, rating: Number(taco.rating), price: Number(taco.price), note: taco.note })),
    photos: row.photos ?? undefined
  };
}

const effectiveBranchImageSql = `COALESCE(NULLIF(b.image_url, ''), (
  SELECT bp.url
  FROM branch_photos bp
  WHERE bp.branch_id = b.id AND bp.status = 'approved'
  ORDER BY bp.is_primary DESC, bp.created_at ASC
  LIMIT 1
))`;

async function getBranchPhotos(branchId: string): Promise<ApiPhoto[]> {
  if (pool) {
    const result = await pool.query(`
      SELECT url, source_url, license, attribution, source_type
      FROM branch_photos
      WHERE branch_id = $1 AND status = 'approved'
      ORDER BY is_primary DESC, created_at ASC
    `, [branchId]);
    return result.rows.map((row) => ({
      url: row.url,
      sourceUrl: row.source_url ?? undefined,
      license: row.license,
      attribution: row.attribution,
      source: row.source_type === 'owner' ? 'owner' : row.source_type === 'community' ? 'community' : 'catalog'
    }));
  }
  return [...localBranchPhotos.values()]
    .filter((photo) => photo.branchId === branchId && photo.status === 'approved')
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.createdAt.localeCompare(b.createdAt))
    .map((photo) => ({ url: photo.url, sourceUrl: photo.sourceUrl, license: photo.license, attribution: photo.attribution, source: photo.sourceType }));
}

function branchPhotoDate(value: unknown) {
  return value && typeof (value as { toISOString?: unknown }).toISOString === 'function'
    ? (value as { toISOString: () => string }).toISOString()
    : String(value ?? '');
}

function adminBranchPhotoFromRow(row: any): AdminBranchPhoto {
  return {
    id: row.id,
    branchId: row.branch_id,
    url: row.url,
    sourceUrl: row.source_url ?? undefined,
    license: row.license,
    attribution: row.attribution,
    sourceType: row.source_type,
    status: row.status,
    isPrimary: Boolean(row.is_primary),
    moderationNote: row.moderation_note ?? '',
    createdAt: branchPhotoDate(row.created_at),
    updatedAt: branchPhotoDate(row.updated_at),
    uploader: row.uploader_id ? { id: row.uploader_id, displayName: row.uploader_name ?? 'Cuenta eliminada' } : undefined,
    place: { id: row.place_id, name: row.place_name, neighborhood: row.neighborhood }
  };
}

export async function createBranchPhotoForUser(input: {
  branchId: string;
  url: string;
  sourceType: 'community' | 'owner';
  consentGranted: true;
}, userId: string, displayName: string): Promise<'not_found' | 'branch_limit' | 'rate_limited' | AdminBranchPhoto> {
  const attribution = input.sourceType === 'owner'
    ? `Foto enviada por el negocio · ${displayName}`
    : `Foto subida por ${displayName}`;
  const license = 'Autorización del remitente';

  if (pool) {
    const branch = await pool.query(`
      SELECT id FROM branches
      WHERE id = $1 AND is_active = true AND catalog_status IN ('active', 'needs_review')
        ${allowDemoCatalog ? '' : "AND COALESCE(source_name, '') <> 'demo'"}
    `, [input.branchId]);
    if (!branch.rowCount) return 'not_found';
    const [branchCount, userCount] = await Promise.all([
      pool.query("SELECT COUNT(*)::int AS count FROM branch_photos WHERE branch_id = $1 AND status IN ('pending', 'approved')", [input.branchId]),
      pool.query("SELECT COUNT(*)::int AS count FROM branch_photos WHERE uploaded_by = $1 AND created_at > now() - interval '24 hours' AND status <> 'removed'", [userId])
    ]);
    if (Number(branchCount.rows[0]?.count ?? 0) >= 20) return 'branch_limit';
    if (Number(userCount.rows[0]?.count ?? 0) >= 10) return 'rate_limited';
    const result = await pool.query(`
      INSERT INTO branch_photos (
        id, branch_id, url, source_url, license, attribution, source_type,
        status, uploaded_by, consent_granted, is_primary
      )
      VALUES ($1, $2, $3, NULL, $4, $5, $6, 'pending', $7, true, false)
      RETURNING id, branch_id, url, source_url, license, attribution, source_type,
        status, is_primary, moderation_note, created_at, updated_at
    `, [crypto.randomUUID(), input.branchId, input.url, license, attribution, input.sourceType, userId]);
    return adminBranchPhotoFromRow({
      ...result.rows[0],
      place_id: input.branchId,
      place_name: 'Sucursal',
      neighborhood: '',
      uploader_id: userId,
      uploader_name: displayName
    });
  }

  const place = localCatalogPlaces().find((item) => item.id === input.branchId);
  if (!place) return 'not_found';
  const activePhotos = [...localBranchPhotos.values()].filter((photo) => photo.branchId === input.branchId && ['pending', 'approved'].includes(photo.status));
  if (activePhotos.length >= 20) return 'branch_limit';
  const recentUserPhotos = [...localBranchPhotos.values()].filter((photo) => photo.uploadedBy === userId && photo.status !== 'removed' && Date.parse(photo.createdAt) > Date.now() - 24 * 60 * 60 * 1000);
  if (recentUserPhotos.length >= 10) return 'rate_limited';
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const photo = { id, branchId: input.branchId, url: input.url, license, attribution, sourceType: input.sourceType, status: 'pending' as const, uploadedBy: userId, uploaderName: displayName, isPrimary: false, moderationNote: '', createdAt: now, updatedAt: now };
  localBranchPhotos.set(id, photo);
  return { id, branchId: photo.branchId, url: photo.url, license: photo.license, attribution: photo.attribution, sourceType: photo.sourceType, status: photo.status, isPrimary: false, moderationNote: '', createdAt: now, updatedAt: now, uploader: { id: userId, displayName }, place: { id: place.id, name: place.name, neighborhood: place.neighborhood } };
}

export async function getAdminBranchPhotos(status: BranchPhotoStatus | 'all' = 'pending'): Promise<AdminBranchPhoto[]> {
  if (pool) {
    const result = await pool.query(`
      SELECT p.id, p.branch_id, p.url, p.source_url, p.license, p.attribution,
        p.source_type, p.status, p.is_primary, p.moderation_note,
        p.created_at, p.updated_at,
        u.id AS uploader_id, u.display_name AS uploader_name,
        b.id AS place_id, b.name AS place_name, b.neighborhood
      FROM branch_photos p
      JOIN branches b ON b.id = p.branch_id
      LEFT JOIN users u ON u.id = p.uploaded_by
      ${status === 'all' ? '' : 'WHERE p.status = $1'}
      ORDER BY p.created_at DESC
      LIMIT 100
    `, status === 'all' ? [] : [status]);
    return result.rows.map(adminBranchPhotoFromRow);
  }
  return [...localBranchPhotos.values()]
    .filter((photo) => status === 'all' || photo.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((photo) => {
      const place = localCatalogPlaces().find((item) => item.id === photo.branchId);
      return {
        id: photo.id,
        branchId: photo.branchId,
        url: photo.url,
        sourceUrl: photo.sourceUrl,
        license: photo.license,
        attribution: photo.attribution,
        sourceType: photo.sourceType,
        status: photo.status,
        isPrimary: photo.isPrimary,
        moderationNote: photo.moderationNote,
        createdAt: photo.createdAt,
        updatedAt: photo.updatedAt,
        uploader: photo.uploadedBy ? { id: photo.uploadedBy, displayName: photo.uploaderName ?? 'Cuenta eliminada' } : undefined,
        place: { id: photo.branchId, name: place?.name ?? 'Lugar desconocido', neighborhood: place?.neighborhood ?? '' }
      } satisfies AdminBranchPhoto;
    });
}

export async function reviewBranchPhoto(photoId: string, action: 'approve' | 'reject', reviewerId: string, moderationNote = '') {
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query("SELECT id, branch_id FROM branch_photos WHERE id = $1 AND status = 'pending' FOR UPDATE", [photoId]);
      if (!current.rowCount) {
        await client.query('ROLLBACK');
        return false;
      }
      const branchId = current.rows[0].branch_id;
      if (action === 'approve') {
        const primary = await client.query("SELECT id FROM branch_photos WHERE branch_id = $1 AND status = 'approved' AND is_primary = true LIMIT 1", [branchId]);
        await client.query(`
          UPDATE branch_photos
          SET status = 'approved',
              is_primary = $2,
              moderation_note = $3,
              moderated_by = $4,
              moderated_at = now(),
              updated_at = now()
          WHERE id = $1
        `, [photoId, !primary.rowCount, moderationNote.trim(), reviewerId]);
      } else {
        await client.query(`
          UPDATE branch_photos
          SET status = 'rejected', is_primary = false, moderation_note = $2,
              moderated_by = $3, moderated_at = now(), updated_at = now()
          WHERE id = $1
        `, [photoId, moderationNote.trim(), reviewerId]);
      }
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const photo = localBranchPhotos.get(photoId);
  if (!photo || photo.status !== 'pending') return false;
  photo.status = action === 'approve' ? 'approved' : 'rejected';
  photo.moderationNote = moderationNote.trim();
  photo.isPrimary = action === 'approve' && ![...localBranchPhotos.values()].some((item) => item.branchId === photo.branchId && item.id !== photo.id && item.status === 'approved' && item.isPrimary);
  photo.updatedAt = new Date().toISOString();
  return true;
}

export async function deleteBranchPhotoForUser(photoId: string, branchId: string, userId: string, isAdmin = false) {
  if (pool) {
    const result = await pool.query(`
      UPDATE branch_photos
      SET status = 'removed', is_primary = false, removed_at = now(), updated_at = now()
      WHERE id = $1 AND branch_id = $2 AND ($3::boolean OR uploaded_by = $4) AND status <> 'removed'
      RETURNING id
    `, [photoId, branchId, isAdmin, userId]);
    return Boolean(result.rowCount);
  }
  const photo = localBranchPhotos.get(photoId);
  if (!photo || photo.branchId !== branchId || (!isAdmin && photo.uploadedBy !== userId) || photo.status === 'removed') return false;
  photo.status = 'removed';
  photo.isPrimary = false;
  photo.updatedAt = new Date().toISOString();
  return true;
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

function searchTerms(value: string) {
  return normalizeSearchText(value).split(/[^a-z0-9]+/).filter((term) => term.length >= 2);
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
              (((stats.effective_count * ((stats.average_rating * 0.65) + (stats.recent_rating * 0.35))) + (10 * COALESCE(NULLIF(b.rating, 0), 4.2))) / (stats.effective_count + 10))
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
              NULLIF(b.rating, 0),
              4.2
            ) AS recent_rating,
            GREATEST(1::numeric, LEAST(COUNT(*)::numeric, GREATEST(1::numeric, COUNT(DISTINCT v.user_id)::numeric * 3))) AS effective_count
          FROM visits v
          WHERE v.branch_id = b.id AND v.visibility = 'visible' AND v.rating > 0
        ) stats
      ) reviews ON true`;

const reputationSelect = `
      CASE WHEN COALESCE(reviews.review_count, 0) = 0 THEN b.rating ELSE reviews.score END AS rating,
      COALESCE(reviews.review_count, 0)::int AS review_count,`;

const categoryRatingsJoin = `
      LEFT JOIN LATERAL (
        SELECT
          AVG(NULLIF(v.tortilla_rating, 0))::numeric AS tortilla,
          AVG(NULLIF(v.service_rating, 0))::numeric AS service,
          AVG(NULLIF(v.price_rating, 0))::numeric AS price,
          AVG(NULLIF(v.meat_rating, 0))::numeric AS meat,
          AVG(NULLIF(v.salsas_rating, 0))::numeric AS salsas
        FROM visits v
        WHERE v.branch_id = b.id AND v.visibility = 'visible'
      ) category_ratings ON true`;

const categoryRatingsSelect = `
      json_build_object(
        'tortilla', category_ratings.tortilla,
        'service', category_ratings.service,
        'price', category_ratings.price,
        'meat', category_ratings.meat,
        'salsas', category_ratings.salsas
      ) AS rating_breakdown,`;

const tacoReputationSelect = `(
        SELECT CASE WHEN stats.review_count = 0 THEN m.rating
          ELSE LEAST(5::numeric, GREATEST(1::numeric,
            (((stats.effective_count * ((stats.average_rating * 0.65) + (stats.recent_rating * 0.35))) + (5 * COALESCE(NULLIF(m.rating, 0), 4.2))) / (stats.effective_count + 5))
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
              NULLIF(m.rating, 0),
              4.2
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
  const priorMean = fallback > 0 ? Math.max(1, Math.min(5, fallback)) : 4.2;
  return Math.max(1, Math.min(5,
    ((effectiveCount * (average * 0.65 + recent * 0.35)) + (priorStrength * priorMean)) / (effectiveCount + priorStrength)
      - Math.min(0.25, dispersion * 0.08)
      + Math.min(0.08, Math.max(0, recent - average) * 0.12)
  ));
}

function localReputation(place: ApiPlace): ApiPlace {
  const visits = [...localVisits.values()].filter((visit) => visit.placeId === place.id && visit.visibility === 'visible');
  const reviews = visits.filter((visit) => visit.rating > 0).map((visit) => ({ rating: visit.rating, userId: visit.userId, createdAt: visit.createdAt }));
  const tacos = place.tacos.map((taco) => {
    const tacoReviews = visits.flatMap((visit) => {
      const rating = visit.tacoRatings?.[taco.id];
      return rating == null ? [] : [{ rating, userId: visit.userId, createdAt: visit.createdAt }];
    });
    return { ...taco, rating: Number(localRobustScore(tacoReviews, 5, taco.rating).toFixed(2)) };
  });
  const ratingBreakdown = Object.fromEntries(ratingCategoryKeys.map((key) => {
    const ratings = visits.map((visit) => visit.categoryRatings?.[key]).filter((value): value is number => typeof value === 'number' && value > 0);
    return [key, ratings.length ? Number((ratings.reduce((sum, value) => sum + value, 0) / ratings.length).toFixed(2)) : null];
  })) as RatingBreakdown;
  const hasRatingBreakdown = ratingCategoryKeys.some((key) => ratingBreakdown[key] != null);
  return {
    ...place,
    rating: Number(localRobustScore(reviews, 10, place.rating).toFixed(2)),
    tacos,
    ...(reviews.length ? { reviewCount: reviews.length } : {}),
    ...(hasRatingBreakdown ? { ratingBreakdown } : {})
  };
}

function withoutPersonalMatch(place: ApiPlace): ApiPlace {
  const { match: _match, ...catalogPlace } = place;
  return catalogPlace;
}

export async function discoverPlaces(query: DiscoverQuery, userId?: string): Promise<ApiPlace[]> {
  const limit = Math.min(Math.max(Math.trunc(query.limit), 1), 50);
  const offset = Math.max(0, Math.trunc(query.offset ?? 0));
  let discovered: ApiPlace[];
  if (!pool) {
    const localCatalog = localCatalogPlaces();
    const terms = query.q?.trim() ? searchTerms(query.q.trim()) : [];
    let filtered = query.q?.trim()
      ? localCatalog.filter((place) => {
        const haystack = normalizeSearchText(`${place.name} ${place.neighborhood} ${place.style} ${place.tags.join(' ')} ${place.tacos.map((taco) => taco.name).join(' ')}`);
        return terms.length > 0 && terms.every((term) => haystack.includes(term));
      })
      : localCatalog;
    if (query.lat != null && query.lng != null && query.radiusKm != null) {
      filtered = filtered.filter((place) => haversineKm({ latitude: query.lat!, longitude: query.lng! }, place.coordinates) <= query.radiusKm!);
    }
    const scored = filtered.map(localReputation).filter((place) => !query.openNow || isOpenNow(place.openUntil, new Date(), place.weeklyHours, place.hoursKnown));
    const ordered = query.lat == null || query.lng == null ? scored
      .sort((a, b) => (b.rating - a.rating)) : scored
      .map((place) => ({ ...place, distance: `${haversineKm({ latitude: query.lat!, longitude: query.lng! }, place.coordinates).toFixed(1)} km` }))
      .sort((a, b) => Number.parseFloat(a.distance) - Number.parseFloat(b.distance))
    discovered = ordered.slice(offset, offset + limit);
  } else {
    const values: unknown[] = [];
    const predicates: string[] = ["b.is_active = true", "b.catalog_status IN ('active', 'needs_review')"];
    if (!allowDemoCatalog) predicates.push("COALESCE(b.source_name, '') <> 'demo'");
    if (query.q?.trim()) {
      const terms = searchTerms(query.q.trim());
      if (!terms.length) predicates.push('false');
      for (const term of terms) {
        values.push(`%${term}%`);
        predicates.push(`(unaccent(b.name) ILIKE unaccent($${values.length}) OR unaccent(b.neighborhood) ILIKE unaccent($${values.length}) OR unaccent(b.search_text) ILIKE unaccent($${values.length}) OR EXISTS (SELECT 1 FROM menu_items search_menu WHERE search_menu.branch_id = b.id AND search_menu.is_active = true AND unaccent(search_menu.name) ILIKE unaccent($${values.length})))`);
      }
    }
    let distanceSelect = 'NULL::numeric AS distance_km';
    if (query.lat != null && query.lng != null) {
      const longitudeParam = values.length + 1;
      const latitudeParam = values.length + 2;
      values.push(query.lng, query.lat);
      distanceSelect = `ST_Distance(b.location, ST_SetSRID(ST_MakePoint($${longitudeParam}, $${latitudeParam}), 4326)::geography) / 1000 AS distance_km`;
      if (query.radiusKm != null) {
        const radiusParam = values.length + 1;
        values.push(query.radiusKm * 1000);
        predicates.push(`ST_DWithin(b.location, ST_SetSRID(ST_MakePoint($${longitudeParam}, $${latitudeParam}), 4326)::geography, $${radiusParam})`);
      }
    }
    const fetchLimit = query.openNow ? Math.min(500, Math.max(limit + offset, limit) * 3) : limit;
    const limitParam = values.length + 1;
    values.push(fetchLimit);
    const offsetSql = query.openNow || offset === 0 ? '' : (() => {
      const offsetParam = values.length + 1;
      values.push(offset);
      return ` OFFSET $${offsetParam}`;
    })();
    // Keep offset pagination stable when catalog rows share the same rating.
    // Without a deterministic tie-breaker, PostgreSQL may repeat or skip rows
    // between pages, which is especially visible in a new catalog with no
    // user reviews yet.
    const orderBy = query.lat != null && query.lng != null ? 'distance_km ASC NULLS LAST, rating DESC, b.id ASC' : 'rating DESC, b.id ASC';
    const result = await pool.query(`
      SELECT b.id, b.taqueria_id, t.name AS taqueria_name, b.name, b.neighborhood, b.address, b.phone, b.weekly_hours, b.price_min, b.price_max, b.source_name, b.source_url, b.source_license, b.source_attribution, b.source_updated_at, b.image_license, b.image_attribution, b.open_until,
      ${reputationSelect}
      ${categoryRatingsSelect}
      b.match_score, b.catalog_status, b.style,
      ${effectiveBranchImageSql} AS image_url, b.description, b.tags, b.flavor_profile, ST_Y(b.location::geometry) AS latitude,
      ST_X(b.location::geometry) AS longitude, ${distanceSelect},
      COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name, 'rating', COALESCE((
        ${tacoReputationSelect}
      ), m.rating),
        'price', m.price, 'note', m.note)) FILTER (WHERE m.id IS NOT NULL), '[]') AS tacos
    FROM branches b JOIN taquerias t ON t.id = b.taqueria_id
      ${reputationJoin}
      ${categoryRatingsJoin}
      LEFT JOIN menu_items m ON m.branch_id = b.id AND m.is_active = true
    WHERE ${predicates.join(' AND ')}
    GROUP BY b.id, t.name, reviews.review_count, reviews.score, category_ratings.tortilla, category_ratings.service, category_ratings.price, category_ratings.meat, category_ratings.salsas ORDER BY ${orderBy} LIMIT $${limitParam}${offsetSql}
    `, values);
    discovered = result.rows.map(normalizePlace);
    if (query.openNow) discovered = discovered.filter((place) => isOpenNow(place.openUntil, new Date(), place.weeklyHours, place.hoursKnown)).slice(offset, offset + limit);
  }
  if (!userId || !discovered.length) return allowDemoCatalog ? discovered : discovered.map(withoutPersonalMatch);
  // Keep discovery's geographic/textual result set intact while replacing
  // only the affinity fields with the same recommendation model used by the
  // home screen. No social or private profile data is returned here.
  const personalized = await getRecommendations(userId);
  const scores = new Map(personalized.map((place) => [place.id, place]));
  return discovered.map((place) => {
    const catalogPlace = withoutPersonalMatch(place);
    const match = scores.get(place.id);
    return match ? { ...catalogPlace, match: match.match, tasteMatch: match.tasteMatch, socialMatch: match.socialMatch, friendCount: match.friendCount } : catalogPlace;
  });
}

function tokenise(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').split(/[^a-z0-9]+/).filter((token) => token.length > 2);
}

export async function getRecommendations(userId?: string, location?: { latitude: number; longitude: number }): Promise<ApiPlace[]> {
  const candidates = await discoverPlaces({ limit: 50, lat: location?.latitude, lng: location?.longitude, radiusKm: location ? 20 : undefined });
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
        const place = localCatalogPlaces().find((item) => item.id === visit.placeId);
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
  if (!preferenceTokens.size && !socialSignals.size) return allowDemoCatalog ? candidates : candidates.map(withoutPersonalMatch);
  return candidates.map((place) => {
    const placeTokens = new Set(tokenise([place.name, place.style, ...place.tags, ...place.tacos.map((taco) => taco.name)].join(' ')));
    const overlap = [...placeTokens].filter((token) => preferenceTokens.has(token)).length;
    const tasteMatch = tasteSamples ? Math.max(0, Math.min(99, Math.round(100 - (Object.keys(tasteSums) as Array<keyof FlavorProfile>).reduce((sum, key) => sum + Math.abs(place.flavorProfile[key] - tasteSums[key] / tasteSamples), 0) / 5))) : undefined;
    const catalogMatch = place.match ?? (place.rating > 0 ? Math.round(place.rating * 20) : 50);
    const personalMatch = Math.min(99, Math.round(catalogMatch * 0.7 + (tasteMatch ?? catalogMatch) * 0.3 + Math.min(12, overlap * 3)));
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
    // AVG already returns the per-visit mean. Store that mean directly so it
    // is not divided by the visit count a second time below.
    if (visits) for (const key of Object.keys(sums) as Array<keyof FlavorProfile>) sums[key] = Number(row[key] ?? defaultTaste.profile[key]);
  } else {
    for (const visit of localVisits.values()) {
      if (visit.userId !== userId || visit.visibility !== 'visible') continue;
      const place = localCatalogPlaces().find((item) => item.id === visit.placeId);
      if (!place) continue;
      visits += 1;
      for (const key of Object.keys(sums) as Array<keyof FlavorProfile>) sums[key] += place.flavorProfile[key];
    }
  }
  if (!visits) return { ...defaultTaste, profile: { ...defaultTaste.profile }, tags: [...defaultTaste.tags] };
  const profile = Object.fromEntries((Object.keys(sums) as Array<keyof FlavorProfile>).map((key) => [key, Math.round(pool ? sums[key] : sums[key] / visits)])) as FlavorProfile;
  const title = profile.spicy >= 70 ? 'Pastor nocturno' : profile.value >= 80 ? 'Explorador de barrio' : profile.traditional >= 75 ? 'Clásico con criterio' : 'Curioso de la ciudad';
  const description = (profile.spicy >= 70 ? 'Picante alto' : 'Picante moderado') + ' · ' + (profile.value >= 75 ? 'precio sensible' : 'buscas equilibrio') + ' · ' + (profile.traditional >= 75 ? 'clásicos' : 'nuevos estilos');
  const tags = [Math.round(profile.traditional) + '% CLÁSICO', Math.round(profile.spicy) + '% PICANTE', Math.round(profile.value) + '% VALOR'];
  return { title, description, tags, profile, hasData: true };
}

export async function findPlace(id: string, userId?: string): Promise<ApiPlace | undefined> {
  const fallback = localCatalogPlaces().find((place) => place.id === id);
  let found: ApiPlace | undefined;
  if (!pool) {
    found = fallback ? localReputation(fallback) : fallback;
  } else {
    const result = await pool.query(`
    SELECT b.id, b.taqueria_id, t.name AS taqueria_name, b.name, b.neighborhood, b.address, b.phone, b.weekly_hours, b.price_min, b.price_max, b.source_name, b.source_url, b.source_license, b.source_attribution, b.source_updated_at, b.image_license, b.image_attribution, b.open_until,
      ${reputationSelect}
      ${categoryRatingsSelect}
      b.match_score, b.catalog_status, b.style,
      ${effectiveBranchImageSql} AS image_url, b.description, b.tags, b.flavor_profile, ST_Y(b.location::geometry) AS latitude,
      ST_X(b.location::geometry) AS longitude, NULL::numeric AS distance_km,
      COALESCE(json_agg(json_build_object('id', m.id, 'name', m.name, 'rating', COALESCE((
        ${tacoReputationSelect}
      ), m.rating),
        'price', m.price, 'note', m.note)) FILTER (WHERE m.id IS NOT NULL), '[]') AS tacos
    FROM branches b JOIN taquerias t ON t.id = b.taqueria_id
      ${reputationJoin}
      ${categoryRatingsJoin}
      LEFT JOIN menu_items m ON m.branch_id = b.id AND m.is_active = true
    WHERE b.id = $1 AND b.is_active = true AND b.catalog_status IN ('active', 'needs_review') ${allowDemoCatalog ? '' : "AND COALESCE(b.source_name, '') <> 'demo'"} GROUP BY b.id, t.name, reviews.review_count, reviews.score, category_ratings.tortilla, category_ratings.service, category_ratings.price, category_ratings.meat, category_ratings.salsas
    `, [id]);
    found = result.rows[0] ? normalizePlace(result.rows[0]) : undefined;
  }
  if (found) {
    const photos = await getBranchPhotos(id);
    if (photos.length) found = { ...found, photos, image: found.image || photos[0].url };
  }
  if (!found || !userId) return found && allowDemoCatalog ? found : found ? withoutPersonalMatch(found) : found;
  const personalized = await getRecommendations(userId);
  const match = personalized.find((place) => place.id === id);
  const catalogPlace = withoutPersonalMatch(found);
  return match ? { ...catalogPlace, match: match.match, tasteMatch: match.tasteMatch, socialMatch: match.socialMatch, friendCount: match.friendCount } : catalogPlace;
}

export type ApiBranchReview = {
  id: string;
  visitedAt: string;
  rating: number;
  categoryRatings: CategoryRatings;
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
    const branch = await pool.query(`SELECT 1 FROM branches WHERE id = $1 AND is_active = true AND catalog_status IN ('active', 'needs_review') ${allowDemoCatalog ? '' : "AND COALESCE(source_name, '') <> 'demo'"}`, [branchId]);
    if (!branch.rowCount) return undefined;
    const result = await pool.query(`
      SELECT v.id, v.visited_at, v.rating, v.tortilla_rating, v.service_rating, v.price_rating, v.meat_rating, v.salsas_rating, v.note, v.photo_url,
        u.id AS user_id, u.display_name,
        COALESCE(string_agg(m.name, ', ' ORDER BY m.name), '') AS tacos
      FROM visits v
      JOIN users u ON u.id = v.user_id AND u.is_active = true AND u.share_activity = true
      LEFT JOIN visit_items vi ON vi.visit_id = v.id
      LEFT JOIN menu_items m ON m.id = vi.menu_item_id
      WHERE v.branch_id = $1 AND v.visibility = 'visible'
      GROUP BY v.id, v.visited_at, v.rating, v.tortilla_rating, v.service_rating, v.price_rating, v.meat_rating, v.salsas_rating, v.note, v.photo_url, u.id, u.display_name
      ORDER BY v.visited_at DESC
      LIMIT 50
    `, [branchId]);
    return result.rows.map((row) => ({
      id: row.id,
      visitedAt: new Date(row.visited_at).toISOString(),
      rating: Number(row.rating),
      categoryRatings: {
        tortilla: nullableNumber(row.tortilla_rating),
        service: nullableNumber(row.service_rating),
        price: nullableNumber(row.price_rating),
        meat: nullableNumber(row.meat_rating),
        salsas: nullableNumber(row.salsas_rating)
      },
      note: row.note ?? '',
      photoUrl: row.photo_url ?? null,
      tacos: row.tacos ?? '',
      user: { id: row.user_id, displayName: row.display_name }
    }));
  }

  if (!localCatalogPlaces().some((place) => place.id === branchId)) return undefined;
  return [...localVisits.entries()]
    .filter(([, visit]) => visit.placeId === branchId && visit.visibility === 'visible' && localUsers.get(visit.userId)?.shareActivity !== false)
    .sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 50)
    .map(([id, visit]) => {
      const place = localCatalogPlaces().find((item) => item.id === visit.placeId);
      const tacos = visit.tacoIds.map((tacoId) => place?.tacos.find((taco) => taco.id === tacoId)?.name ?? tacoId).join(', ');
      const author = localUsers.get(visit.userId);
      return { id, visitedAt: visit.createdAt, rating: visit.rating, categoryRatings: visit.categoryRatings ?? {}, note: visit.note ?? '', photoUrl: visit.photoUrl ?? null, tacos, user: { id: visit.userId, displayName: author?.displayName ?? 'Cuenta eliminada' } };
    });
}

export async function getTaqueria(id: string): Promise<ApiTaqueria | undefined> {
  if (pool) {
      const parent = await pool.query(`
      SELECT t.id, t.name, t.slug, t.description, COUNT(b.id)::int AS branch_count
      FROM taquerias t LEFT JOIN branches b ON b.taqueria_id = t.id AND b.is_active = true AND b.catalog_status IN ('active', 'needs_review') ${allowDemoCatalog ? '' : "AND COALESCE(b.source_name, '') <> 'demo'"}
      WHERE t.id = $1 GROUP BY t.id
    `, [id]);
    if (!parent.rows[0]) return undefined;
    const branchRows = await pool.query(`SELECT id FROM branches WHERE taqueria_id = $1 AND is_active = true AND catalog_status IN ('active', 'needs_review') ${allowDemoCatalog ? '' : "AND COALESCE(source_name, '') <> 'demo'"} ORDER BY neighborhood, name`, [id]);
    const branches = (await Promise.all(branchRows.rows.map((row) => findPlace(row.id)))).filter((place): place is ApiPlace => Boolean(place));
    if (!branches.length) return undefined;
    return { id: parent.rows[0].id, name: parent.rows[0].name, slug: parent.rows[0].slug, description: parent.rows[0].description, branchCount: Number(parent.rows[0].branch_count), branches };
  }
  const branches = localCatalogPlaces().filter((place) => (place.taqueriaId ?? place.id) === id);
  if (!branches.length) return undefined;
  const first = branches[0];
  return { id, name: first.taqueriaName ?? first.name, slug: id, description: `${first.name} y sus sucursales.`, branchCount: branches.length, branches };
}

function normalizeCatalogProposal(row: any): CatalogProposal {
  const asIso = (value: any) => value?.toISOString?.() ?? value;
  return {
    id: row.id,
    kind: row.kind,
    branchId: row.branch_id ?? undefined,
    payload: row.payload ?? {},
    evidenceUrl: row.evidence_url ?? undefined,
    status: row.status,
    reviewNote: row.review_note ?? '',
    createdAt: asIso(row.created_at),
    updatedAt: asIso(row.updated_at),
    proposer: row.proposer_id ? { id: row.proposer_id, displayName: row.proposer_name ?? 'Cuenta eliminada' } : undefined,
    reviewer: row.reviewer_id ? { id: row.reviewer_id, displayName: row.reviewer_name ?? 'Cuenta eliminada' } : undefined
  };
}

async function getCatalogProposal(id: string): Promise<CatalogProposal | undefined> {
  if (pool) {
    const result = await pool.query(`
      SELECT p.id, p.kind, p.branch_id, p.payload, p.evidence_url, p.status, p.review_note, p.created_at, p.updated_at,
        proposer.id AS proposer_id, proposer.display_name AS proposer_name,
        reviewer.id AS reviewer_id, reviewer.display_name AS reviewer_name
      FROM catalog_proposals p
      LEFT JOIN users proposer ON proposer.id = p.proposer_id
      LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by
      WHERE p.id = $1
    `, [id]);
    return result.rows[0] ? normalizeCatalogProposal(result.rows[0]) : undefined;
  }
  const proposal = localCatalogProposals.get(id);
  if (!proposal) return undefined;
  const proposer = localUsers.get(proposal.proposerId);
  const reviewer = proposal.reviewedBy ? localUsers.get(proposal.reviewedBy) : undefined;
  return { id: proposal.id, kind: proposal.kind, branchId: proposal.branchId, payload: proposal.payload, evidenceUrl: proposal.evidenceUrl, status: proposal.status, reviewNote: proposal.reviewNote, createdAt: proposal.createdAt, updatedAt: proposal.updatedAt, proposer: proposer ? { id: proposer.id, displayName: proposer.displayName } : undefined, reviewer: reviewer ? { id: reviewer.id, displayName: reviewer.displayName } : undefined };
}

export async function createCatalogProposal(input: { kind: CatalogProposalKind; branchId?: string; payload: Record<string, unknown>; evidenceUrl?: string }, proposerId: string): Promise<CatalogProposal | undefined> {
  if (pool) {
    if (input.kind !== 'branch') {
      const branch = await pool.query(`SELECT 1 FROM branches WHERE id = $1 AND is_active = true AND catalog_status IN ('active', 'needs_review') ${allowDemoCatalog ? '' : "AND COALESCE(source_name, '') <> 'demo'"}`, [input.branchId ?? '']);
      if (!branch.rowCount) return undefined;
    }
    const id = crypto.randomUUID();
    await pool.query(`INSERT INTO catalog_proposals (id, proposer_id, kind, branch_id, payload, evidence_url) VALUES ($1, $2, $3, $4, $5::jsonb, $6)`, [id, proposerId, input.kind, input.branchId ?? null, JSON.stringify(input.payload), input.evidenceUrl ?? null]);
    return getCatalogProposal(id);
  }
  if (input.kind !== 'branch' && (!input.branchId || !localCatalogPlaces().some((place) => place.id === input.branchId))) return undefined;
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  localCatalogProposals.set(id, { id, proposerId, kind: input.kind, branchId: input.branchId, payload: input.payload, evidenceUrl: input.evidenceUrl, status: 'pending', reviewNote: '', createdAt: now, updatedAt: now });
  return getCatalogProposal(id);
}

export async function getCatalogProposals(status: CatalogProposalStatus | 'all' = 'pending'): Promise<CatalogProposal[]> {
  if (pool) {
    const result = await pool.query(`
      SELECT p.id, p.kind, p.branch_id, p.payload, p.evidence_url, p.status, p.review_note, p.created_at, p.updated_at,
        proposer.id AS proposer_id, proposer.display_name AS proposer_name,
        reviewer.id AS reviewer_id, reviewer.display_name AS reviewer_name
      FROM catalog_proposals p
      LEFT JOIN users proposer ON proposer.id = p.proposer_id
      LEFT JOIN users reviewer ON reviewer.id = p.reviewed_by
      ${status === 'all' ? '' : 'WHERE p.status = $1'}
      ORDER BY p.created_at DESC LIMIT 100
    `, status === 'all' ? [] : [status]);
    return result.rows.map(normalizeCatalogProposal);
  }
  return [...localCatalogProposals.values()]
    .filter((proposal) => status === 'all' || proposal.status === status)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((proposal) => {
      const proposer = localUsers.get(proposal.proposerId);
      const reviewer = proposal.reviewedBy ? localUsers.get(proposal.reviewedBy) : undefined;
      return { id: proposal.id, kind: proposal.kind, branchId: proposal.branchId, payload: proposal.payload, evidenceUrl: proposal.evidenceUrl, status: proposal.status, reviewNote: proposal.reviewNote, createdAt: proposal.createdAt, updatedAt: proposal.updatedAt, proposer: proposer ? { id: proposer.id, displayName: proposer.displayName } : undefined, reviewer: reviewer ? { id: reviewer.id, displayName: reviewer.displayName } : undefined };
    });
}

function proposalText(payload: Record<string, unknown>, key: string, fallback = '') {
  return typeof payload[key] === 'string' ? String(payload[key]).trim() : fallback;
}

function proposalNumber(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return value === undefined || value === null || value === '' ? undefined : Number(value);
}

const proposalDayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const;

function isProposalTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function isProposalWeeklyHours(value: unknown): value is Record<string, Array<{ open: string; close: string }>> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const hours = value as Record<string, unknown>;
  return proposalDayKeys.every((day) => {
    const intervals = hours[day];
    return Array.isArray(intervals) && intervals.every((interval) => {
      if (!interval || typeof interval !== 'object' || Array.isArray(interval)) return false;
      const entry = interval as Record<string, unknown>;
      return isProposalTime(entry.open) && isProposalTime(entry.close) && entry.open !== entry.close;
    });
  });
}

function isProposalHttpsUrl(value: unknown) {
  return typeof value === 'string' && value.trim().startsWith('https://') && value.trim().length <= 2000;
}

function validateProposalPrice(value: number | undefined, field: string) {
  if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 100000)) throw new Error(`El campo ${field} no es válido`);
}

async function applyCatalogProposal(client: any, proposal: CatalogProposal) {
  if (proposal.kind === 'branch') {
    const name = proposalText(proposal.payload, 'name');
    const neighborhood = proposalText(proposal.payload, 'neighborhood');
    const address = proposalText(proposal.payload, 'address');
    const latitude = proposalNumber(proposal.payload, 'latitude');
    const longitude = proposalNumber(proposal.payload, 'longitude');
    if (!name || !neighborhood || !address || latitude === undefined || longitude === undefined || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error('La propuesta necesita nombre, colonia, dirección y coordenadas válidas');
    const branchId = `community-${proposal.id}`;
    // A community proposal always creates its own parent record. Never let a
    // user-supplied payload overwrite an existing taqueria by reusing its id.
    const taqueriaId = branchId;
    const taqueriaName = name;
    const taqueriaSlug = `${taqueriaName.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)}-${taqueriaId.slice(-8)}`;
    await client.query(`INSERT INTO taquerias (id, name, slug, description) VALUES ($1, $2, $3, $4) ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, description = EXCLUDED.description, updated_at = now()`, [taqueriaId, taqueriaName, taqueriaSlug || `taqueria-${taqueriaId}`, proposalText(proposal.payload, 'taqueriaDescription')]);
    const tags = Array.isArray(proposal.payload.tags) ? proposal.payload.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 30) : [];
    const hours = proposal.payload.weeklyHours;
    if (hours !== undefined && !isProposalWeeklyHours(hours)) throw new Error('El horario semanal no es válido');
    const openUntil = proposalText(proposal.payload, 'openUntil', '23:00');
    if (!isProposalTime(openUntil)) throw new Error('La hora de cierre no es válida');
    const priceMin = proposalNumber(proposal.payload, 'priceMin');
    const priceMax = proposalNumber(proposal.payload, 'priceMax');
    validateProposalPrice(priceMin, 'priceMin');
    validateProposalPrice(priceMax, 'priceMax');
    if (priceMin !== undefined && priceMax !== undefined && priceMin > priceMax) throw new Error('El rango de precios no es válido');
    const imageUrl = proposalText(proposal.payload, 'imageUrl');
    if (imageUrl && !isProposalHttpsUrl(imageUrl)) throw new Error('La imagen debe usar HTTPS');
    await client.query(`
      INSERT INTO branches (id, taqueria_id, name, neighborhood, address, phone, location, open_until, weekly_hours, price_min, price_max, style, image_url, image_license, image_attribution, image_source_url, description, tags, search_text, rating, match_score, is_active, source_name, source_place_id, source_url, source_license, source_attribution, dedupe_key, catalog_status, catalog_quality, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, ST_SetSRID(ST_MakePoint($7, $8), 4326)::geography, $9, $10::jsonb, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, 0, NULL, true, 'community', $21, $22, $23, $24, 'active', 'community', now())
    `, [branchId, taqueriaId, name, neighborhood, address, proposalText(proposal.payload, 'phone') || null, longitude, latitude, openUntil, JSON.stringify(hours ?? {}), priceMin ?? null, priceMax ?? null, proposalText(proposal.payload, 'style', 'Clásico callejero'), imageUrl, proposalText(proposal.payload, 'imageLicense') || null, proposalText(proposal.payload, 'imageAttribution') || 'Propuesta de la comunidad', proposalText(proposal.payload, 'imageSourceUrl') || null, proposalText(proposal.payload, 'description'), tags, `${name} ${neighborhood} ${proposalText(proposal.payload, 'style')} ${tags.join(' ')}`, proposal.id, proposal.evidenceUrl ?? null, proposalText(proposal.payload, 'sourceLicense') || null, proposalText(proposal.payload, 'sourceAttribution') || 'Propuesta de la comunidad', `${name.toLowerCase()}:${latitude.toFixed(4)}:${longitude.toFixed(4)}`]);
    return branchId;
  }

  if (proposal.kind === 'menu_item') {
    const branchId = proposal.branchId ?? proposalText(proposal.payload, 'branchId');
    const name = proposalText(proposal.payload, 'name');
    if (!branchId || !name) throw new Error('La propuesta de taco necesita sucursal y nombre');
    const price = proposalNumber(proposal.payload, 'price');
    validateProposalPrice(price, 'price');
    const branch = await client.query(`SELECT 1 FROM branches WHERE id = $1 AND is_active = true AND catalog_status IN ('active', 'needs_review')`, [branchId]);
    if (!branch.rowCount) throw new Error('La sucursal ya no está disponible');
    const tacoId = `community-${proposal.id}`;
    await client.query(`INSERT INTO menu_items (id, branch_id, name, note, price, rating, is_active) VALUES ($1, $2, $3, $4, $5, 0, true)`, [tacoId, branchId, name, proposalText(proposal.payload, 'note'), price ?? 0]);
    return tacoId;
  }

  const branchId = proposal.branchId ?? proposalText(proposal.payload, 'branchId');
  if (!branchId) throw new Error('La corrección necesita sucursal');
  const current = await client.query("SELECT price_min, price_max FROM branches WHERE id = $1 AND is_active = true AND catalog_status IN ('active', 'needs_review')", [branchId]);
  if (!current.rowCount) throw new Error('La sucursal ya no está disponible');
  const changes: Record<string, unknown> = proposal.payload.changes && typeof proposal.payload.changes === 'object' && !Array.isArray(proposal.payload.changes) ? proposal.payload.changes as Record<string, unknown> : proposal.payload;
  const allowed: Record<string, string> = { name: 'name', neighborhood: 'neighborhood', address: 'address', phone: 'phone', openUntil: 'open_until', weeklyHours: 'weekly_hours', priceMin: 'price_min', priceMax: 'price_max', style: 'style', description: 'description', tags: 'tags', imageUrl: 'image_url' };
  const assignments = [];
  const values: unknown[] = [branchId];
  for (const [key, column] of Object.entries(allowed)) {
    if (!(key in changes)) continue;
    const value = changes[key];
    if (['name', 'neighborhood', 'address', 'style', 'description'].includes(key) && (typeof value !== 'string' || !value.trim())) throw new Error(`El campo ${key} no es válido`);
    if (key === 'openUntil' && !isProposalTime(value)) throw new Error('La hora de cierre no es válida');
    if (key === 'weeklyHours' && !isProposalWeeklyHours(value)) throw new Error('El horario semanal no es válido');
    if (key === 'imageUrl' && value !== '' && !isProposalHttpsUrl(value)) throw new Error('La imagen debe usar HTTPS');
    if (key === 'tags' && !Array.isArray(value)) throw new Error('Los tags no son válidos');
    if (key === 'priceMin' || key === 'priceMax') validateProposalPrice(proposalNumber(changes, key), key);
    values.push(key === 'weeklyHours' ? JSON.stringify(value) : key === 'tags' ? (value as unknown[]).map((tag: unknown) => String(tag).trim()).filter(Boolean).slice(0, 30) : typeof value === 'string' ? value.trim() : value);
    assignments.push(`${column} = $${values.length}${key === 'weeklyHours' ? '::jsonb' : ''}`);
  }
  const changedPriceMin = proposalNumber(changes, 'priceMin');
  const changedPriceMax = proposalNumber(changes, 'priceMax');
  const currentPriceMin = current.rows[0].price_min == null ? undefined : Number(current.rows[0].price_min);
  const currentPriceMax = current.rows[0].price_max == null ? undefined : Number(current.rows[0].price_max);
  const nextPriceMin = changedPriceMin ?? currentPriceMin;
  const nextPriceMax = changedPriceMax ?? currentPriceMax;
  if (nextPriceMin !== undefined && nextPriceMax !== undefined && nextPriceMin > nextPriceMax) throw new Error('El rango de precios no es válido');
  if (!assignments.length) throw new Error('La corrección no contiene campos editables');
  assignments.push("catalog_quality = 'community'", 'updated_at = now()');
  const result = await client.query(`UPDATE branches SET ${assignments.join(', ')} WHERE id = $1 RETURNING id`, values);
  if (!result.rowCount) throw new Error('La sucursal ya no está disponible');
  return branchId;
}

function applyLocalCatalogProposal(proposal: CatalogProposal) {
  if (proposal.kind === 'branch') {
    const name = proposalText(proposal.payload, 'name');
    const neighborhood = proposalText(proposal.payload, 'neighborhood');
    const address = proposalText(proposal.payload, 'address');
    const latitude = proposalNumber(proposal.payload, 'latitude');
    const longitude = proposalNumber(proposal.payload, 'longitude');
    if (!name || !neighborhood || !address || latitude === undefined || longitude === undefined || !Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new Error('La propuesta necesita nombre, colonia, dirección y coordenadas válidas');
    const openUntil = proposalText(proposal.payload, 'openUntil', '23:00');
    if (!isProposalTime(openUntil)) throw new Error('La hora de cierre no es válida');
    const weeklyHours = proposal.payload.weeklyHours;
    if (weeklyHours !== undefined && !isProposalWeeklyHours(weeklyHours)) throw new Error('El horario semanal no es válido');
    const priceMin = proposalNumber(proposal.payload, 'priceMin');
    const priceMax = proposalNumber(proposal.payload, 'priceMax');
    validateProposalPrice(priceMin, 'priceMin');
    validateProposalPrice(priceMax, 'priceMax');
    if (priceMin !== undefined && priceMax !== undefined && priceMin > priceMax) throw new Error('El rango de precios no es válido');
    const imageUrl = proposalText(proposal.payload, 'imageUrl');
    if (imageUrl && !isProposalHttpsUrl(imageUrl)) throw new Error('La imagen debe usar HTTPS');
    const branchId = `community-${proposal.id}`;
    const taqueriaName = name;
    places.push({
      id: branchId,
      taqueriaId: branchId,
      taqueriaName,
      name,
      neighborhood,
      address,
      phone: proposalText(proposal.payload, 'phone') || undefined,
      distance: 'cerca de ti',
      openUntil,
      rating: 0,
      match: undefined,
      style: proposalText(proposal.payload, 'style', 'Clásico callejero'),
      coordinates: { latitude, longitude },
      image: imageUrl,
      description: proposalText(proposal.payload, 'description'),
      tacos: [],
      weeklyHours,
      priceMin,
      priceMax,
      tags: Array.isArray(proposal.payload.tags) ? proposal.payload.tags.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 30) : [],
      flavorProfile: { intensity: 50, spicy: 50, traditional: 50, texture: 50, value: 50 },
      source: { name: 'community', url: proposal.evidenceUrl, attribution: 'Propuesta de la comunidad' }
    });
    return branchId;
  }

  const branchId = proposal.branchId ?? proposalText(proposal.payload, 'branchId');
  const place = localCatalogPlaces().find((item) => item.id === branchId);
  if (!place) throw new Error('La sucursal ya no está disponible');
  if (proposal.kind === 'menu_item') {
    const name = proposalText(proposal.payload, 'name');
    if (!name) throw new Error('La propuesta de taco necesita sucursal y nombre');
    const price = proposalNumber(proposal.payload, 'price');
    validateProposalPrice(price, 'price');
    const tacoId = `community-${proposal.id}`;
    place.tacos.push({ id: tacoId, name, note: proposalText(proposal.payload, 'note'), price: price ?? 0, rating: 0 });
    return tacoId;
  }

  const changes: Record<string, unknown> = proposal.payload.changes && typeof proposal.payload.changes === 'object' && !Array.isArray(proposal.payload.changes) ? proposal.payload.changes as Record<string, unknown> : proposal.payload;
  const editable: Record<string, keyof ApiPlace> = { name: 'name', neighborhood: 'neighborhood', address: 'address', phone: 'phone', openUntil: 'openUntil', weeklyHours: 'weeklyHours', priceMin: 'priceMin', priceMax: 'priceMax', style: 'style', description: 'description', tags: 'tags', imageUrl: 'image' };
  const pendingUpdates = new Map<keyof ApiPlace, unknown>();
  for (const [key, property] of Object.entries(editable)) {
    if (!(key in changes)) continue;
    const value = changes[key];
    if (['name', 'neighborhood', 'address', 'style', 'description'].includes(key)) {
      if (typeof value !== 'string' || !value.trim()) throw new Error(`El campo ${key} no es válido`);
      pendingUpdates.set(property, value.trim());
    } else if (key === 'phone') {
      if (typeof value !== 'string') throw new Error('El campo phone no es válido');
      pendingUpdates.set(property, value.trim() || undefined);
    } else if (key === 'openUntil') {
      if (!isProposalTime(value)) throw new Error('La hora de cierre no es válida');
      pendingUpdates.set(property, value);
    } else if (key === 'imageUrl') {
      if (value !== '' && !isProposalHttpsUrl(value)) throw new Error('La imagen debe usar HTTPS');
      pendingUpdates.set(property, value);
    } else if (key === 'tags') {
      if (!Array.isArray(value)) throw new Error('Los tags no son válidos');
      pendingUpdates.set(property, value.map(String).map((tag) => tag.trim()).filter(Boolean).slice(0, 30));
    } else if (key === 'weeklyHours') {
      if (!isProposalWeeklyHours(value)) throw new Error('El horario semanal no es válido');
      pendingUpdates.set(property, value);
    } else {
      const parsed = Number(value);
      validateProposalPrice(parsed, key);
      pendingUpdates.set(property, parsed);
    }
  }
  const changedPriceMin = proposalNumber(changes, 'priceMin');
  const changedPriceMax = proposalNumber(changes, 'priceMax');
  const nextPriceMin = changedPriceMin ?? place.priceMin;
  const nextPriceMax = changedPriceMax ?? place.priceMax;
  if (nextPriceMin !== undefined && nextPriceMax !== undefined && nextPriceMin > nextPriceMax) throw new Error('El rango de precios no es válido');
  for (const [property, value] of pendingUpdates) (place as unknown as Record<string, unknown>)[property] = value;
  if (!Object.keys(changes).some((key) => key in editable)) throw new Error('La corrección no contiene campos editables');
  place.source = { ...place.source, name: 'community', url: proposal.evidenceUrl, attribution: 'Propuesta de la comunidad' };
  return branchId;
}

export async function reviewCatalogProposal(id: string, action: 'approve' | 'reject', reviewerId: string, reviewNote = ''): Promise<boolean> {
  const proposal = await getCatalogProposal(id);
  if (!proposal || proposal.status !== 'pending') return false;
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      if (action === 'approve') await applyCatalogProposal(client, proposal);
      const result = await client.query(`UPDATE catalog_proposals SET status = $2, review_note = $3, reviewed_by = $4, updated_at = now() WHERE id = $1 AND status = 'pending' RETURNING id`, [id, action === 'approve' ? 'approved' : 'rejected', reviewNote.trim(), reviewerId]);
      await client.query('COMMIT');
      return Boolean(result.rowCount);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  const localProposal = localCatalogProposals.get(id);
  if (!localProposal || localProposal.status !== 'pending') return false;
  if (action === 'approve') applyLocalCatalogProposal({ id: localProposal.id, kind: localProposal.kind, branchId: localProposal.branchId, payload: localProposal.payload, evidenceUrl: localProposal.evidenceUrl, status: localProposal.status, reviewNote: localProposal.reviewNote, createdAt: localProposal.createdAt, updatedAt: localProposal.updatedAt });
  localProposal.status = action === 'approve' ? 'approved' : 'rejected';
  localProposal.reviewNote = reviewNote.trim();
  localProposal.reviewedBy = reviewerId;
  localProposal.updatedAt = new Date().toISOString();
  return true;
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
    const branch = await pool.query(`SELECT 1 FROM branches WHERE id = $1 AND is_active = true AND catalog_status IN ('active', 'needs_review') ${allowDemoCatalog ? '' : "AND COALESCE(source_name, '') <> 'demo'"}`, [placeId]);
    if (!branch.rowCount) return 'not_found';
    const result = await pool.query('INSERT INTO saved_places (user_id, branch_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING branch_id', [userId, placeId]);
    return result.rowCount ? 'saved' : 'already_saved';
  }
  if (!localCatalogPlaces().some((place) => place.id === placeId)) return 'not_found';
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
      await client.query(`INSERT INTO visits (id, user_id, branch_id, rating, tortilla_rating, service_rating, price_rating, meat_rating, salsas_rating, price, note, photo_url, visit_location)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
          CASE WHEN $13::numeric IS NULL OR $14::numeric IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint($14::numeric, $13::numeric), 4326)::geography END)`,
        [id, userId, input.placeId, input.rating, input.categoryRatings?.tortilla ?? null, input.categoryRatings?.service ?? null, input.categoryRatings?.price ?? null, input.categoryRatings?.meat ?? null, input.categoryRatings?.salsas ?? null, input.price ?? null, input.note?.trim() ?? '', input.photoUrl ?? null, input.latitude ?? null, input.longitude ?? null]);
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

type VisitUpdateInput = { rating?: number; tacoRatings?: Record<string, number>; categoryRatings?: CategoryRatings; price?: number | null; note?: string };

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
    if (input.categoryRatings) {
      for (const key of Object.keys(input.categoryRatings) as RatingCategory[]) {
        values.push(input.categoryRatings[key] ?? null);
        assignments.push(`${ratingCategoryColumns[key]} = $${values.length}`);
      }
    }
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
  if (input.categoryRatings) visit.categoryRatings = { ...(visit.categoryRatings ?? {}), ...input.categoryRatings };
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
  const autoVerify = process.env.REQUIRE_EMAIL_VERIFICATION !== 'true';
  if (pool) {
    const existing = await pool.query('SELECT id FROM users WHERE email_lower = $1', [email]);
    if (existing.rowCount) throw new Error('EMAIL_TAKEN');
    const id = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(input.password, 12);
    const role = configuredAdminEmails.has(email) ? 'admin' : 'user';
    const result = await pool.query('INSERT INTO users (id, email, email_lower, password_hash, display_name, role, email_verified_at) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, display_name, role, email_verified_at', [id, input.email.trim(), email, passwordHash, displayName, role, autoVerify ? new Date() : null]);
    return { id: result.rows[0].id, email: result.rows[0].email, displayName: result.rows[0].display_name, role: result.rows[0].role, emailVerified: Boolean(result.rows[0].email_verified_at) };
  }
  if ([...localUsers.values()].some((user) => user.email === email)) throw new Error('EMAIL_TAKEN');
  const user: LocalUser = { id: crypto.randomUUID(), email, displayName, role: configuredAdminEmails.has(email) ? 'admin' : 'user', passwordHash: await bcrypt.hash(input.password, 10), shareActivity: true, emailVerifiedAt: autoVerify ? new Date().toISOString() : undefined };
  localUsers.set(user.id, user);
  return publicUser(user);
}

export async function authenticateUser(input: { email: string; password: string }): Promise<PublicUser | undefined> {
  const email = input.email.trim().toLowerCase();
  if (pool) {
    const result = await pool.query('SELECT id, email, display_name, password_hash, role, email_verified_at FROM users WHERE email_lower = $1 AND is_active = true', [email]);
    const row = result.rows[0];
    if (!row || !(await bcrypt.compare(input.password, row.password_hash))) return undefined;
    if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !row.email_verified_at) return undefined;
    return { id: row.id, email: row.email, displayName: row.display_name, role: row.role, emailVerified: Boolean(row.email_verified_at) };
  }
  const user = [...localUsers.values()].find((item) => item.email === email);
  if (!user || !(await bcrypt.compare(input.password, user.passwordHash))) return undefined;
  if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true' && !user.emailVerifiedAt) return undefined;
  return publicUser(user);
}

function createOpaqueToken() {
  return `${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
}

export async function createEmailVerificationToken(userId: string) {
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (pool) {
    await pool.query('DELETE FROM email_verification_tokens WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await pool.query('INSERT INTO email_verification_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, sha256(token), expiresAt]);
  } else {
    for (const [key, value] of localVerificationTokens.entries()) if (value.userId === userId) localVerificationTokens.delete(key);
    localVerificationTokens.set(sha256(token), { userId, tokenHash: sha256(token), expiresAt: expiresAt.toISOString() });
  }
  return token;
}

export async function findUnverifiedUserByEmail(email: string) {
  const normalized = email.trim().toLowerCase();
  if (pool) {
    const result = await pool.query('SELECT id, email, display_name, role, email_verified_at FROM users WHERE email_lower = $1 AND is_active = true', [normalized]);
    const row = result.rows[0];
    return row && !row.email_verified_at ? { id: row.id, email: row.email, displayName: row.display_name, role: row.role, emailVerified: false } satisfies PublicUser : undefined;
  }
  const user = [...localUsers.values()].find((item) => item.email === normalized && !item.emailVerifiedAt);
  return user ? publicUser(user) : undefined;
}

export async function verifyEmailToken(token: string): Promise<PublicUser | undefined> {
  const tokenHash = sha256(token);
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`SELECT u.id FROM email_verification_tokens t JOIN users u ON u.id = t.user_id WHERE t.token_hash = $1 AND t.used_at IS NULL AND t.expires_at > now() AND u.is_active = true FOR UPDATE`, [tokenHash]);
      const userId = result.rows[0]?.id as string | undefined;
      if (!userId) { await client.query('ROLLBACK'); return undefined; }
      await client.query('UPDATE users SET email_verified_at = now(), updated_at = now() WHERE id = $1', [userId]);
      await client.query('UPDATE email_verification_tokens SET used_at = now() WHERE token_hash = $1', [tokenHash]);
      await client.query('COMMIT');
      return findUserById(userId);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  const record = localVerificationTokens.get(tokenHash);
  if (!record || Date.parse(record.expiresAt) <= Date.now()) return undefined;
  const user = localUsers.get(record.userId);
  if (!user) return undefined;
  user.emailVerifiedAt = new Date().toISOString();
  localVerificationTokens.delete(tokenHash);
  return publicUser(user);
}

export async function createPasswordResetToken(email: string) {
  const normalized = email.trim().toLowerCase();
  let userId: string | undefined;
  if (pool) {
    const result = await pool.query('SELECT id FROM users WHERE email_lower = $1 AND is_active = true', [normalized]);
    userId = result.rows[0]?.id;
  } else {
    userId = [...localUsers.values()].find((user) => user.email === normalized)?.id;
  }
  if (!userId) return undefined;
  const token = createOpaqueToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  if (pool) {
    await pool.query('DELETE FROM password_reset_tokens WHERE user_id = $1 AND used_at IS NULL', [userId]);
    await pool.query('INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)', [userId, sha256(token), expiresAt]);
  } else {
    for (const [key, value] of localPasswordResetTokens.entries()) if (value.userId === userId) localPasswordResetTokens.delete(key);
    localPasswordResetTokens.set(sha256(token), { userId, tokenHash: sha256(token), expiresAt: expiresAt.toISOString() });
  }
  return token;
}

export async function resetPassword(token: string, password: string) {
  const tokenHash = sha256(token);
  if (pool) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const found = await client.query(`SELECT user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`, [tokenHash]);
      const userId = found.rows[0]?.user_id as string | undefined;
      if (!userId) { await client.query('ROLLBACK'); return false; }
      const passwordHash = await bcrypt.hash(password, 12);
      await client.query('UPDATE users SET password_hash = $2, password_changed_at = now(), updated_at = now() WHERE id = $1 AND is_active = true', [userId, passwordHash]);
      await client.query('UPDATE password_reset_tokens SET used_at = now() WHERE token_hash = $1', [tokenHash]);
      await client.query('UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await client.query('COMMIT');
      return true;
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  const record = localPasswordResetTokens.get(tokenHash);
  if (!record || Date.parse(record.expiresAt) <= Date.now()) return false;
  const user = localUsers.get(record.userId);
  if (!user) return false;
  user.passwordHash = await bcrypt.hash(password, 10);
  for (const session of localSessions.values()) if (session.userId === user.id) session.revokedAt = new Date().toISOString();
  localPasswordResetTokens.delete(tokenHash);
  return true;
}

export async function exportUserData(userId: string) {
  if (pool) {
    const [user, visits, lists, listItems, follows, saved, comments] = await Promise.all([
      pool.query('SELECT id, email, display_name, role, email_verified_at, created_at FROM users WHERE id = $1 AND is_active = true', [userId]),
      pool.query('SELECT id, branch_id, rating, tortilla_rating, service_rating, price_rating, meat_rating, salsas_rating, visited_at, created_at, price, note, photo_url, visibility FROM visits WHERE user_id = $1 ORDER BY visited_at DESC', [userId]),
      pool.query('SELECT id, title, description, visibility, created_at, updated_at FROM lists WHERE owner_id = $1 ORDER BY created_at DESC', [userId]),
      pool.query('SELECT li.list_id, li.branch_id, li.position, li.note, li.created_at FROM list_items li JOIN lists l ON l.id = li.list_id WHERE l.owner_id = $1 ORDER BY li.list_id, li.position', [userId]),
      pool.query('SELECT follower_id, followed_id, created_at FROM follows WHERE follower_id = $1 OR followed_id = $1 ORDER BY created_at DESC', [userId]),
      pool.query('SELECT branch_id, created_at FROM saved_places WHERE user_id = $1 ORDER BY created_at DESC', [userId]),
      pool.query('SELECT id, visit_id, body, visibility, created_at FROM visit_comments WHERE author_id = $1 ORDER BY created_at DESC', [userId])
    ]);
    if (!user.rows[0]) return undefined;
    return { exportedAt: new Date().toISOString(), user: user.rows[0], visits: visits.rows, lists: lists.rows, listItems: listItems.rows, follows: follows.rows, savedPlaces: saved.rows, comments: comments.rows };
  }
  const user = localUsers.get(userId);
  if (!user) return undefined;
  return {
    exportedAt: new Date().toISOString(),
    user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, emailVerified: Boolean(user.emailVerifiedAt) },
    visits: [...localVisits.entries()].filter(([, visit]) => visit.userId === userId).map(([id, visit]) => ({ id, ...visit })),
    lists: [...localLists.values()].filter((list) => list.ownerId === userId),
    listItems: [...localLists.values()].filter((list) => list.ownerId === userId).flatMap((list) => list.placeIds.map((branchId, position) => ({ listId: list.id, branchId, position }))),
    follows: [...localFollows].filter((key) => key.startsWith(`${userId}:`) || key.endsWith(`:${userId}`)),
    savedPlaces: [...localSavedPlaces].filter((key) => key.startsWith(`${userId}:`)),
    comments: [...localComments.values()].filter((comment) => comment.authorId === userId)
  };
}

export async function deleteUserAccount(userId: string) {
  if (pool) {
    const result = await pool.query('DELETE FROM users WHERE id = $1 AND is_active = true', [userId]);
    return Boolean(result.rowCount);
  }
  if (!localUsers.has(userId)) return false;
  localUsers.delete(userId);
  for (const [key, session] of localSessions.entries()) if (session.userId === userId) localSessions.delete(key);
  for (const [key, value] of localVerificationTokens.entries()) if (value.userId === userId) localVerificationTokens.delete(key);
  for (const [key, value] of localPasswordResetTokens.entries()) if (value.userId === userId) localPasswordResetTokens.delete(key);
  for (const key of [...localFollows]) if (key.startsWith(`${userId}:`) || key.endsWith(`:${userId}`)) localFollows.delete(key);
  for (const key of [...localSavedPlaces]) if (key.startsWith(`${userId}:`)) localSavedPlaces.delete(key);
  for (const [key, list] of localLists.entries()) if (list.ownerId === userId) localLists.delete(key);
  for (const [key, visit] of localVisits.entries()) if (visit.userId === userId) localVisits.delete(key);
  for (const [key, comment] of localComments.entries()) if (comment.authorId === userId) localComments.delete(key);
  return true;
}

export async function findUserById(id: string): Promise<PublicUser | undefined> {
  if (pool) {
    const result = await pool.query('SELECT id, email, display_name, role, email_verified_at FROM users WHERE id = $1 AND is_active = true', [id]);
    const row = result.rows[0];
    return row ? { id: row.id, email: row.email, displayName: row.display_name, role: row.role, emailVerified: Boolean(row.email_verified_at) } : undefined;
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
  const ratings = entries.map((entry) => Number(entry.rating)).filter((rating) => Number.isFinite(rating) && rating > 0);
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
      SELECT v.id, v.visited_at, v.rating, v.tortilla_rating, v.service_rating, v.price_rating, v.meat_rating, v.salsas_rating, v.price, v.note, v.photo_url, b.name AS place_name, b.neighborhood,
        COALESCE(string_agg(m.name, ', ' ORDER BY m.name), '') AS tacos,
      COALESCE(json_object_agg(m.id, vi.rating) FILTER (WHERE m.id IS NOT NULL), '{}'::json) AS taco_ratings,
        COALESCE(v.photo_url, b.image_url, '') AS image_url,
        ST_Y(COALESCE(v.visit_location, b.location)::geometry) AS latitude,
        ST_X(COALESCE(v.visit_location, b.location)::geometry) AS longitude
      FROM visits v JOIN branches b ON b.id = v.branch_id
      LEFT JOIN visit_items vi ON vi.visit_id = v.id
      LEFT JOIN menu_items m ON m.id = vi.menu_item_id
      WHERE v.user_id = $1${visibilityFilter} GROUP BY v.id, v.tortilla_rating, v.service_rating, v.price_rating, v.meat_rating, v.salsas_rating, v.price, v.note, v.photo_url, b.name, b.neighborhood, b.image_url, b.location
      ORDER BY v.visited_at DESC LIMIT 100
    `, [userId]);
    return result.rows.map((row) => ({
      ...row,
      // pg returns NUMERIC columns as strings. Keep the API contract
      // identical to the in-memory fallback so mobile clients receive
      // numbers for diary context and map coordinates in every environment.
      rating: Number(row.rating),
      category_ratings: {
        tortilla: nullableNumber(row.tortilla_rating),
        service: nullableNumber(row.service_rating),
        price: nullableNumber(row.price_rating),
        meat: nullableNumber(row.meat_rating),
        salsas: nullableNumber(row.salsas_rating)
      },
      price: row.price == null ? null : Number(row.price),
      latitude: row.latitude == null ? null : Number(row.latitude),
      longitude: row.longitude == null ? null : Number(row.longitude)
    }));
  }
  return [...localVisits.entries()].filter(([, visit]) => visit.userId === userId && (includeHidden || visit.visibility === 'visible')).sort(([, a], [, b]) => b.createdAt.localeCompare(a.createdAt)).map(([id, visit]) => {
    const place = localCatalogPlaces().find((item) => item.id === visit.placeId);
    const tacoNames = visit.tacoIds.map((tacoId) => place?.tacos.find((taco) => taco.id === tacoId)?.name ?? tacoId).join(', ');
    return { id, visited_at: visit.createdAt, rating: visit.rating, category_ratings: visit.categoryRatings ?? {}, price: visit.price ?? null, note: visit.note ?? '', photo_url: visit.photoUrl ?? null, place_name: place?.name ?? visit.placeId, neighborhood: place?.neighborhood ?? '', tacos: tacoNames, taco_ratings: visit.tacoRatings ?? {}, latitude: visit.latitude ?? place?.coordinates.latitude ?? null, longitude: visit.longitude ?? place?.coordinates.longitude ?? null, image_url: visit.photoUrl ?? place?.image ?? '' };
  });
}

export type ApiPassportZone = { name: string; note: string; branchCount: number; visitCount: number; unlocked: boolean };

/**
 * Build the collectible city map from the live branch catalog rather than a
 * hard-coded list. Only visible visits belonging to the requesting user can
 * unlock a zone; hidden visits never leak into the passport progress.
 */
export async function getPassport(userId: string) {
  if (pool) {
    const result = await pool.query(`
      SELECT b.neighborhood AS name,
        COUNT(DISTINCT b.id)::int AS branch_count,
        COUNT(v.id)::int AS visit_count
      FROM branches b
      LEFT JOIN visits v ON v.branch_id = b.id AND v.user_id = $1 AND v.visibility = 'visible'
      WHERE b.is_active = true AND b.catalog_status IN ('active', 'needs_review') ${allowDemoCatalog ? '' : "AND COALESCE(b.source_name, '') <> 'demo'"}
      GROUP BY b.neighborhood
      ORDER BY b.neighborhood
    `, [userId]);
    const zones = result.rows.map((row) => {
      const visitCount = Number(row.visit_count ?? 0);
      return {
        name: row.name,
        note: visitCount ? 'Visitada' : `${Number(row.branch_count ?? 0)} sucursal${Number(row.branch_count ?? 0) === 1 ? '' : 'es'} por descubrir`,
        branchCount: Number(row.branch_count ?? 0),
        visitCount,
        unlocked: visitCount > 0
      } satisfies ApiPassportZone;
    });
    return { zones, totalZones: zones.length, visitedZones: zones.filter((zone) => zone.unlocked).length };
  }

  const zoneMap = new Map<string, { branchCount: number; visitCount: number }>();
  for (const place of localCatalogPlaces()) {
    const current = zoneMap.get(place.neighborhood) ?? { branchCount: 0, visitCount: 0 };
    current.branchCount += 1;
    zoneMap.set(place.neighborhood, current);
  }
  for (const visit of localVisits.values()) {
    if (visit.userId !== userId || visit.visibility !== 'visible') continue;
    const place = localCatalogPlaces().find((item) => item.id === visit.placeId);
    if (place) zoneMap.get(place.neighborhood)!.visitCount += 1;
  }
  const zones = [...zoneMap.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([name, counts]) => ({
    name,
    note: counts.visitCount ? 'Visitada' : `${counts.branchCount} sucursal${counts.branchCount === 1 ? '' : 'es'} por descubrir`,
    branchCount: counts.branchCount,
    visitCount: counts.visitCount,
    unlocked: counts.visitCount > 0
  } satisfies ApiPassportZone));
  return { zones, totalZones: zones.length, visitedZones: zones.filter((zone) => zone.unlocked).length };
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
    coverImage: row.cover_image_url ?? places[0]?.image ?? '',
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
  return [...(allowDemoCatalog ? fixtureLists : []), ...mapped];
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
    const normalized = normalizeList(listResult.rows[0]);
    const items = (await Promise.all(itemResult.rows.map(async (row) => ({ branchId: row.branch_id, note: row.note ?? '', position: Number(row.position), place: await findPlace(row.branch_id) })))).filter((item): item is { branchId: string; note: string; position: number; place: ApiPlace } => Boolean(item.place));
    // A public list exposes its collaborator count, not the roster. The owner
    // and an explicitly authorized collaborator may see names/roles to keep
    // shared-list management functional.
    const viewerRole = userId ? await getListRole(listId, userId) : undefined;
    const collaborators = userId && (normalized.owner.id === userId || viewerRole) ? await getListCollaborators(listId) : [];
    return { ...normalized, collaborators, items };
  }
  const local = localLists.get(listId);
  if (local && (local.visibility === 'public' || local.ownerId === userId || (userId ? localListCollaborators.has(`${local.id}:${userId}`) : false))) {
    const owner = localUsers.get(local.ownerId);
    const visitedCount = local.placeIds.filter((placeId) => [...localVisits.values()].some((visit) => visit.userId === userId && visit.placeId === placeId && visit.visibility === 'visible')).length;
    const collaborators = await getListCollaborators(local.id);
    const canEdit = local.ownerId === userId || collaborators.some((collaborator) => collaborator.id === userId && collaborator.role === 'editor');
    const visibleCollaborators = userId && (local.ownerId === userId || collaborators.some((collaborator) => collaborator.id === userId)) ? collaborators : [];
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
      collaborators: visibleCollaborators,
      items: local.placeIds.map((placeId, position) => { const place = localCatalogPlaces().find((item) => item.id === placeId); return place ? { branchId: placeId, note: '', position, place } : undefined; }).filter((item): item is { branchId: string; note: string; position: number; place: ApiPlace } => Boolean(item))
    };
  }
  const fixture = allowDemoCatalog ? fixtureLists.find((item) => item.id === listId) : undefined;
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
  const coverImage = allowDemoCatalog ? places[0]?.image ?? '' : '';
  localLists.set(id, { id, ownerId: userId, title, description, visibility, coverImage, placeIds: [], createdAt });
  const owner = localUsers.get(userId);
  return { id, title, description, owner: { id: userId, displayName: owner?.displayName ?? 'Tacos' }, itemCount: 0, visitedCount: 0, coverImage, visibility, collaboratorCount: 0, canEdit: true };
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
    const branch = await pool.query(`SELECT 1 FROM branches WHERE id = $1 AND is_active = true AND catalog_status IN ('active', 'needs_review') ${allowDemoCatalog ? '' : "AND COALESCE(source_name, '') <> 'demo'"}`, [placeId]);
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
  if (!list || (role !== 'owner' && role !== 'editor') || !localCatalogPlaces().some((place) => place.id === placeId)) return false;
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
        b.id AS place_id, b.name AS place_name, b.neighborhood, COALESCE(v.photo_url, b.image_url, '') AS image_url,
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
    const place = localCatalogPlaces().find((item) => item.id === visit.placeId);
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
      const place = visit ? localCatalogPlaces().find((item) => item.id === visit.placeId) : undefined;
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
      const place = visit ? localCatalogPlaces().find((item) => item.id === visit.placeId) : undefined;
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
