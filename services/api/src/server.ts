import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { addListItemForUser, authenticateUser, createListForUser, createVisitForUser, discoverPlaces, findPlace, findUserById, followUser, getDiary, getFeed, getLists, registerUser, searchUsers, unfollowUser, type PublicUser } from './repository.js';
import { issueToken, verifyToken } from './auth.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.setErrorHandler((error, request, reply) => {
  if (error instanceof z.ZodError) {
    return reply.code(400).send({ error: 'INVALID_REQUEST', issues: error.issues });
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

app.get('/health', async () => ({ status: 'ok', service: 'tacos-api', timestamp: new Date().toISOString() }));

app.post('/v1/auth/register', async (request, reply) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(8), displayName: z.string().min(2).max(40) }).parse(request.body);
  try {
    const user = await registerUser(body);
    return reply.code(201).send({ user, token: await issueToken(user) });
  } catch (error) {
    if (error instanceof Error && error.message === 'EMAIL_TAKEN') return reply.code(409).send({ error: 'EMAIL_TAKEN' });
    throw error;
  }
});

app.post('/v1/auth/login', async (request, reply) => {
  const body = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(request.body);
  const user = await authenticateUser(body);
  if (!user) return reply.code(401).send({ error: 'INVALID_CREDENTIALS' });
  return { user, token: await issueToken(user) };
});

app.get('/v1/me', async (request, reply) => {
  const user = await requireUser(request, reply);
  return user ? { user } : undefined;
});

app.get('/v1/discover', async (request) => {
  const query = z.object({ q: z.string().optional(), lat: z.coerce.number().optional(), lng: z.coerce.number().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
  return { places: await discoverPlaces(query), context: { query: query.q ?? null, generatedAt: new Date().toISOString() } };
});

app.get('/v1/branches/:id', async (request, reply) => {
  const params = z.object({ id: z.string() }).parse(request.params);
  const place = await findPlace(params.id);
  if (!place) return reply.code(404).send({ error: 'BRANCH_NOT_FOUND' });
  return place;
});

app.post('/v1/visits', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = z.object({ placeId: z.string(), tacoIds: z.array(z.string()).min(1), rating: z.number().min(1).max(5) }).parse(request.body);
  const place = await findPlace(body.placeId);
  if (!place) return reply.code(404).send({ error: 'BRANCH_NOT_FOUND' });
  return reply.code(201).send(await createVisitForUser(body, user.id));
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

app.post('/v1/lists', async (request, reply) => {
  const user = await requireUser(request, reply);
  if (!user) return;
  const body = z.object({ title: z.string().min(2).max(80), description: z.string().max(240).optional(), visibility: z.enum(['public', 'private']).default('public') }).parse(request.body);
  return reply.code(201).send(await createListForUser(body, user.id));
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

app.get('/v1/users/search', async (request) => {
  const user = await resolveUser(request);
  const query = z.object({ q: z.string().min(2).max(60) }).parse(request.query);
  return { users: await searchUsers(query.q, user?.id) };
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

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
