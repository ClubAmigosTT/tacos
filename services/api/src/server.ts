import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { addListCollaborator, addListItemForUser, authenticateUser, closeRepository, createListForUser, createVisitComment, createVisitForUser, deleteVisitComment, deleteVisitForUser, discoverPlaces, findPlace, findUserById, followUser, getAdminAnalytics, getAdminComments, getAdminReports, getBranchReviews, getDiary, getFeed, getHealth, getListDetails, getLists, getPassport, getPrivacyForUser, getRecommendations, getSavedPlaceIds, getTaqueria, getTasteProfile, getUserProfile, getVisitComments, recordProductEvent, registerUser, removeListCollaborator, removeListItemForUser, reportVisitForUser, reviewAdminComment, reviewAdminReport, savePlaceForUser, searchUsers, unfollowUser, unsavePlaceForUser, updateListForUser, updatePrivacyForUser, updateUserProfileForUser, updateVisitForUser, type PublicUser } from './repository.js';
import { issueToken, verifyToken } from './auth.js';
import { uploadVisitImage } from './storage.js';

const app = Fastify({ logger: true, bodyLimit: 12 * 1024 * 1024 });
await app.register(cors, { origin: true });

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
  const userId = token ? await verifyToken(token) : undefined;
  return userId ? findUserById(userId) : undefined;
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
  try {
    const user = await registerUser(body);
    return reply.code(201).send({ user, token: await issueToken(user) });
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_TAKEN') return reply.code(409).send({ error: 'EMAIL_TAKEN' });
    throw error;
  }
});

app.post('/v1/auth/login', async (request, reply) => {
  const body = z.object({ email: z.string().email().max(320), password: z.string().min(1).max(128) }).parse(request.body);
  const user = await authenticateUser(body);
  if (!user) return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
  return { user, token: await issueToken(user) };
});

app.get('/v1/me', async (request, reply) => {
  const user = await requireUser(request, reply);
  return user ? { user } : undefined;
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
  const query = z.object({ q: z.string().optional(), lat: z.coerce.number().optional(), lng: z.coerce.number().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
  const user = await resolveUser(request);
  return { places: await discoverPlaces(query, user?.id), context: { query: query.q ?? null, personalized: Boolean(user), generatedAt: new Date().toISOString() } };
});

app.get('/v1/recommendations', async (request) => {
  const user = await resolveUser(request);
  return { places: await getRecommendations(user?.id), context: { personalized: Boolean(user), generatedAt: new Date().toISOString() } };
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

app.post('/v1/visits', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = z.object({ placeId: z.string(), tacoIds: z.array(z.string()).min(1), rating: z.number().min(1).max(5), tacoRatings: z.record(z.string(), z.number().min(1).max(5)).optional(), price: z.number().min(0).max(100000).optional(), note: z.string().trim().max(500).optional(), photoUrl: z.string().url().max(2000).optional(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }).parse(request.body);
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
  const body = z.object({ rating: z.number().min(1).max(5).optional(), tacoRatings: z.record(z.string(), z.number().min(1).max(5)).optional(), price: z.number().min(0).max(100000).nullable().optional(), note: z.string().trim().max(500).optional() }).refine((value) => Object.keys(value).length > 0, { message: 'At least one field is required' }).parse(request.body);
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
