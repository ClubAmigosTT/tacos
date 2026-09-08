import Constants from 'expo-constants';
import { places, type Place } from '@/data/fixtures';

export type AuthUser = { id: string; email: string; displayName: string; role?: 'user' | 'admin'; following?: boolean };
export type ApiList = { id: string; title: string; description: string; owner: { id: string; displayName: string }; itemCount: number; visitedCount: number; coverImage: string; visibility?: 'public' | 'private' };
export type ApiListDetail = ApiList & { items: Array<{ branchId: string; note: string; position: number; place: Place }> };
export type ApiTaqueria = { id: string; name: string; slug: string; description: string; branchCount: number; branches: Place[] };
export type FeedItem = { id: string; visited_at: string; rating: number; note?: string; user_id: string; display_name: string; place_id: string; place_name: string; neighborhood: string; image_url: string; tacos: string; comment_count?: number };
export type VisitComment = { id: string; body: string; createdAt: string; author: { id: string; displayName: string }; own: boolean };
export type TasteProfile = { title: string; description: string; tags: string[]; profile: { intensity: number; spicy: number; traditional: number; texture: number; value: number } };
export type AdminReport = { id: string; visitId: string; reason: 'spam' | 'inappropriate' | 'wrong_place' | 'other'; details: string; status: 'open' | 'reviewed' | 'dismissed'; createdAt: string; reporter: { id: string; displayName: string }; author: { id: string; displayName: string }; place: { id: string; name: string }; rating: number; visitedAt: string };
export type AdminComment = { id: string; visitId: string; body: string; visibility: 'visible' | 'hidden'; createdAt: string; author: { id: string; displayName: string }; place: { id: string; name: string } };
export type UserProfile = { user: { id: string; displayName: string }; stats: { visits: number; averageRating: number | null; listCount: number }; taste: TasteProfile; lists: ApiList[] };

const configuredUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;
const API_URL = configuredUrl?.replace(/\/$/, '');
const REQUEST_TIMEOUT_MS = 15_000;

function haversineKm(from: { latitude: number; longitude: number }, to: { latitude: number; longitude: number }) {
  const earthRadiusKm = 6371;
  const latitudeDelta = (to.latitude - from.latitude) * Math.PI / 180;
  const longitudeDelta = (to.longitude - from.longitude) * Math.PI / 180;
  const latitudeA = from.latitude * Math.PI / 180;
  const latitudeB = to.latitude * Math.PI / 180;
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return earthRadiusKm * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function request<T>(path: string, options?: RequestInit, token?: string): Promise<T> {
  if (!API_URL) throw new Error('API URL no configurada');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
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
    if (!response.ok) throw new Error(`API ${response.status}`);
    return response.json() as Promise<T>;
  } finally {
    clearTimeout(timeout);
  }
}

export async function discover(options: { q?: string; lat?: number; lng?: number; limit?: number } = {}): Promise<Place[]> {
  try {
    const params = new URLSearchParams();
    if (options.q?.trim()) params.set('q', options.q.trim());
    if (options.lat != null) params.set('lat', String(options.lat));
    if (options.lng != null) params.set('lng', String(options.lng));
    if (options.limit != null) params.set('limit', String(options.limit));
    const query = params.toString();
    const result = await request<{ places: Place[] }>(`/v1/discover${query ? `?${query}` : ''}`);
    return result.places;
  } catch {
    const normalized = options.q?.trim().toLowerCase();
    const filtered = normalized
      ? places.filter((place) => `${place.name} ${place.neighborhood} ${place.style} ${place.tags.join(' ')} ${place.tacos.map((taco) => taco.name).join(' ')}`.toLowerCase().includes(normalized))
      : places;
    const withDistance = options.lat == null || options.lng == null
      ? filtered
      : filtered.map((place) => ({ ...place, distance: `${haversineKm({ latitude: options.lat!, longitude: options.lng! }, place.coordinates).toFixed(1)} km` })).sort((a, b) => Number.parseFloat(a.distance) - Number.parseFloat(b.distance));
    return withDistance.slice(0, options.limit ?? 20);
  }
}

export async function recommendations(token?: string): Promise<Place[]> {
  try {
    const result = await request<{ places: Place[] }>('/v1/recommendations', undefined, token);
    return result.places;
  } catch {
    return places;
  }
}

export async function taste(token: string) {
  return request<{ taste: TasteProfile }>('/v1/me/taste', undefined, token);
}

export async function getPlace(id: string): Promise<Place> {
  try {
    return await request<Place>(`/v1/branches/${id}`);
  } catch {
    const fallback = places.find((place) => place.id === id);
    if (!fallback) throw new Error('Taquería no encontrada');
    return fallback;
  }
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
    return await request<ApiTaqueria>(`/v1/taquerias/${id}`);
  } catch {
    const branches = places.filter((place) => (place.taqueriaId ?? place.id) === id);
    if (!branches.length) throw new Error('Taquería no encontrada');
    const first = branches[0];
    return { id, name: first.taqueriaName ?? first.name, slug: id, description: `${first.name} y sus sucursales.`, branchCount: branches.length, branches } satisfies ApiTaqueria;
  }
}

export async function createVisit(input: { placeId: string; tacoIds: string[]; rating: number; tacoRatings?: Record<string, number>; price?: number; note?: string; photoUrl?: string; latitude?: number; longitude?: number }, token: string) {
  return request('/v1/visits', { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function updateVisit(visitId: string, input: { rating?: number; tacoRatings?: Record<string, number>; price?: number | null; note?: string }, token: string) {
  return request<{ id: string; status: string }>(`/v1/visits/${encodeURIComponent(visitId)}`, { method: 'PATCH', body: JSON.stringify(input) }, token);
}

export async function uploadImage(input: { base64: string; contentType: 'image/jpeg' | 'image/png' | 'image/webp' }, token: string) {
  return request<{ key: string; url: string }>('/v1/media/images', { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function register(input: { email: string; password: string; displayName: string }) {
  return request<{ user: AuthUser; token: string }>('/v1/auth/register', { method: 'POST', body: JSON.stringify(input) });
}

export async function login(input: { email: string; password: string }) {
  return request<{ user: AuthUser; token: string }>('/v1/auth/login', { method: 'POST', body: JSON.stringify(input) });
}

export async function me(token: string) {
  return request<{ user: AuthUser }>('/v1/me', undefined, token);
}

export async function privacy(token: string) {
  return request<{ privacy: { shareActivity: boolean } }>('/v1/me/privacy', undefined, token);
}

export async function updatePrivacy(input: { shareActivity: boolean }, token: string) {
  return request<{ privacy: { shareActivity: boolean } }>('/v1/me/privacy', { method: 'PATCH', body: JSON.stringify(input) }, token);
}

export async function diary(token: string) {
  return request<{ entries: Array<{ id: string; visited_at: string; rating: number; price?: number | null; note?: string; photo_url?: string | null; place_name: string; neighborhood: string; tacos: string; taco_ratings?: Record<string, number | null>; image_url: string }> }>('/v1/diary', undefined, token);
}

export async function lists(token?: string) {
  try {
    return await request<{ lists: ApiList[] }>('/v1/lists', undefined, token);
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

export async function addListItem(listId: string, input: { branchId: string; note?: string }, token: string) {
  return request<{ status: string; listId: string; branchId: string }>(`/v1/lists/${listId}/items`, { method: 'POST', body: JSON.stringify(input) }, token);
}

export async function removeListItem(listId: string, branchId: string, token: string) {
  return request<{ status: string; listId: string; branchId: string }>(`/v1/lists/${listId}/items/${encodeURIComponent(branchId)}`, { method: 'DELETE' }, token);
}

export async function searchUsers(query: string, token?: string) {
  try {
    return await request<{ users: AuthUser[] }>(`/v1/users/search?q=${encodeURIComponent(query)}`, undefined, token);
  } catch {
    return { users: [] as AuthUser[] };
  }
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
