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

const catalogProposal = await request('/v1/catalog/proposals', {
  method: 'POST',
  body: JSON.stringify({ kind: 'menu_item', branchId: 'vilsito', payload: { name: `Taco smoke ${suffix}`, price: 27, note: 'Propuesta de prueba' }, evidenceUrl: 'https://example.com/catalog-smoke' }),
  token: viewer.token
}, 201);
await request('/v1/admin/catalog/proposals', { token: viewer.token }, 403);
const catalogQueue = await request('/v1/admin/catalog/proposals', { token: admin.token });
if (!catalogQueue.proposals?.some((proposal) => proposal.id === catalogProposal.id && proposal.status === 'pending')) throw new Error('Admin catalog queue did not include the pending proposal');
const approvedCatalogProposal = await request(`/v1/admin/catalog/proposals/${catalogProposal.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve', reviewNote: 'Datos comprobados' }), token: admin.token });
if (approvedCatalogProposal.status !== 'approved') throw new Error('Admin catalog approval failed');
const catalogAfterApproval = await request('/v1/branches/vilsito');
if (!catalogAfterApproval.tacos?.some((taco) => taco.id === `community-${catalogProposal.id}`)) throw new Error('Approved catalog taco was not published');

const branchProposal = await request('/v1/catalog/proposals', {
  method: 'POST',
  body: JSON.stringify({ kind: 'branch', payload: { name: `Tacos smoke ${suffix}`, neighborhood: 'Roma Sur', address: 'Calle de prueba 123', latitude: 19.4055, longitude: -99.1622 }, evidenceUrl: 'https://example.com/branch-smoke' }),
  token: viewer.token
}, 201);
await request(`/v1/admin/catalog/proposals/${branchProposal.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'approve' }), token: admin.token });
const communityBranchId = `community-${branchProposal.id}`;
const communityBranch = await request(`/v1/branches/${communityBranchId}`);
if (communityBranch.rating !== 0 || communityBranch.match !== undefined) throw new Error('Approved community branch exposed an invented score');
const communityTaqueria = await request(`/v1/taquerias/${communityBranchId}`);
if (communityTaqueria.branchCount !== 1 || communityTaqueria.branches?.[0]?.id !== communityBranchId) throw new Error('Approved community branch was not available through its taqueria');

await request('/v1/events', { method: 'POST', body: JSON.stringify({ eventName: 'app_open', properties: { source: 'admin-smoke' } }), token: viewer.token }, 202);
await request('/v1/admin/analytics', { token: viewer.token }, 403);
const analytics = await request('/v1/admin/analytics', { token: admin.token });
if (analytics.analytics?.totalEvents < 1 || !analytics.analytics?.byEvent?.some((event) => event.eventName === 'app_open')) throw new Error('Admin analytics did not aggregate product events');

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
const comment = await request(`/v1/visits/${visit.id}/comments`, { method: 'POST', body: JSON.stringify({ body: 'Comentario moderable' }), token: viewer.token }, 201);
const commentQueue = await request('/v1/admin/comments', { token: admin.token });
if (!commentQueue.comments?.some((item) => item.id === comment.id && item.visibility === 'visible')) throw new Error('Admin comment queue did not include the comment');
await request('/v1/admin/comments', { token: viewer.token }, 403);
const hiddenComment = await request(`/v1/admin/comments/${comment.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'hide' }), token: admin.token });
if (hiddenComment.status !== 'hidden') throw new Error('Admin comment hide action failed');
const commentsAfterHide = await request(`/v1/visits/${visit.id}/comments`, { token: viewer.token });
if (commentsAfterHide.comments?.length !== 0) throw new Error('Hidden comment still appeared in conversation');
const restoredComment = await request(`/v1/admin/comments/${comment.id}`, { method: 'PATCH', body: JSON.stringify({ action: 'restore' }), token: admin.token });
if (restoredComment.status !== 'visible') throw new Error('Admin comment restore action failed');
const commentsAfterRestore = await request(`/v1/visits/${visit.id}/comments`, { token: viewer.token });
if (commentsAfterRestore.comments?.length !== 1) throw new Error('Restored comment did not return to conversation');
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
const publicProfile = await request(`/v1/users/${author.user.id}/profile`, { token: viewer.token });
if (publicProfile.stats?.visits !== 0) throw new Error('Hidden visit still contributes to public profile stats');

console.log(`Admin smoke passed: ${baseUrl}`);
