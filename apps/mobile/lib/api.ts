import Constants from 'expo-constants';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import { type CategoryRatings, type Place } from '@/data/fixtures';
import { localDiscover, localPlace, localRecommendations, localTaqueria } from '@/lib/localCatalog';
import { isDisplayablePlace } from '@/lib/catalogQuality';

export type AuthUser = { id: string; email: string; displayName: string; role?: 'user' | 'admin'; following?: boolean; emailVerified?: boolean };
export type ApiList = { id: string; title: string; description: string; owner: { id: string; displayName: string }; itemCount: number; visitedCount: number; coverImage: string; visibility?: 'public' | 'private'; collaboratorCount?: number; canEdit?: boolean };
export type ApiListCollaborator = { id: string; displayName: string; role: 'editor' | 'viewer' };
export type ApiListDetail = ApiList & { collaborators?: ApiListCollaborator[]; items: Array<{ branchId: string; note: string; position: number; place: Place }> };
export type ApiTaqueria = { id: string; name: string; slug: string; description: string; branchCount: number; branches: Place[] };
export type FeedItem = { id: string; visited_at: string; rating: number; note?: string; user_id: string; display_name: string; place_id: string; place_name: string; neighborhood: string; image_url: string; tacos: string; comment_count?: number };
export type BranchReview = { id: string; visitedAt: string; rating: number; categoryRatings: CategoryRatings; note: string; photoUrl?: string | null; tacos: string; user: { id: string; displayName: string } };
export type RuntimeGooglePhoto = { url: string; source: 'google_maps'; sourceUrl: string; googleMapsUri: string; attribution: string };
export type AdminBranchPhoto = { id: string; branchId: string; url: string; sourceUrl?: string; license: string; attribution: string; sourceType: 'catalog' | 'community' | 'owner'; status: 'pending' | 'approved' | 'rejected' | 'removed'; isPrimary: boolean; moderationNote: string; createdAt: string; updatedAt: string; uploader?: { id: string; displayName: string }; place: { id: string; name: string; neighborhood: string } };
export type VisitComment = { id: string; body: string; createdAt: string; author: { id: string; displayName: string }; own: boolean };
export type TasteProfile = { title: string; description: string; tags: string[]; profile: { intensity: number; spicy: number; traditional: number; texture: number; value: number }; hasData?: boolean };
export type PassportZone = { name: string; note: string; branchCount: number; visitCount: number; unlocked: boolean };
export type PassportData = { zones: PassportZone[]; totalZones: number; visitedZones: number };
export type AdminReport = { id: string; visitId: string; reason: 'spam' | 'inappropriate' | 'wrong_place' | 'other'; details: string; status: 'open' | 'reviewed' | 'dismissed'; createdAt: string; reporter: { id: string; displayName: string }; author: { id: string; displayName: string }; place: { id: string; name: string }; rating: number; visitedAt: string };
export type AdminComment = { id: string; visitId: string; body: string; visibility: 'visible' | 'hidden'; createdAt: string; author: { id: string; displayName: string }; place: { id: string; name: string } };
export type AdminAnalytics = { days: number; totalEvents: number; uniqueAudiences: number; byEvent: Array<{ eventName: string; count: number }> };
export type UserProfile = { user: { id: string; displayName: string; following?: boolean }; stats: { visits: number; averageRating: number | null; listCount: number }; taste: TasteProfile; lists: ApiList[] };
export type CatalogProposal = { id: string; kind: 'branch' | 'menu_item' | 'correction'; branchId?: string; payload: Record<string, unknown>; evidenceUrl?: string; status: 'pending' | 'approved' | 'rejected'; reviewNote: string; createdAt: string; updatedAt: string; proposer?: { id: string; displayName: string }; reviewer?: { id: string; displayName: string } };

const configuredUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;
const API_URL = configuredUrl?.replace(/\/$/, '');
const DEMO_MODE = Constants.expoConfig?.extra?.demoMode === true;
// Keep offline/error states responsive while allowing the Render service time
// to wake up on a cold request.
const REQUEST_TIMEOUT_MS = 10_000;

// The catalog snapshot owns the temporary bundled media. The API may be
// healthy while its catalog row still has no image, so hydrate only missing
// media from the local snapshot and preserve approved/community photos.
function withBundledCatalogMedia(place: Place): Place {
  if (place.image?.trim() || place.photos?.length) return place;
  const bundled = localPlace(place.id);
  if (!bundled) return place;
  return {
    ...place,
    image: bundled.image,
    imageIsIllustrative: bundled.imageIsIllustrative,
    photos: bundled.photos
  };
}

function withBundledCatalogMediaList(items: Place[]) {
  return items.filter(isDisplayablePlace).map(withBundledCatalogMedia);
}

const ANONYMOUS_ID_KEY = 'tacos.analytics.anonymous_id';
let anonymousIdPromise: Promise<string> | undefined;
export class ApiError extends Error {
  constructor(public readonly status: number) {
    super(`API ${status}`);
    this.name = 'ApiError';
  }
}

export function isDemoMode() {
  return DEMO_MODE;
}

export type ProductEventProperty = string | number | boolean | null;
export type ProductEventName = 'app_open' | 'map_search' | 'map_filter' | 'radar_filter' | 'place_open' | 'visit_saved' | 'visit_deleted' | 'list_open' | 'list_created' | 'list_collaborator_changed' | 'profile_open' | 'feed_open';

function createAnonymousId() {
  const randomUuid = globalThis.crypto?.randomUUID?.();
  return `anon-${randomUuid ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`}`;
}

async function getAnonymousId() {
  if (anonymousIdPromise) return anonymousIdPromise;
  anonymousIdPromise = (async () => {
    const stored = Platform.OS === 'web'
      ? globalThis.localStorage?.getItem(ANONYMOUS_ID_KEY)
      : await SecureStore.getItemAsync(ANONYMOUS_ID_KEY);
    if (stored && /^[a-zA-Z0-9._:-]{8,128}$/.test(stored)) return stored;
    const next = createAnonymousId();
    if (Platform.OS === 'web') globalThis.localStorage?.setItem(ANONYMOUS_ID_KEY, next);
    else await SecureStore.setItemAsync(ANONYMOUS_ID_KEY, next);
    return next;
  })().catch(() => createAnonymousId());
  return anonymousIdPromise;
}

async function request<T>(path: string, options?: RequestInit, token?: string, requestSignal?: AbortSignal): Promise<T> {
  if (!API_URL) throw new Error('API URL no configurada');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const abortRequest = () => controller.abort();
  requestSignal?.addEventListener('abort', abortRequest, { once: true });
  const headers: HeadersInit = {
    ...(options?.body ? { 'Content-Type': 'application/json' } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(options?.headers ?? {})
  };
  try {
    const response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      signal: controller.signal
    });
    if (!response.ok) throw new ApiError(response.status);
    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
    requestSignal?.removeEventListener('abort', abortRequest);
  }
}

export async function trackEvent(eventName: ProductEventName, properties: Record<string, ProductEventProperty> = {}, token?: string) {
  if (!API_URL) return;
  try {
    const anonymousId = token ? undefined : await getAnonymousId();
    await request<{ status: 'accepted' }>('/v1/events', { method: 'POST', body: JSON.stringify({ eventName, anonymousId, properties }) }, token);
  } catch {
    // Analytics must never block a product action or break the offline fallback.
  }
}

export async function adminAnalytics(token: string, days = 14) {
  return request<{ analytics: AdminAnalytics }>(`/v1/admin/analytics?days=${days}`, undefined, token);
}

export async function adminBranchPhotos(token: string, status: AdminBranchPhoto['status'] | 'all' = 'pending') {
  return request<{ photos: AdminBranchPhoto[] }>(`/v1/admin/photos?status=${status}`, undefined, token);
}

export async function reviewBranchPhoto(photoId: string, action: 'approve' | 'reject', token: string, moderationNote = '') {
  return request<{ status: string; photoId: string }>(`/v1/admin/photos/${encodeURIComponent(photoId)}`, { method: 'PATCH', body: JSON.stringify({ action, moderationNote }) }, token);
}

export async function discover(options: { q?: string; lat?: number; lng?: number; radiusKm?: number; offset?: number; openNow?: boolean; limit?: number } = {}, token?: string, signal?: AbortSignal): Promise<Place[]> {
  try {
    const params = new URLSearchParams();
    if (options.q?.trim()) params.set('q', options.q.trim());
    if (options.lat != null) params.set('lat', String(options.lat));
    if (options.lng != null) params.set('lng', String(options.lng));
    if (options.radiusKm != null) params.set('radiusKm', String(options.radiusKm));
    if (options.offset != null) params.set('offset', String(options.offset));
    if (options.openNow != null) params.set('openNow', String(options.openNow));
    if (options.limit != null) params.set('limit', String(options.limit));
    const query = params.toString();
    const result = await request<{ places: Place[] }>(`/v1/discover${query ? `?${query}` : ''}`, undefined, token, signal);
    // A healthy API with an empty catalog must not erase the small bundled
    // fallback for the normal browse screen. Search queries still preserve a
    // genuine empty result.
    const hydratedPlaces = withBundledCatalogMediaList(result.places);
    return hydratedPlaces.length || options.q?.trim() ? hydratedPlaces : localDiscover(options);
  } catch (cause) {
    if (signal?.aborted) throw cause;
    // The small high-confidence snapshot remains useful while the server is
    // waking up or the device is temporarily offline.
    return localDiscover(options);
  }
}

export async function recommendations(token?: string, location?: { latitude: number; longitude: number }): Promise<Place[]> {
  try {
    const params = location ? `?lat=${encodeURIComponent(String(location.latitude))}&lng=${encodeURIComponent(String(location.longitude))}` : '';
    const result = await request<{ places: Place[] }>(`/v1/recommendations${params}`, undefined, token);
    const hydratedPlaces = withBundledCatalogMediaList(result.places);
    return hydratedPlaces.length ? hydratedPlaces : localRecommendations(location);
  } catch (cause) {
    // Personal signals disappear offline, but the local catalog remains
    // available so Inicio never becomes an empty error state.
    return localRecommendations(location);
  }
}

export async function taste(token: string) {
  return request<{ taste: TasteProfile }>('/v1/me/taste', undefined, token);
}

export async function passport(token: string) {
  return request<PassportData>('/v1/me/passport', undefined, token);
}

export async function getPlace(id: string, token?: string): Promise<Place> {
  try {
    return withBundledCatalogMedia(await request<Place>(`/v1/branches/${id}`, undefined, token));
  } catch (cause) {
    // A real 4xx means the branch is gone or the link is invalid. Network and
    // 5xx failures may still use the bundled catalog while the API recovers.
    if (cause instanceof ApiError && cause.status < 500) throw cause;
    const fallback = localPlace(id);
    if (!fallback) throw new Error('Taquería no encontrada');
    return fallback;
  }
}

export async function branchReviews(branchId: string) {
  return request<{ reviews: BranchReview[] }>(`/v1/branches/${encodeURIComponent(branchId)}/reviews`);
}

export async function googleBranchPhotos(branchId: string) {
  return request<{ configured: boolean; photos: RuntimeGooglePhoto[] }>(`/v1/branches/${encodeURIComponent(branchId)}/google-photos`);
}

export async function submitBranchPhoto(branchId: string, input: { base64: string; contentType: 'image/jpeg' | 'image/png' | 'image/webp'; sourceType: 'community' | 'owner'; consentGranted: true }, token: string) {
  return request<AdminBranchPhoto>(`/v1/branches/${encodeURIComponent(branchId)}/photos`, { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function deleteBranchPhoto(branchId: string, photoId: string, token: string) {
  return request<{ status: string; photoId: string }>(`/v1/branches/${encodeURIComponent(branchId)}/photos/${encodeURIComponent(photoId)}`, { method: 'DELETE' }, token);
}

export async function savedPlaces(token: string) {
  return request<{ placeIds: string[] }>('/v1/me/saved', undefined, token);
}

export async function savePlace(placeId: string, token: string) {
  return request<{ status: string; placeId: string }>(`/v1/branches/${encodeURIComponent(placeId)}/saved`, { method: 'POST' }, token);
}

export async function unsavePlace(placeId: string, token: string) {
  return request<{ status: string; placeId: string }>(`/v1/branches/${encodeURIComponent(placeId)}/saved`, { method: 'DELETE' }, token);
}

export async function getTaqueria(id: string) {
  try {
    const result = await request<ApiTaqueria>(`/v1/taquerias/${id}`);
    return { ...result, branches: withBundledCatalogMediaList(result.branches) };
  } catch (cause) {
    if (cause instanceof ApiError && cause.status < 500) throw cause;
    const fallback = localTaqueria(id);
    if (!fallback) throw new Error('Taquería no encontrada');
    return fallback satisfies ApiTaqueria;
  }
}

export async function createVisit(input: { placeId: string; tacoIds: string[]; rating: number; categoryRatings?: CategoryRatings; tacoRatings?: Record<string, number>; price?: number; note?: string; photoUrl?: string; latitude?: number; longitude?: number }, token: string) {
  return request('/v1/visits', { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function updateVisit(visitId: string, input: { rating?: number; categoryRatings?: CategoryRatings; tacoRatings?: Record<string, number>; price?: number | null; note?: string }, token: string) {
  return request<{ id: string; status: string }>(`/v1/visits/${encodeURIComponent(visitId)}`, { method: 'PATCH', body: JSON.stringify(input) }, token);
}

export async function deleteVisit(visitId: string, token: string) {
  return request<{ id: string; status: string }>(`/v1/visits/${encodeURIComponent(visitId)}`, { method: 'DELETE' }, token);
}

export async function uploadImage(input: { base64: string; contentType: 'image/jpeg' | 'image/png' | 'image/webp' }, token: string) {
  return request<{ key: string; url: string }>('/v1/media/images', { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function register(input: { email: string; password: string; displayName: string }) {
  return request<{ user: AuthUser; token?: string; verificationRequired?: boolean; verificationToken?: string }>('/v1/auth/register', { method: 'POST', body: JSON.stringify(input) });
}

export async function login(input: { email: string; password: string }) {
  return request<{ user: AuthUser; token: string }>('/v1/auth/login', { method: 'POST', body: JSON.stringify(input) });
}

export async function verifyEmail(token: string) {
  return request<{ user: AuthUser; token: string }>('/v1/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
}

export async function resendVerification(email: string) {
  return request<{ status: string; verificationToken?: string }>('/v1/auth/resend-verification', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function forgotPassword(email: string) {
  return request<{ status: string; resetToken?: string }>('/v1/auth/forgot-password', { method: 'POST', body: JSON.stringify({ email }) });
}

export async function resetPassword(token: string, password: string) {
  return request<{ status: string }>('/v1/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
}

export async function logout(token: string) {
  return request<{ status: string }>('/v1/auth/logout', { method: 'POST' }, token);
}

export async function sessions(token: string) {
  return request<{ sessions: Array<{ id: string; createdAt: string; expiresAt: string; userAgent?: string; ip?: string }> }>('/v1/me/sessions', undefined, token);
}

export async function revokeAllSessions(token: string) {
  return request<{ status: string; count: number }>('/v1/me/sessions/revoke-all', { method: 'POST' }, token);
}

export async function exportAccount(token: string) {
  return request<Record<string, unknown>>('/v1/me/export', undefined, token);
}

export async function deleteAccount(token: string) {
  return request<{ status: string }>('/v1/me', { method: 'DELETE', body: JSON.stringify({ confirmation: 'ELIMINAR' }) }, token);
}

export async function me(token: string) {
  return request<{ user: AuthUser }>('/v1/me', undefined, token);
}

export async function updateProfile(input: { displayName: string }, token: string) {
  return request<{ user: AuthUser }>('/v1/me/profile', { method: 'PATCH', body: JSON.stringify(input) }, token);
}

export async function privacy(token: string) {
  return request<{ privacy: { shareActivity: boolean } }>('/v1/me/privacy', undefined, token);
}

export async function updatePrivacy(input: { shareActivity: boolean }, token: string) {
  return request<{ privacy: { shareActivity: boolean } }>('/v1/me/privacy', { method: 'PATCH', body: JSON.stringify(input) }, token);
}

export type DiaryEntry = { id: string; visited_at: string; rating: number; category_ratings?: CategoryRatings; price?: number | null; note?: string; photo_url?: string | null; place_name: string; neighborhood: string; tacos: string; taco_ratings?: Record<string, number | null>; latitude?: number | null; longitude?: number | null; image_url: string };

export async function diary(token: string) {
  return request<{ entries: DiaryEntry[] }>('/v1/diary', undefined, token);
}

export async function lists(token?: string) {
  if (token) return request<{ lists: ApiList[] }>('/v1/lists', undefined, token);
  try {
    return await request<{ lists: ApiList[] }>('/v1/lists');
  } catch {
    return { lists: [] as ApiList[] };
  }
}

export async function listDetails(listId: string, token?: string) {
  return request<ApiListDetail>(`/v1/lists/${listId}`, undefined, token);
}

export async function createList(input: { title: string; description?: string; visibility?: 'public' | 'private' }, token: string) {
  return request<ApiList>('/v1/lists', { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function updateList(listId: string, input: { title?: string; description?: string; visibility?: 'public' | 'private' }, token: string) {
  return request<ApiListDetail>(`/v1/lists/${encodeURIComponent(listId)}`, { method: 'PATCH', body: JSON.stringify(input) }, token);
}

export async function addListCollaborator(listId: string, input: { userId: string; role?: 'editor' | 'viewer' }, token: string) {
  return request<{ status: string; listId: string; userId: string; role: string }>(`/v1/lists/${encodeURIComponent(listId)}/collaborators`, { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function removeListCollaborator(listId: string, userId: string, token: string) {
  return request<{ status: string; listId: string; userId: string }>(`/v1/lists/${encodeURIComponent(listId)}/collaborators/${encodeURIComponent(userId)}`, { method: 'DELETE' }, token);
}

export async function addListItem(listId: string, input: { branchId: string; note?: string }, token: string) {
  return request<{ status: string; listId: string; branchId: string }>(`/v1/lists/${listId}/items`, { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function removeListItem(listId: string, branchId: string, token: string) {
  return request<{ status: string; listId: string; branchId: string }>(`/v1/lists/${listId}/items/${encodeURIComponent(branchId)}`, { method: 'DELETE' }, token);
}

export async function searchUsers(query: string, token?: string, signal?: AbortSignal) {
  return request<{ users: AuthUser[] }>(`/v1/users/search?q=${encodeURIComponent(query)}`, undefined, token, signal);
}

export async function userProfile(userId: string, token?: string) {
  return request<UserProfile>(`/v1/users/${encodeURIComponent(userId)}/profile`, undefined, token);
}

export async function followUser(userId: string, token: string) {
  return request<{ status: string; userId: string }>(`/v1/users/${userId}/follow`, { method: 'POST', body: JSON.stringify({}) }, token);
}

export async function unfollowUser(userId: string, token: string) {
  return request<{ status: string; userId: string }>(`/v1/users/${userId}/follow`, { method: 'DELETE' }, token);
}

export async function feed(token: string) {
  return request<{ items: FeedItem[] }>('/v1/feed', undefined, token);
}

export async function visitComments(visitId: string, token: string) {
  return request<{ comments: VisitComment[] }>(`/v1/visits/${encodeURIComponent(visitId)}/comments`, undefined, token);
}

export async function createComment(visitId: string, body: string, token: string) {
  return request<VisitComment>(`/v1/visits/${encodeURIComponent(visitId)}/comments`, { method: 'POST', body: JSON.stringify({ body }) }, token);
}

export async function deleteComment(commentId: string, token: string) {
  return request<{ status: string; commentId: string }>(`/v1/comments/${encodeURIComponent(commentId)}`, { method: 'DELETE' }, token);
}

export async function reportVisit(input: { visitId: string; reason: 'spam' | 'inappropriate' | 'wrong_place' | 'other'; details?: string }, token: string) {
  return request<{ status: string; visitId: string }>('/v1/reports', { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function adminReports(token: string, status: 'open' | 'reviewed' | 'dismissed' | 'all' = 'open') {
  return request<{ reports: AdminReport[] }>(`/v1/admin/reports?status=${status}`, undefined, token);
}

export async function reviewReport(reportId: string, action: 'hide' | 'dismiss', token: string) {
  return request<{ status: string; reportId: string }>(`/v1/admin/reports/${reportId}`, { method: 'PATCH', body: JSON.stringify({ action }) }, token);
}

export async function adminComments(token: string, visibility: 'visible' | 'hidden' | 'all' = 'visible') {
  return request<{ comments: AdminComment[] }>(`/v1/admin/comments?visibility=${visibility}`, undefined, token);
}

export async function reviewComment(commentId: string, action: 'hide' | 'restore', token: string) {
  return request<{ status: string; commentId: string }>(`/v1/admin/comments/${encodeURIComponent(commentId)}`, { method: 'PATCH', body: JSON.stringify({ action }) }, token);
}

export async function createCatalogProposal(input: { kind: CatalogProposal['kind']; branchId?: string; payload: Record<string, unknown>; evidenceUrl?: string }, token: string) {
  return request<CatalogProposal>('/v1/catalog/proposals', { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function adminCatalogProposals(token: string, status: CatalogProposal['status'] | 'all' = 'pending') {
  return request<{ proposals: CatalogProposal[] }>(`/v1/admin/catalog/proposals?status=${status}`, undefined, token);
}

export async function reviewCatalogProposal(id: string, action: 'approve' | 'reject', token: string, reviewNote = '') {
  return request<{ status: string; proposalId: string }>(`/v1/admin/catalog/proposals/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ action, reviewNote }) }, token);
}
