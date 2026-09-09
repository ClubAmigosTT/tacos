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
if (health.status !== 'ok' || !['memory', 'postgres'].includes(health.database)) throw new Error('Health check did not return a usable database status');
await request('/v1/users/search?q=Ana', {}, 401);
await request('/v1/events', {
  method: 'POST',
  body: JSON.stringify({ eventName: 'map_filter', properties: { filter: 'Pastor', query_length: 6, email: 'must-not-be-stored' } })
}, 202);
await request('/v1/events', {
  method: 'POST',
  body: JSON.stringify({ eventName: 'not_a_product_event' })
}, 400);
await request('/v1/events', {
  method: 'POST',
  body: '{"eventName":'
}, 400);
await request('/v1/auth/register', {
  method: 'POST',
  body: JSON.stringify({ email: `oversized-${suffix}@example.com`, password: 'x'.repeat(129), displayName: 'Input Smoke' })
}, 400);

const alice = await createUser('Ana Smoke', 'ana');
const bobDisplayName = `Beto Smoke ${suffix}`;
const bob = await createUser(bobDisplayName, 'beto');
const updatedProfile = await request('/v1/me/profile', { method: 'PATCH', body: JSON.stringify({ displayName: 'Ana Editada' }), token: alice.token });
if (updatedProfile.user?.displayName !== 'Ana Editada') throw new Error('Profile name was not updated');
const meAfterProfileUpdate = await request('/v1/me', { token: alice.token });
if (meAfterProfileUpdate.user?.displayName !== 'Ana Editada') throw new Error('Updated profile was not reflected in the session');
await request('/v1/me/profile', { method: 'PATCH', body: JSON.stringify({ displayName: 'A' }), token: alice.token }, 400);
const nearby = await request('/v1/discover?lat=19.3869&lng=-99.1571&limit=3');
if (nearby.places?.[0]?.id !== 'vilsito') throw new Error('Nearby discovery did not prioritize El Vilsito');
const tacoSearch = await request('/v1/discover?q=suadero&limit=10');
if (!['vilsito', 'oriente'].every((placeId) => tacoSearch.places?.some((place) => place.id === placeId))) throw new Error('Menu-item discovery did not find every branch serving suadero');
const contextualSearch = await request('/v1/discover?q=grínga%20narvarte&limit=10');
if (contextualSearch.places?.length !== 1 || contextualSearch.places[0]?.id !== 'vilsito') throw new Error('Multi-term contextual search did not combine taco and neighborhood');
const saved = await request('/v1/branches/vilsito/saved', { method: 'POST', token: bob.token });
if (saved.status !== 'saved') throw new Error('Place was not saved');
const savedPlaces = await request('/v1/me/saved', { token: bob.token });
if (!savedPlaces.placeIds?.includes('vilsito')) throw new Error('Saved places were not returned');
const savedAgain = await request('/v1/branches/vilsito/saved', { method: 'POST', token: bob.token });
if (savedAgain.status !== 'already_saved') throw new Error('Duplicate saved place was not idempotent');
await request('/v1/branches/vilsito/saved', { method: 'DELETE', token: bob.token });
const unsavedPlaces = await request('/v1/me/saved', { token: bob.token });
if (unsavedPlaces.placeIds?.includes('vilsito')) throw new Error('Place was not removed from saved places');
const taqueria = await request('/v1/taquerias/vilsito');
if (taqueria.branches?.[0]?.taqueriaId !== 'vilsito') throw new Error('Taqueria parent relation missing');
const vilsitoDetail = await request('/v1/branches/vilsito');
if (!vilsitoDetail.tacos?.some((taco) => taco.id === 'vilsito-queso' && taco.name === 'Gringa')) throw new Error('Catalog seed is missing the Vilsito Gringa');

await request(`/v1/users/${bob.user.id}/follow`, { method: 'POST', body: JSON.stringify({}), token: alice.token });
const peopleSearch = await request(`/v1/users/search?q=${encodeURIComponent(suffix)}`, { token: alice.token });
if (peopleSearch.users?.[0]?.following !== true) throw new Error('Following state was not returned by people search');
await request('/v1/visits', {
  method: 'POST',
  body: JSON.stringify({ placeId: 'vilsito', tacoIds: ['oriente-suadero'], rating: 5 }),
  token: bob.token
}, 400);
const visit = await request('/v1/visits', {
  method: 'POST',
  body: JSON.stringify({ placeId: 'vilsito', tacoIds: ['vilsito-pastor'], tacoRatings: { 'vilsito-pastor': 5 }, rating: 5, price: 44, note: 'Smoke test' }),
  token: bob.token
}, 201);
const personalizedDiscover = await request('/v1/discover?limit=3', { token: bob.token });
if (personalizedDiscover.context?.personalized !== true || !personalizedDiscover.places?.some((place) => typeof place.tasteMatch === 'number')) throw new Error('Authenticated discovery did not expose the user affinity score');
const personalizedDetail = await request('/v1/branches/vilsito', { token: bob.token });
if (typeof personalizedDetail.tasteMatch !== 'number') throw new Error('Authenticated branch detail did not expose taste affinity');
const passport = await request('/v1/me/passport', { token: bob.token });
if (passport.visitedZones !== 1 || !passport.zones?.some((zone) => zone.name === 'Narvarte' && zone.unlocked && zone.visitCount === 1)) throw new Error('Passport did not derive unlocked zones from the visible diary');
const branchReviews = await request('/v1/branches/vilsito/reviews');
if (!branchReviews.reviews?.some((review) => review.id === visit.id && review.note === 'Smoke test' && review.user?.id === bob.user.id)) throw new Error('Public branch reviews did not include the visible visit');
await request('/v1/branches/branch-does-not-exist/reviews', {}, 404);
const reputationAfterFirstReview = await request('/v1/discover?limit=3');
const vilsitoAfterFirstReview = reputationAfterFirstReview.places?.find((place) => place.id === 'vilsito');
const pastorAfterFirstReview = vilsitoAfterFirstReview?.tacos?.find((taco) => taco.id === 'vilsito-pastor');
if (Number(vilsitoAfterFirstReview?.rating) < 4.6 || Number(pastorAfterFirstReview?.rating) < 4.7) throw new Error('A single review artificially displaced the seeded reputation prior');

const feed = await request('/v1/feed', { token: alice.token });
if (feed.items?.length !== 1 || feed.items?.[0]?.note !== 'Smoke test') throw new Error(`Expected one feed item with its note, got ${feed.items?.length ?? 0}`);
const comment = await request(`/v1/visits/${visit.id}/comments`, {
  method: 'POST',
  body: JSON.stringify({ body: 'Gran elección, Beto.' }),
  token: alice.token
}, 201);
const comments = await request(`/v1/visits/${visit.id}/comments`, { token: alice.token });
if (comments.comments?.length !== 1 || comments.comments?.[0]?.body !== 'Gran elección, Beto.' || comments.comments?.[0]?.own !== true) throw new Error('Visit comment was not persisted');
const feedWithComment = await request('/v1/feed', { token: alice.token });
if (feedWithComment.items?.[0]?.comment_count !== 1) throw new Error('Feed comment count was not updated');
await request(`/v1/comments/${comment.id}`, { method: 'DELETE', token: bob.token }, 404);
await request(`/v1/comments/${comment.id}`, { method: 'DELETE', token: alice.token });
const privacy = await request('/v1/me/privacy', { token: bob.token });
if (privacy.privacy?.shareActivity !== true) throw new Error('Privacy defaults were not returned');
await request('/v1/me/privacy', { method: 'PATCH', body: JSON.stringify({ shareActivity: false }), token: bob.token });
const hiddenFeed = await request('/v1/feed', { token: alice.token });
if (hiddenFeed.items?.length !== 0) throw new Error('Private activity still appeared in the feed');
const hiddenBranchReviews = await request('/v1/branches/vilsito/reviews');
if (hiddenBranchReviews.reviews?.some((review) => review.id === visit.id)) throw new Error('Private activity still appeared in branch reviews');
const hiddenProfile = await request(`/v1/users/${bob.user.id}/profile`, { token: alice.token });
if (hiddenProfile.stats?.visits !== 0 || hiddenProfile.stats?.averageRating !== null) throw new Error('Private activity still appeared in the public profile aggregates');
const ownerProfileWhilePrivate = await request(`/v1/users/${bob.user.id}/profile`, { token: bob.token });
if (ownerProfileWhilePrivate.stats?.visits !== 1 || ownerProfileWhilePrivate.stats?.averageRating !== 5) throw new Error('Owner lost access to their own private profile aggregates');
const hiddenRecommendations = await request('/v1/recommendations', { token: alice.token });
if (hiddenRecommendations.places?.some((place) => typeof place.socialMatch === 'number')) throw new Error('Private activity still influenced social recommendations');
await request('/v1/me/privacy', { method: 'PATCH', body: JSON.stringify({ shareActivity: true }), token: bob.token });
const restoredFeed = await request('/v1/feed', { token: alice.token });
if (restoredFeed.items?.length !== 1) throw new Error('Activity did not return after privacy was restored');
const diary = await request('/v1/diary', { token: bob.token });
if (diary.entries?.[0]?.price !== 44 || diary.entries?.[0]?.note !== 'Smoke test') throw new Error('Diary context was not persisted');
const editedVisit = await request(`/v1/visits/${visit.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ rating: 4, price: 52, note: 'Edited smoke' }),
  token: bob.token
});
if (editedVisit.status !== 'updated') throw new Error('Visit owner could not edit the diary entry');
await request(`/v1/visits/${visit.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ rating: 3 }),
  token: alice.token
}, 404);
await request(`/v1/visits/${visit.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ tacoRatings: { 'oriente-suadero': 5 } }),
  token: bob.token
}, 400);
const editedDiary = await request('/v1/diary', { token: bob.token });
if (editedDiary.entries?.[0]?.rating !== 4 || editedDiary.entries?.[0]?.price !== 52 || editedDiary.entries?.[0]?.note !== 'Edited smoke') throw new Error('Edited diary context was not persisted');
const deletableVisit = await request('/v1/visits', {
  method: 'POST',
  body: JSON.stringify({ placeId: 'oriente', tacoIds: ['oriente-suadero'], tacoRatings: { 'oriente-suadero': 4 }, rating: 4 }),
  token: bob.token
}, 201);
await request(`/v1/visits/${deletableVisit.id}`, { method: 'DELETE', token: alice.token }, 404);
const deletedVisit = await request(`/v1/visits/${deletableVisit.id}`, { method: 'DELETE', token: bob.token });
if (deletedVisit.status !== 'deleted') throw new Error('Visit owner could not delete the diary entry');
await request(`/v1/visits/${deletableVisit.id}`, { method: 'DELETE', token: bob.token }, 404);
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
await request('/v1/lists', {
  method: 'POST',
  body: JSON.stringify({ title: '  ' }),
  token: bob.token
}, 400);
await request(`/v1/lists/${list.id}/items`, {
  method: 'POST',
  body: JSON.stringify({ branchId: 'vilsito', note: 'Pedir pastor' }),
  token: bob.token
});
await request(`/v1/lists/${list.id}/items`, {
  method: 'POST',
  body: JSON.stringify({ branchId: 'branch-does-not-exist' }),
  token: bob.token
}, 404);
const listDetail = await request(`/v1/lists/${list.id}`, { token: alice.token });
if (listDetail.items?.[0]?.branchId !== 'vilsito') throw new Error('Public list detail did not include its place');
const bobProfile = await request(`/v1/users/${bob.user.id}/profile`, { token: alice.token });
if (bobProfile.user?.displayName !== bobDisplayName || bobProfile.user?.following !== true || bobProfile.lists?.some((item) => item.visibility === 'private')) throw new Error('Public user profile leaked private data or is incomplete');
const publicLists = await request('/v1/lists');
if (!publicLists.lists?.some((item) => item.id === list.id) || publicLists.lists?.some((item) => item.visibility === 'private')) throw new Error('Public list discovery leaked or omitted a list');
await request(`/v1/lists/${list.id}/items/vilsito`, { method: 'DELETE', token: bob.token });
const emptyListDetail = await request(`/v1/lists/${list.id}`, { token: bob.token });
if (emptyListDetail.items?.length !== 0) throw new Error('List item was not removed');
const editedList = await request(`/v1/lists/${list.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ title: 'Edited route', description: 'Nueva curaduría', visibility: 'private' }),
  token: bob.token
});
if (editedList.title !== 'Edited route' || editedList.visibility !== 'private') throw new Error('List owner could not edit metadata');
await request(`/v1/lists/${list.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ title: 'Nope' }),
  token: alice.token
}, 404);
const editedOwnerDetail = await request(`/v1/lists/${list.id}`, { token: bob.token });
if (editedOwnerDetail.description !== 'Nueva curaduría') throw new Error('Edited list description was not persisted');
await request(`/v1/lists/${list.id}`, { token: alice.token }, 404);
const collaborator = await request(`/v1/lists/${list.id}/collaborators`, {
  method: 'POST',
  body: JSON.stringify({ userId: alice.user.id, role: 'editor' }),
  token: bob.token
}, 201);
if (collaborator.status !== 'added') throw new Error('List collaborator was not added');
const collaboratorDetail = await request(`/v1/lists/${list.id}`, { token: alice.token });
if (collaboratorDetail.collaborators?.[0]?.id !== alice.user.id || collaboratorDetail.canEdit !== true) throw new Error('Collaborator could not access the private list');
// A public list may reveal how many collaborators it has, but never their
// names/roles to an anonymous visitor. The authorized collaborator above must
// still receive the roster so shared-list management remains functional.
await request(`/v1/lists/${list.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ visibility: 'public' }),
  token: bob.token
});
const publicCollaboratorDetail = await request(`/v1/lists/${list.id}`);
if (publicCollaboratorDetail.collaboratorCount !== 1 || !Array.isArray(publicCollaboratorDetail.collaborators) || publicCollaboratorDetail.collaborators.length !== 0) {
  throw new Error('Public list detail leaked the collaborator roster');
}
await request(`/v1/lists/${list.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ visibility: 'private' }),
  token: bob.token
});
await request(`/v1/lists/${list.id}/items`, {
  method: 'POST',
  body: JSON.stringify({ branchId: 'oriente', note: 'Sugerencia de Alice' }),
  token: alice.token
});
await request(`/v1/lists/${list.id}`, {
  method: 'PATCH',
  body: JSON.stringify({ title: 'Editor cannot rename' }),
  token: alice.token
}, 404);
await request(`/v1/lists/${list.id}/items/oriente`, { method: 'DELETE', token: alice.token });
const collaboratorLists = await request('/v1/lists', { token: alice.token });
if (!collaboratorLists.lists?.some((item) => item.id === list.id && item.canEdit === true)) throw new Error('Collaborative list was not discoverable by editor');
const viewerRole = await request(`/v1/lists/${list.id}/collaborators`, {
  method: 'POST',
  body: JSON.stringify({ userId: alice.user.id, role: 'viewer' }),
  token: bob.token
});
if (viewerRole.status !== 'already' || viewerRole.role !== 'viewer') throw new Error('Collaborator role could not be changed');
const viewerDetail = await request(`/v1/lists/${list.id}`, { token: alice.token });
if (viewerDetail.canEdit !== false) throw new Error('Viewer retained editor permissions');
await request(`/v1/lists/${list.id}/items`, {
  method: 'POST',
  body: JSON.stringify({ branchId: 'oriente' }),
  token: alice.token
}, 404);
const restoredRole = await request(`/v1/lists/${list.id}/collaborators`, {
  method: 'POST',
  body: JSON.stringify({ userId: alice.user.id, role: 'editor' }),
  token: bob.token
});
if (restoredRole.status !== 'already' || restoredRole.role !== 'editor') throw new Error('Collaborator editor role could not be restored');
const removedCollaborator = await request(`/v1/lists/${list.id}/collaborators/${alice.user.id}`, { method: 'DELETE', token: bob.token });
if (removedCollaborator.status !== 'removed') throw new Error('List collaborator was not removed');
await request(`/v1/lists/${list.id}`, { token: alice.token }, 404);
const privateList = await request('/v1/lists', { method: 'POST', body: JSON.stringify({ title: 'Private route', visibility: 'private' }), token: bob.token }, 201);
await request(`/v1/lists/${privateList.id}`, { token: alice.token }, 404);
const privateDetail = await request(`/v1/lists/${privateList.id}`, { token: bob.token });
if (privateDetail.visibility !== 'private') throw new Error('Private list visibility was not preserved');
await request(`/v1/users/${bob.user.id}/follow`, { method: 'DELETE', token: alice.token });
const peopleAfterUnfollow = await request(`/v1/users/search?q=${encodeURIComponent(suffix)}`, { token: alice.token });
if (peopleAfterUnfollow.users?.[0]?.following !== false) throw new Error('Unfollow state was not persisted');
const profileAfterUnfollow = await request(`/v1/users/${bob.user.id}/profile`, { token: alice.token });
if (profileAfterUnfollow.user?.following !== false) throw new Error('Profile follow state was not refreshed after unfollow');

console.log(`API smoke passed: ${baseUrl}`);
