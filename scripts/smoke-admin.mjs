const baseUrl = process.env.SMOKE_API_URL ?? 'http://127.0.0.1:4000';
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

const register = (email, displayName) => request('/v1/auth/register', {
  method: 'POST',
  body: JSON.stringify({ email, password: 'password123', displayName })
}, 201);

const admin = await register('admin-smoke@example.com', 'Admin Smoke');
const author = await register(`author-${suffix}@example.com`, 'Author Smoke');
const viewer = await register(`viewer-${suffix}@example.com`, 'Viewer Smoke');

await request(`/v1/users/${author.user.id}/follow`, { method: 'POST', body: JSON.stringify({}), token: viewer.token });
const visit = await request('/v1/visits', {
  method: 'POST',
  body: JSON.stringify({ placeId: 'vilsito', tacoIds: ['vilsito-pastor'], tacoRatings: { 'vilsito-pastor': 1 }, rating: 1, note: 'Needs review' }),
  token: author.token
}, 201);
const feedBefore = await request('/v1/feed', { token: viewer.token });
if (feedBefore.items?.length !== 1) throw new Error('Admin smoke did not create a visible feed item');
const recommendationsBefore = await request('/v1/recommendations', { token: viewer.token });
if (typeof recommendationsBefore.places?.find((place) => place.id === 'vilsito')?.socialMatch !== 'number') throw new Error('Visible social signal was not calculated');
await request('/v1/admin/reports', { token: viewer.token }, 403);
const report = await request('/v1/reports', { method: 'POST', body: JSON.stringify({ visitId: visit.id, reason: 'other' }), token: viewer.token }, 201);
const queue = await request('/v1/admin/reports', { token: admin.token });
const queuedReport = queue.reports?.find((item) => item.visitId === report.visitId && item.status === 'open');
if (!queuedReport) throw new Error('Admin report queue did not include the report');
const review = await request(`/v1/admin/reports/${queuedReport.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'hide' }), token: admin.token });
if (review.status !== 'hidden') throw new Error('Admin hide action failed');
const feedAfter = await request('/v1/feed', { token: viewer.token });
if (feedAfter.items?.length !== 0) throw new Error('Hidden visit still appears in feed');
const recommendationsAfter = await request('/v1/recommendations', { token: viewer.token });
if (recommendationsAfter.places?.some((place) => typeof place.socialMatch === 'number')) throw new Error('Hidden visit still contributes a social recommendation signal');
const diary = await request('/v1/diary', { token: author.token });
if (diary.entries?.length !== 1) throw new Error('Hidden visit was removed from the author diary');

console.log(`Admin smoke passed: ${baseUrl}`);
