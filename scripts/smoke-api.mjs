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
const taqueria = await request('/v1/taquerias/vilsito');
if (taqueria.branches?.[0]?.taqueriaId !== 'vilsito') throw new Error('Taqueria parent relation missing');

await request(`/v1/users/${bob.user.id}/follow`, { method: 'POST', body: JSON.stringify({}), token: alice.token });
const visit = await request('/v1/visits', {
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
const report = await request('/v1/reports', { method: 'POST', body: JSON.stringify({ visitId: visit.id, reason: 'other' }), token: alice.token }, 201);
if (report.status !== 'created') throw new Error('Report was not created');
const duplicateReport = await request('/v1/reports', { method: 'POST', body: JSON.stringify({ visitId: visit.id, reason: 'other' }), token: alice.token });
if (duplicateReport.status !== 'duplicate') throw new Error('Duplicate report was not deduplicated');
const list = await request('/v1/lists', {
  method: 'POST',
  body: JSON.stringify({ title: 'Smoke route', description: 'Lista de prueba' }),
  token: bob.token
}, 201);
await request(`/v1/lists/${list.id}/items`, {
  method: 'POST',
  body: JSON.stringify({ branchId: 'vilsito', note: 'Pedir pastor' }),
  token: bob.token
});
const listDetail = await request(`/v1/lists/${list.id}`, { token: alice.token });
if (listDetail.items?.[0]?.branchId !== 'vilsito') throw new Error('Public list detail did not include its place');
const publicLists = await request('/v1/lists');
if (!publicLists.lists?.some((item) => item.id === list.id) || publicLists.lists?.some((item) => item.visibility === 'private')) throw new Error('Public list discovery leaked or omitted a list');
const privateList = await request('/v1/lists', { method: 'POST', body: JSON.stringify({ title: 'Private route', visibility: 'private' }), token: bob.token }, 201);
await request(`/v1/lists/${privateList.id}`, { token: alice.token }, 404);
const privateDetail = await request(`/v1/lists/${privateList.id}`, { token: bob.token });
if (privateDetail.visibility !== 'private') throw new Error('Private list visibility was not preserved');
await request(`/v1/users/${bob.user.id}/follow`, { method: 'DELETE', token: alice.token });

console.log(`API smoke passed: ${baseUrl}`);
