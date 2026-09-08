import Constants from 'expo-constants';
import { places, type Place } from '@/data/fixtures';

const configuredUrl = Constants.expoConfig?.extra?.apiUrl as string | undefined;
const API_URL = configuredUrl?.replace(/\/$/, '');

async function request<T>(path: string, options?: RequestInit): Promise<T> {
  if (!API_URL) throw new Error('API URL no configurada');
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options?.headers ?? {}) }
  });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json() as Promise<T>;
}

export async function discover(): Promise<Place[]> {
  try {
    const result = await request<{ places: Place[] }>('/v1/discover');
    return result.places;
  } catch {
    return places;
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

export async function createVisit(input: { placeId: string; tacoIds: string[]; rating: number }) {
  return request('/v1/visits', { method: 'POST', body: JSON.stringify(input) });
}
