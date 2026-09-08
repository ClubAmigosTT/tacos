import Fastify from 'fastify';
import cors from '@fastify/cors';
import { z } from 'zod';
import { createVisit, discoverPlaces, findPlace } from './repository.js';

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });

app.get('/health', async () => ({ status: 'ok', service: 'tacos-api', timestamp: new Date().toISOString() }));

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
  const body = z.object({ placeId: z.string(), tacoIds: z.array(z.string()).min(1), rating: z.number().min(1).max(5) }).parse(request.body);
  const place = await findPlace(body.placeId);
  if (!place) return reply.code(404).send({ error: 'BRANCH_NOT_FOUND' });
  return reply.code(201).send(await createVisit(body));
});

const port = Number(process.env.PORT ?? 4000);
await app.listen({ port, host: '0.0.0.0' });
