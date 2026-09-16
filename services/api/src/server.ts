import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { addListCollaborator, addListItemForUser, authenticateUser, closeRepository, consumeAuthRateLimit, createBranchPhotoForUser, createCatalogProposal, createEmailVerificationToken, createListForUser, createPasswordResetToken, createSession, createVisitComment, createVisitForUser, deleteBranchPhotoForUser, deleteUserAccount, deleteVisitComment, deleteVisitForUser, discoverPlaces, exportUserData, findPlace, findUnverifiedUserByEmail, findUserById, followUser, getAdminAnalytics, getAdminBranchPhotos, getAdminComments, getAdminReports, getBranchReviews, getCatalogProposals, getDiary, getFeed, getHealth, getListDetails, getLists, getPassport, getPrivacyForUser, getRecommendations, getSavedPlaceIds, getTaqueria, getTasteProfile, getUserProfile, getVisitComments, isSessionActive, listSessions, recordProductEvent, registerUser, removeListCollaborator, removeListItemForUser, reportVisitForUser, resetPassword, revokeAllSessions, revokeSession, reviewAdminComment, reviewAdminReport, reviewBranchPhoto, reviewCatalogProposal, savePlaceForUser, searchUsers, unfollowUser, unsavePlaceForUser, updateListForUser, updatePrivacyForUser, updateUserProfileForUser, updateVisitForUser, verifyEmailToken, type PublicUser } from './repository.js';
import { issueToken, verifyToken } from './auth.js';
import { getGooglePlacePhotos, isGooglePlacesConfigured } from './google-places.js';
import { uploadBranchPhotoImage, uploadVisitImage } from './storage.js';
import { passwordResetUrl, sendTransactionalEmail, verificationUrl } from './email.js';

const app = Fastify({ logger: true, bodyLimit: 12 * 1024 * 1024, trustProxy: true });
const googlePhotoRateLimits = new Map<string, { windowStartedAt: number; requests: number }>();
const GOOGLE_PHOTO_WINDOW_MS = 10 * 60_000;
const GOOGLE_PHOTO_LIMIT = 30;
const configuredCorsOrigins = (process.env.CORS_ORIGINS ?? '').split(',').map((value) => value.trim()).filter(Boolean);
await app.register(cors, {
  origin: configuredCorsOrigins.length ? configuredCorsOrigins : (process.env.NODE_ENV === 'production' ? false : true),
  credentials: false
});

app.setErrorHandler((error, request, reply) => {
  const errorCode = (error as { code?: string }).code;
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'INVALID_REQUEST', issues: error.issues });
  }
  if (errorCode === 'FST_ERR_CTP_BODY_TOO_LARGE') {
    return reply.code(413).send({ error: 'PAYLOAD_TOO_LARGE' });
  }
  if (errorCode === 'FST_ERR_CTP_INVALID_JSON_BODY' || errorCode === 'FST_ERR_CTP_EMPTY_JSON_BODY') {
    return reply.code(400).send({ error: 'INVALID_JSON' });
  }
  request.log.error(error);
  return reply.code(500).send({ error: 'INTERNAL_ERROR' });
});

declare module 'fastify' {
  interface FastifyRequest { user?: PublicUser }
}

async function resolveUser(request: FastifyRequest) {
  const header = request.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
  const claims = token ? await verifyToken(token) : undefined;
  if (!claims || !(await isSessionActive(claims.sessionId, claims.userId))) return undefined;
  return findUserById(claims.userId);
}

const halfStarRating = z.number().min(0).max(5).refine((value) => Number.isInteger(value * 2), { message: 'Rating must use half-star increments' });
const categoryRatingsSchema = z.object({
  tortilla: halfStarRating.nullable().optional(),
  service: halfStarRating.nullable().optional(),
  price: halfStarRating.nullable().optional(),
  meat: halfStarRating.nullable().optional(),
  salsas: halfStarRating.nullable().optional()
});

async function enforceAuthRateLimit(request: FastifyRequest, reply: FastifyReply, discriminator: string) {
  const key = `${request.ip}:${discriminator}`.slice(0, 220);
  const result = await consumeAuthRateLimit(key);
  if (result.allowed) return true;
  reply.header('Retry-After', String(result.retryAfterSeconds));
  await reply.code(429).send({ error: 'TOO_MANY_ATTEMPTS', retryAfterSeconds: result.retryAfterSeconds });
  return false;
}

function authMetadata(request: FastifyRequest) {
  const userAgent = typeof request.headers['user-agent'] === 'string' ? request.headers['user-agent'].slice(0, 240) : undefined;
  return { userAgent, ip: request.ip };
}

function allowGooglePhotoRequest(request: FastifyRequest) {
  const now = Date.now();
  const key = request.ip || 'unknown';
  const current = googlePhotoRateLimits.get(key);
  if (!current || now - current.windowStartedAt >= GOOGLE_PHOTO_WINDOW_MS) {
    googlePhotoRateLimits.set(key, { windowStartedAt: now, requests: 1 });
    return true;
  }
  if (current.requests >= GOOGLE_PHOTO_LIMIT) return false;
  current.requests += 1;
  return true;
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const user = await resolveUser(request);
  if (!user) {
    await reply.code(401).send({ error: 'UNAUTHORIZED' });
    return undefined;
  }
  request.user = user;
  return user;
}

async function requireAdmin(request: FastifyRequest, reply: FastifyReply) {
  const user = await requireUser(request, reply);
  if (!user || user.role !== 'admin') {
    if (user) await reply.code(403).send({ error: 'ADMIN_REQUIRED' });
    return undefined;
  }
  return user;
}

app.get('/health', async (_request, reply) => {
  const health = await getHealth();
  return reply.code(health.status === 'ok' ? 200 : 503).send({ ...health, service: 'tacos-api', timestamp: new Date().toISOString() });
});

const productEventNames = ['app_open', 'map_search', 'map_filter', 'radar_filter', 'place_open', 'visit_saved', 'visit_deleted', 'list_open', 'list_created', 'list_collaborator_changed', 'profile_open', 'feed_open'] as const;

app.post('/v1/events', async (request, reply) => {
  const body = z.object({
    eventName: z.enum(productEventNames),
    anonymousId: z.string().regex(/^[a-zA-Z0-9._:-]{8,128}$/).optional(),
    properties: z.record(z.string(), z.union([z.string().max(64), z.number(), z.boolean(), z.null()])).optional()
  }).refine((value) => Object.keys(value.properties ?? {}).length <= 20, { message: 'Too many event properties' }).parse(request.body);
  const user = await resolveUser(request);
  await recordProductEvent({ eventName: body.eventName, userId: user?.id, anonymousId: user ? undefined : body.anonymousId, properties: body.properties });
  return reply.code(202).send({ status: 'accepted' });
});

app.post('/v1/auth/register', async (request, reply) => {
  const body = z.object({ email: z.string().trim().email().max(320), password: z.string().min(8).max(128), displayName: z.string().trim().min(2).max(40) }).parse(request.body);
  if (!(await enforceAuthRateLimit(request, reply, `register:${body.email.toLowerCase()}`))) return;
  try {
    const user = await registerUser(body);
    const verificationToken = user.emailVerified ? undefined : await createEmailVerificationToken(user.id);
    if (verificationToken) {
      try {
        await sendTransactionalEmail({
          to: user.email,
          subject: 'Confirma tu correo en Tacos',
          text: `Confirma tu correo abriendo este enlace: ${verificationUrl(verificationToken)}`,
          html: `<p>Confirma tu correo para activar tu cuenta en Tacos.</p><p><a href="${verificationUrl(verificationToken)}">Confirmar correo</a></p>`
        });
      } catch (error) {
        request.log.error(error);
        if (process.env.NODE_ENV === 'production') return reply.code(503).send({ error: 'EMAIL_DELIVERY_UNAVAILABLE' });
      }
    }
    // Development and CI keep the original one-step experience. Production
    // requires the email link before issuing a session token.
    if (!user.emailVerified && process.env.REQUIRE_EMAIL_VERIFICATION === 'true') {
      return reply.code(201).send({ user, verificationRequired: true, ...(process.env.NODE_ENV === 'production' ? {} : { verificationToken }) });
    }
    const session = await createSession(user.id, authMetadata(request));
    return reply.code(201).send({ user, token: await issueToken(user, session.id), verificationRequired: false });
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_TAKEN') return reply.code(409).send({ error: 'EMAIL_TAKEN' });
    throw error;
  }
});

app.post('/v1/auth/login', async (request, reply) => {
  const body = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(128) }).parse(request.body);
  if (!(await enforceAuthRateLimit(request, reply, `login:${body.email.toLowerCase()}`))) return;
  const user = await authenticateUser(body);
  if (!user) {
    if (process.env.REQUIRE_EMAIL_VERIFICATION === 'true') {
      return reply.code(401).send({ error: 'INVALID_CREDENTIALS_OR_UNVERIFIED' });
    }
    return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
  }
  const session = await createSession(user.id, authMetadata(request));
  return { user, token: await issueToken(user, session.id), sessionId: session.id };
});

app.post('/v1/auth/verify-email', async (request, reply) => {
  const body = z.object({ token: z.string().min(20).max(160) }).parse(request.body);
  if (!(await enforceAuthRateLimit(request, reply, 'verify-email'))) return;
  const user = await verifyEmailToken(body.token);
  if (!user) return reply.code(400).send({ error: 'INVALID_OR_EXPIRED_TOKEN' });
  const session = await createSession(user.id, authMetadata(request));
  return { user, token: await issueToken(user, session.id) };
});

app.post('/v1/auth/resend-verification', async (request, reply) => {
  const body = z.object({ email: z.string().trim().email().max(320) }).parse(request.body);
  if (!(await enforceAuthRateLimit(request, reply, `resend:${body.email.toLowerCase()}`))) return;
  const user = await findUnverifiedUserByEmail(body.email);
  let verificationToken: string | undefined;
  if (user) {
    verificationToken = await createEmailVerificationToken(user.id);
    try {
      await sendTransactionalEmail({
        to: user.email,
        subject: 'Confirma tu correo en Tacos',
        text: `Confirma tu correo abriendo este enlace: ${verificationUrl(verificationToken)}`,
        html: `<p><a href="${verificationUrl(verificationToken)}">Confirmar correo</a></p>`
      });
    } catch (error) { request.log.error(error); }
  }
  return { status: 'accepted', ...(verificationToken && process.env.NODE_ENV !== 'production' ? { verificationToken } : {}) };
});

app.post('/v1/auth/forgot-password', async (request, reply) => {
  const body = z.object({ email: z.string().trim().email().max(320) }).parse(request.body);
  if (!(await enforceAuthRateLimit(request, reply, `forgot:${body.email.toLowerCase()}`))) return;
  const token = await createPasswordResetToken(body.email);
  if (token) {
    try {
      await sendTransactionalEmail({
        to: body.email.trim().toLowerCase(),
        subject: 'Restablece tu contraseña de Tacos',
        text: `Restablece tu contraseña abriendo este enlace: ${passwordResetUrl(token)}`,
        html: `<p>Solicitaste cambiar tu contraseña en Tacos.</p><p><a href="${passwordResetUrl(token)}">Restablecer contraseña</a></p>`
      });
    } catch (error) { request.log.error(error); }
    // Never disclose whether the email exists. In non-production the token is
    // returned solely to make local development and smoke tests self-contained.
    return { status: 'accepted', ...(process.env.NODE_ENV === 'production' ? {} : { resetToken: token }) };
  }
  return { status: 'accepted' };
});

app.post('/v1/auth/reset-password', async (request, reply) => {
  const body = z.object({ token: z.string().min(20).max(160), password: z.string().min(8).max(128) }).parse(request.body);
  if (!(await enforceAuthRateLimit(request, reply, 'reset-password'))) return;
  const reset = await resetPassword(body.token, body.password);
  if (!reset) return reply.code(400).send({ error: 'INVALID_OR_EXPIRED_TOKEN' });
  return { status: 'password_updated' };
});

app.post('/v1/auth/logout', async (request, reply) => {
  const header = request.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
  const claims = token ? await verifyToken(token) : undefined;
  if (claims) await revokeSession(claims.sessionId, claims.userId);
  return { status: 'logged_out' };
});

app.get('/v1/me/sessions', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return { sessions: await listSessions(user.id) };
});

app.delete('/v1/me/sessions/:id', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const revoked = await revokeSession(params.id, user.id);
  if (!revoked) return reply.code(404).send({ error: 'SESSION_NOT_FOUND' });
  return { status: 'revoked', sessionId: params.id };
});

app.post('/v1/me/sessions/revoke-all', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const header = request.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
  const claims = token ? await verifyToken(token) : undefined;
  const revoked = await revokeAllSessions(user.id, claims?.sessionId);
  return { status: 'revoked', count: revoked };
});

app.get('/v1/me', async (request, reply) => {
  const user = await requireUser(request, reply);
  return user ? { user } : undefined;
});

app.get('/v1/me/export', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const payload = await exportUserData(user.id);
  if (!payload) return reply.code(404).send({ error: 'USER_NOT_FOUND' });
  reply.header('Content-Disposition', `attachment; filename="tacos-account-${user.id}.json"`);
  reply.type('application/json; charset=utf-8');
  return payload;
});

app.delete('/v1/me', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = z.object({ confirmation: z.literal('ELIMINAR') }).parse(request.body);
  const deleted = await deleteUserAccount(user.id);
  if (!deleted) return reply.code(404).send({ error: 'USER_NOT_FOUND' });
  return { status: 'deleted', confirmation: body.confirmation };
});

app.patch('/v1/me/profile', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = z.object({ displayName: z.string().trim().min(2).max(40) }).parse(request.body);
  const updated = await updateUserProfileForUser(user.id, body);
  if (!updated) return reply.code(404).send({ error: 'USER_NOT_FOUND' });
  return { user: updated };
});

app.get('/v1/me/privacy', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return { privacy: await getPrivacyForUser(user.id) };
});

app.patch('/v1/me/privacy', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = z.object({ shareActivity: z.boolean() }).parse(request.body);
  const privacy = await updatePrivacyForUser(user.id, body);
  if (!privacy) return reply.code(404).send({ error: 'USER_NOT_FOUND' });
  return { privacy };
});

app.get('/v1/discover', async (request) => {
  const query = z.object({ q: z.string().trim().max(120).optional(), lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(), radiusKm: z.coerce.number().min(0.1).max(50).optional(), offset: z.coerce.number().int().min(0).max(10000).default(0), openNow: z.enum(['true', 'false']).transform((value) => value === 'true').optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
  const user = await resolveUser(request);
  return { places: await discoverPlaces(query, user?.id), context: { query: query.q ?? null, personalized: Boolean(user), generatedAt: new Date().toISOString() } };
});

app.get('/v1/recommendations', async (request) => {
  const query = z.object({ lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional() }).parse(request.query);
  const user = await resolveUser(request);
  const location = query.lat != null && query.lng != null ? { latitude: query.lat, longitude: query.lng } : undefined;
  return { places: await getRecommendations(user?.id, location), context: { personalized: Boolean(user), hasLocation: Boolean(location), generatedAt: new Date().toISOString() } };
});

app.get('/v1/me/taste', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return { taste: await getTasteProfile(user.id) };
});

app.get('/v1/me/passport', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return getPassport(user.id);
});

app.get('/v1/branches/:id', async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const user = await resolveUser(request);
  const place = await findPlace(params.id, user?.id);
  if (!place) return reply.code(404).send({ error: 'BRANCH_NOT_FOUND' });
  return place;
});

app.get('/v1/branches/:id/google-photos', async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const place = await findPlace(params.id);
  if (!place) return reply.code(404).send({ error: 'BRANCH_NOT_FOUND' });
  if (isGooglePlacesConfigured() && !allowGooglePhotoRequest(request)) {
    reply.header('Retry-After', String(GOOGLE_PHOTO_WINDOW_MS / 1000));
    return reply.code(429).send({ error: 'GOOGLE_PHOTO_RATE_LIMIT' });
  }
  // Google photo references and URLs are runtime content. Do not let a proxy,
  // browser, or CDN turn this temporary fallback into a permanent catalog.
  reply.header('Cache-Control', 'no-store');
  return getGooglePlacePhotos({ name: place.name, address: place.address, coordinates: place.coordinates });
});

app.post('/v1/branches/:id/photos', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({
    // An 8 MB binary image expands by roughly 4/3 when sent as base64.
    // Keep the JSON request below Fastify's 12 MiB body limit.
    base64: z.string().min(1).max(12_000_000),
    contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    sourceType: z.enum(['community', 'owner']).default('community'),
    consentGranted: z.literal(true)
  }).parse(request.body);
  try {
    const uploaded = await uploadBranchPhotoImage({ userId: user.id, base64: body.base64, contentType: body.contentType });
    const photo = await createBranchPhotoForUser({ branchId: params.id, url: uploaded.url, sourceType: body.sourceType, consentGranted: true }, user.id, user.displayName);
    if (photo === 'not_found') return reply.code(404).send({ error: 'BRANCH_NOT_FOUND' });
    if (photo === 'branch_limit') return reply.code(409).send({ error: 'PHOTO_LIMIT_REACHED' });
    if (photo === 'rate_limited') {
      reply.header('Retry-After', '86400');
      return reply.code(429).send({ error: 'PHOTO_RATE_LIMIT' });
    }
    return reply.code(201).send(photo);
  } catch (error) {
    if (error instanceof Error && error.message === 'STORAGE_NOT_CONFIGURED') return reply.code(503).send({ error: 'PHOTO_STORAGE_UNAVAILABLE' });
    if (error instanceof Error && error.message === 'IMAGE_TOO_LARGE') return reply.code(413).send({ error: 'IMAGE_TOO_LARGE' });
    if (error instanceof Error && error.message === 'INVALID_IMAGE') return reply.code(400).send({ error: 'INVALID_IMAGE' });
    throw error;
  }
});

app.delete('/v1/branches/:branchId/photos/:photoId', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ branchId: z.string(), photoId: z.string().uuid() }).parse(request.params);
  const removed = await deleteBranchPhotoForUser(params.photoId, params.branchId, user.id, user.role === 'admin');
  if (!removed) return reply.code(404).send({ error: 'PHOTO_NOT_FOUND' });
  return { status: 'removed', photoId: params.photoId };
});

app.get('/v1/branches/:id/reviews', async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const reviews = await getBranchReviews(params.id);
  if (!reviews) return reply.code(404).send({ error: 'BRANCH_NOT_FOUND' });
  return { reviews };
});

app.get('/v1/me/saved', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return { placeIds: await getSavedPlaceIds(user.id) };
});

app.post('/v1/branches/:id/saved', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string() }).parse(request.params);
  const result = await savePlaceForUser(params.id, user.id);
  if (result === 'not_found') return reply.code(404).send({ error: 'BRANCH_NOT_FOUND' });
  return { status: result, placeId: params.id };
});

app.delete('/v1/branches/:id/saved', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string() }).parse(request.params);
  await unsavePlaceForUser(params.id, user.id);
  return { status: 'unsaved', placeId: params.id };
});

app.get('/v1/taquerias/:id', async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const taqueria = await getTaqueria(params.id);
  if (!taqueria) return reply.code(404).send({ error: 'TAQUERIA_NOT_FOUND' });
  return taqueria;
});

app.post('/v1/catalog/proposals', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = z.object({
    kind: z.enum(['branch', 'menu_item', 'correction']),
    branchId: z.string().optional(),
    payload: z.record(z.string(), z.unknown()).refine((value) => JSON.stringify(value).length <= 50_000, { message: 'Proposal payload is too large' }),
    evidenceUrl: z.string().url().max(2000).refine((value) => value.startsWith('https://'), { message: 'evidenceUrl must use HTTPS' }).optional()
  }).parse(request.body);
  const proposal = await createCatalogProposal(body, user.id);
  if (!proposal) return reply.code(404).send({ error: 'BRANCH_NOT_FOUND' });
  return reply.code(201).send(proposal);
});

app.post('/v1/visits', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = z.object({ placeId: z.string(), tacoIds: z.array(z.string()).default([]), rating: halfStarRating, categoryRatings: categoryRatingsSchema.optional(), tacoRatings: z.record(z.string(), z.number().min(1).max(5)).optional(), price: z.number().min(0).max(100000).optional(), note: z.string().trim().max(500).optional(), photoUrl: z.string().url().max(2000).optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }).parse(request.body);
  const place = await findPlace(body.placeId);
  if (!place) return reply.code(404).send({ error: 'BRANCH_NOT_FOUND' });
  const allowedTacos = new Set(place.tacos.map((taco) => taco.id));
  if (new Set(body.tacoIds).size !== body.tacoIds.length || body.tacoIds.some((tacoId) => !allowedTacos.has(tacoId))) {
    return reply.code(400).send({ error: 'INVALID_TACO' });
  }
  if (body.tacoRatings && Object.keys(body.tacoRatings).some((tacoId) => !body.tacoIds.includes(tacoId))) {
    return reply.code(400).send({ error: 'TACO_RATING_NOT_SELECTED' });
  }
  return reply.code(201).send(await createVisitForUser(body, user.id));
});

app.patch('/v1/visits/:id', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({ rating: halfStarRating.optional(), categoryRatings: categoryRatingsSchema.optional(), tacoRatings: z.record(z.string(), z.number().min(1).max(5)).optional(), price: z.number().min(0).max(100000).nullable().optional(), note: z.string().trim().max(500).optional() }).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' }).parse(request.body);
  const updated = await updateVisitForUser(params.id, body, user.id);
  if (updated === 'not_found') return reply.code(404).send({ error: 'VISIT_NOT_FOUND' });
  if (updated === 'invalid_taco') return reply.code(400).send({ error: 'TACO_RATING_NOT_SELECTED' });
  return updated;
});

app.delete('/v1/visits/:id', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const deleted = await deleteVisitForUser(params.id, user.id);
  if (!deleted) return reply.code(404).send({ error: 'VISIT_NOT_FOUND' });
  return { status: 'deleted', id: params.id };
});

app.post('/v1/media/images', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = z.object({ base64: z.string().min(1).max(11_000_000), contentType: z.enum(['image/jpeg', 'image/png', 'image/webp']) }).parse(request.body);
  try {
    return await uploadVisitImage({ userId: user.id, ...body });
  } catch (error) {
    if (error instanceof Error && error.message === 'STORAGE_NOT_CONFIGURED') return reply.code(503).send({ error: 'STORAGE_NOT_CONFIGURED' });
    if (error instanceof Error && error.message === 'IMAGE_TOO_LARGE') return reply.code(413).send({ error: 'IMAGE_TOO_LARGE' });
    if (error instanceof Error && error.message === 'INVALID_IMAGE') return reply.code(400).send({ error: 'INVALID_IMAGE' });
    throw error;
  }
});

app.get('/v1/diary', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return { entries: await getDiary(user.id) };
});

app.get('/v1/lists', async (request) => {
  const user = await resolveUser(request);
  return { lists: await getLists(user?.id) };
});

app.get('/v1/lists/:id', async (request, reply) => {
  const user = await resolveUser(request);
  const params = z.object({ id: z.string() }).parse(request.params);
  const detail = await getListDetails(params.id, user?.id);
  if (!detail) return reply.code(404).send({ error: 'LIST_NOT_FOUND' });
  return detail;
});

app.post('/v1/lists', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = z.object({ title: z.string().trim().min(2).max(80), description: z.string().trim().max(240).optional(), visibility: z.enum(['public', 'private']).default('public') }).parse(request.body);
  return reply.code(201).send(await createListForUser(body, user.id));
});

app.patch('/v1/lists/:id', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({ title: z.string().trim().min(2).max(80).optional(), description: z.string().trim().max(240).optional(), visibility: z.enum(['public', 'private']).optional() }).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' }).parse(request.body);
  const updated = await updateListForUser(params.id, body, user.id);
  if (!updated) return reply.code(404).send({ error: 'LIST_NOT_FOUND' });
  return updated;
});

app.post('/v1/lists/:id/collaborators', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ userId: z.string(), role: z.enum(['editor', 'viewer']).default('editor') }).parse(request.body);
  const result = await addListCollaborator(params.id, body.userId, body.role, user.id);
  if (result === 'not_allowed') return reply.code(403).send({ error: 'LIST_OWNER_REQUIRED' });
  if (result === 'not_found') return reply.code(404).send({ error: 'LIST_OR_USER_NOT_FOUND' });
  if (result === 'self') return reply.code(400).send({ error: 'OWNER_CANNOT_COLLABORATE' });
  return reply.code(result === 'added' ? 201 : 200).send({ status: result, listId: params.id, userId: body.userId, role: body.role });
});

app.delete('/v1/lists/:id/collaborators/:userId', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid(), userId: z.string() }).parse(request.params);
  const result = await removeListCollaborator(params.id, params.userId, user.id);
  if (result === 'not_allowed') return reply.code(403).send({ error: 'LIST_OWNER_REQUIRED' });
  if (result === 'not_found') return reply.code(404).send({ error: 'LIST_OR_COLLABORATOR_NOT_FOUND' });
  return { status: result, listId: params.id, userId: params.userId };
});

app.post('/v1/lists/:id/items', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string() }).parse(request.params);
  const body = z.object({ branchId: z.string(), note: z.string().max(240).optional() }).parse(request.body);
  const added = await addListItemForUser(params.id, body.branchId, user.id, body.note);
  if (!added) return reply.code(404).send({ error: 'LIST_OR_BRANCH_NOT_FOUND' });
  return { status: 'saved', listId: params.id, branchId: body.branchId };
});

app.delete('/v1/lists/:id/items/:branchId', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string(), branchId: z.string() }).parse(request.params);
  const removed = await removeListItemForUser(params.id, params.branchId, user.id);
  if (!removed) return reply.code(404).send({ error: 'LIST_OR_ITEM_NOT_FOUND' });
  return { status: 'removed', listId: params.id, branchId: params.branchId };
});

app.get('/v1/users/search', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const query = z.object({ q: z.string().min(2).max(60) }).parse(request.query);
  return { users: await searchUsers(query.q, user.id) };
});

app.get('/v1/users/:id/profile', async (request, reply) => {
  const viewer = await resolveUser(request);
  const params = z.object({ id: z.string() }).parse(request.params);
  const profile = await getUserProfile(params.id, viewer?.id);
  if (!profile) return reply.code(404).send({ error: 'USER_NOT_FOUND' });
  return profile;
});

app.post('/v1/users/:id/follow', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string() }).parse(request.params);
  const result = await followUser(user.id, params.id);
  if (result === 'self') return reply.code(400).send({ error: 'CANNOT_FOLLOW_SELF' });
  if (result === 'not_found') return reply.code(404).send({ error: 'USER_NOT_FOUND' });
  return { status: 'following', userId: params.id };
});

app.delete('/v1/users/:id/follow', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string() }).parse(request.params);
  await unfollowUser(user.id, params.id);
  return { status: 'unfollowed', userId: params.id };
});

app.get('/v1/feed', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  return { items: await getFeed(user.id) };
});

app.get('/v1/visits/:id/comments', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const comments = await getVisitComments(params.id, user.id);
  if (!comments) return reply.code(404).send({ error: 'VISIT_NOT_FOUND' });
  return { comments };
});

app.post('/v1/visits/:id/comments', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ body: z.string().trim().min(1).max(500) }).parse(request.body);
  const comment = await createVisitComment(params.id, body.body, user.id);
  if (!comment) return reply.code(404).send({ error: 'VISIT_NOT_FOUND' });
  return reply.code(201).send(comment);
});

app.delete('/v1/comments/:id', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const deleted = await deleteVisitComment(params.id, user.id);
  if (!deleted) return reply.code(404).send({ error: 'COMMENT_NOT_FOUND' });
  return { status: 'deleted', commentId: params.id };
});

app.post('/v1/reports', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = z.object({ visitId: z.string().uuid(), reason: z.enum(['spam', 'inappropriate', 'wrong_place', 'other']), details: z.string().max(500).optional() }).parse(request.body);
  const result = await reportVisitForUser(body, user.id);
  if (result === 'not_found') return reply.code(404).send({ error: 'VISIT_NOT_FOUND' });
  return reply.code(result === 'created' ? 201 : 200).send({ status: result, visitId: body.visitId });
});

app.get('/v1/admin/analytics', async (request, reply) => {
  const user = await requireAdmin(request, reply);
  if (!user) return;
  const query = z.object({ days: z.coerce.number().int().min(1).max(90).default(14) }).parse(request.query);
  return { analytics: await getAdminAnalytics(query.days) };
});

app.get('/v1/admin/photos', async (request, reply) => {
  const user = await requireAdmin(request, reply);
  if (!user) return;
  const query = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'removed', 'all']).default('pending') }).parse(request.query);
  return { photos: await getAdminBranchPhotos(query.status) };
});

app.patch('/v1/admin/photos/:id', async (request, reply) => {
  const user = await requireAdmin(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ action: z.enum(['approve', 'reject']), moderationNote: z.string().trim().max(500).optional() }).parse(request.body);
  const updated = await reviewBranchPhoto(params.id, body.action, user.id, body.moderationNote ?? '');
  if (!updated) return reply.code(404).send({ error: 'PHOTO_NOT_FOUND_OR_ALREADY_REVIEWED' });
  return { status: body.action === 'approve' ? 'approved' : 'rejected', photoId: params.id };
});

app.get('/v1/admin/reports', async (request, reply) => {
  const user = await requireAdmin(request, reply);
  if (!user) return;
  const query = z.object({ status: z.enum(['open', 'reviewed', 'dismissed', 'all']).default('open') }).parse(request.query);
  return { reports: await getAdminReports(query.status) };
});

app.patch('/v1/admin/reports/:id', async (request, reply) => {
  const user = await requireAdmin(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ action: z.enum(['hide', 'dismiss']) }).parse(request.body);
  const updated = await reviewAdminReport(params.id, body.action);
  if (!updated) return reply.code(404).send({ error: 'REPORT_NOT_FOUND' });
  return { status: body.action === 'hide' ? 'hidden' : 'dismissed', reportId: params.id };
});

app.get('/v1/admin/comments', async (request, reply) => {
  const user = await requireAdmin(request, reply);
  if (!user) return;
  const query = z.object({ visibility: z.enum(['visible', 'hidden', 'all']).default('visible') }).parse(request.query);
  return { comments: await getAdminComments(query.visibility) };
});

app.get('/v1/admin/catalog/proposals', async (request, reply) => {
  const user = await requireAdmin(request, reply);
  if (!user) return;
  const query = z.object({ status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending') }).parse(request.query);
  return { proposals: await getCatalogProposals(query.status) };
});

app.patch('/v1/admin/catalog/proposals/:id', async (request, reply) => {
  const user = await requireAdmin(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ action: z.enum(['approve', 'reject']), reviewNote: z.string().trim().max(500).optional() }).parse(request.body);
  try {
    const updated = await reviewCatalogProposal(params.id, body.action, user.id, body.reviewNote);
    if (!updated) return reply.code(404).send({ error: 'PROPOSAL_NOT_FOUND' });
    return { status: body.action === 'approve' ? 'approved' : 'rejected', proposalId: params.id };
  } catch (error) {
    if (error instanceof Error && /propuesta|sucursal|taco|campos editables|coordenadas|horario|hora de cierre|imagen|campo .*no es válido|rango de precios|tags/.test(error.message)) return reply.code(400).send({ error: 'INVALID_PROPOSAL', message: error.message });
    throw error;
  }
});

app.patch('/v1/admin/comments/:id', async (request, reply) => {
  const user = await requireAdmin(request, reply);
  if (!user) return;
  const params = z.object({ id: z.string().uuid() }).parse(request.params);
  const body = z.object({ action: z.enum(['hide', 'restore']) }).parse(request.body);
  const updated = await reviewAdminComment(params.id, body.action);
  if (!updated) return reply.code(404).send({ error: 'COMMENT_NOT_FOUND' });
  return { status: body.action === 'hide' ? 'hidden' : 'visible', commentId: params.id };
});

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });

let shuttingDown = false;
async function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  await app.close();
  await closeRepository();
  process.exit(0);
}
process.once('SIGTERM', () => { void shutdown(); });
process.once('SIGINT', () => { void shutdown(); });
