import Constants from 'expo-constants';
import { places, type Place } from '@/data/fixtures';

export type AuthUser = { id: string; email: string; displayName: string };

const configuredUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;
const API_URL = configuredUrl?.replace(/\/$/, '');

async function request<T>(path: string, options?: RequestInit, token?: string): Promise<T> {
  if (!API_URL) throw new Error('API URL no configurada');
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options?.headers ?? {}) }
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
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
    return filtered.slice(0, options.limit ?? 20);
  }
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

export async function createVisit(input: { placeId: string; tacoIds: string[]; rating: number }, token: string) {
  return request('/v1/visits', { method: 'POST', body: JSON.stringify(input) }, token);
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

export async function diary(token: string) {
  return request<{ entries: Array<{ id: string; visited_at: string; rating: number; place_name: string; neighborhood: string; tacos: string; image_url: string }> }>('/v1/diary', undefined, token);
}
