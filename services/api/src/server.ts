import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { authenticateUser, createVisitForUser, discoverPlaces, findPlace, findUserById, getDiary, registerUser, type PublicUser } from './repository.js';
import { issueToken, verifyToken } from './auth.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

declare module 'fastify' {
  interface FastifyRequest { user?: PublicUser }
}

async function requireUser(request: FastifyRequest, reply: FastifyReply) {
  const header = request.headers.authorization;
  const token = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : undefined;
  const userId = token ? await verifyToken(token) : undefined;
  const user = userId ? await findUserById(userId) : undefined;
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

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
