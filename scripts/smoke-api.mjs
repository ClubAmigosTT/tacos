const baseUrl = (process.env.TACOS_API_URL ?? 'http://127.0.0.1:4000').replace(/\/$/, '');
const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function request(path, options = {}, expectedStatus = 200) {
  const { token, ...init } = options;
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {})
    }
  });
  const body = await response.json().catch(() => ({}));
  if (response.status !== expectedStatus) throw new Error(`${options.method ?? 'GET'} ${path}: expected ${expectedStatus}, got ${response.status} ${JSON.stringify(body)}`);
  return body;
}

const createUser = (name, prefix) => request('/v1/auth/register', {
  method: 'POST',
  body: JSON.stringify({ email: `${prefix}-${suffix}@example.com`, password: 'password123', displayName: name })
}, 201);

const health = await request('/health');
if (health.status !== 'ok') throw new Error('Health check did not return ok');

const alice = await createUser('Ana Smoke', 'ana');
const bob = await createUser('Beto Smoke', 'beto');
const nearby = await request('/v1/discover?lat=19.3869&lng=-99.1571&limit=3');
if (nearby.places?.[0]?.id !== 'vilsito') throw new Error('Nearby discovery did not prioritize El Vilsito');

await request(`/v1/users/${bob.user.id}/follow`, { method: 'POST', body: JSON.stringify({}), token: alice.token });
await request('/v1/visits', {
  method: 'POST',
  body: JSON.stringify({ placeId: 'vilsito', tacoIds: ['vilsito-pastor'], tacoRatings: { 'vilsito-pastor': 5 }, rating: 5, price: 44, note: 'Smoke test' }),
  token: bob.token
}, 201);

const feed = await request('/v1/feed', { token: alice.token });
if (feed.items?.length !== 1) throw new Error(`Expected one feed item, got ${feed.items?.length ?? 0}`);
const diary = await request('/v1/diary', { token: bob.token });
if (diary.entries?.[0]?.price !== 44 || diary.entries?.[0]?.note !== 'Smoke test') throw new Error('Diary context was not persisted');
const recommendations = await request('/v1/recommendations', { token: bob.token });
if (typeof recommendations.places?.[0]?.tasteMatch !== 'number') throw new Error('Taste-aware recommendation score missing');
const taste = await request('/v1/me/taste', { token: bob.token });
if (!taste.taste?.title) throw new Error('Taste profile missing');
await request(`/v1/users/${bob.user.id}/follow`, { method: 'DELETE', token: alice.token });

console.log(`API smoke passed: ${baseUrl}`);
