export type ApiTaco = { id: string; name: string; rating: number; price: number; note: string };
export type ApiPhoto = {
  url: string;
  sourceUrl?: string;
  license: string;
  attribution: string;
  source?: 'catalog' | 'community' | 'owner' | 'google_maps';
  googleMapsUri?: string;
};
export type FlavorProfile = { intensity: number; spicy: number; traditional: number; texture: number; value: number };
export type RatingCategory = 'tortilla' | 'service' | 'price' | 'meat' | 'salsas';
export type CategoryRatings = Partial<Record<RatingCategory, number | null>>;
export type RatingBreakdown = Record<RatingCategory, number | null>;
export type TasteProfile = { title: string; description: string; tags: string[]; profile: FlavorProfile; hasData: boolean };
export type ApiPlace = {
  id: string;
  taqueriaId?: string;
  taqueriaName?: string;
  name: string;
  neighborhood: string;
  address?: string;
  phone?: string;
  weeklyHours?: Record<string, Array<{ open: string; close: string }>>;
  /** False means the source explicitly has no reliable weekly schedule. */
  hoursKnown?: boolean;
  priceMin?: number;
  priceMax?: number;
  source?: { name?: string; url?: string; license?: string; attribution?: string; updatedAt?: string };
  distance: string;
  openUntil: string;
  rating: number;
  /** Number of visible reviews contributing to the reputation score. */
  reviewCount?: number;
  /** Community averages for the five taqueria quality dimensions. */
  ratingBreakdown?: RatingBreakdown;
  match?: number;
  style: string;
  coordinates: { latitude: number; longitude: number };
  image: string;
  description: string;
  tacos: ApiTaco[];
  photos?: ApiPhoto[];
  tags: string[];
  flavorProfile: FlavorProfile;
  tasteMatch?: number;
  socialMatch?: number;
  friendCount?: number;
};

export type ApiTaqueria = { id: string; name: string; slug: string; description: string; branchCount: number; branches: ApiPlace[] };

export type ApiList = {
  id: string;
  title: string;
  description: string;
  owner: { id: string; displayName: string };
  itemCount: number;
  visitedCount: number;
  coverImage: string;
  visibility?: 'public' | 'private';
  collaboratorCount?: number;
  canEdit?: boolean;
};
export type ApiListCollaborator = { id: string; displayName: string; role: 'editor' | 'viewer' };
export type ApiListDetail = ApiList & { collaborators?: ApiListCollaborator[]; items: Array<{ branchId: string; note: string; position: number; place: ApiPlace }> };

export const places: ApiPlace[] = [
  {
    id: 'vilsito', taqueriaId: 'vilsito', taqueriaName: 'El Vilsito', name: 'El Vilsito', neighborhood: 'Narvarte', distance: '1.2 km', openUntil: '03:00', rating: 4.87, match: 96, style: 'Pastor nocturno', coordinates: { latitude: 19.3869, longitude: -99.1571 }, image: 'https://images.unsplash.com/photo-1552332386-f8dd00dc2f85?auto=format&fit=crop&w=1200&q=80', description: 'Pastor intenso, tortilla recién hecha y una noche que casi nunca termina.', tags: ['clásico', 'madrugada', 'salsa fuerte'], flavorProfile: { intensity: 86, spicy: 72, traditional: 94, texture: 88, value: 78 }, tacos: [{ id: 'vilsito-pastor', name: 'Pastor', rating: 4.92, price: 22, note: 'Piña, borde crujiente y adobo profundo.' }, { id: 'vilsito-suadero', name: 'Suadero', rating: 4.58, price: 24, note: 'Graso en el buen sentido; pide doble tortilla.' }, { id: 'vilsito-queso', name: 'Gringa', rating: 4.76, price: 68, note: 'La opción para cuando vienes con hambre seria.' }]
  },
  {
    id: 'oriente', taqueriaId: 'oriente', taqueriaName: 'Tacos Oriente', name: 'Tacos Oriente', neighborhood: 'Roma Sur', distance: '2.8 km', openUntil: '01:30', rating: 4.76, match: 91, style: 'Suadero elegante', coordinates: { latitude: 19.4055, longitude: -99.1622 }, image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=1200&q=80', description: 'Una taquería compacta y precisa, con gran control de grasa, textura y salsa.', tags: ['suave', 'salsa verde', 'precio medio'], flavorProfile: { intensity: 68, spicy: 54, traditional: 61, texture: 92, value: 64 }, tacos: [{ id: 'oriente-suadero', name: 'Suadero', rating: 4.88, price: 28, note: 'Textura mantequillosa y final limpio.' }, { id: 'oriente-campechano', name: 'Campechano', rating: 4.72, price: 32, note: 'Más intenso, con buen contraste de texturas.' }]
  },
  {
    id: 'los-parados', taqueriaId: 'los-parados', taqueriaName: 'Los Parados', name: 'Los Parados', neighborhood: 'Condesa', distance: '3.4 km', openUntil: '00:30', rating: 4.61, match: 84, style: 'Clásico callejero', coordinates: { latitude: 19.4143, longitude: -99.1712 }, image: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=1200&q=80', description: 'Tacos directos, rápidos y sin pretensiones para una noche de antojo.', tags: ['barato', 'rápido', 'clásico'], flavorProfile: { intensity: 74, spicy: 48, traditional: 89, texture: 70, value: 96 }, tacos: [{ id: 'parados-carnitas', name: 'Carnitas', rating: 4.69, price: 20, note: 'Pide surtida para probar las partes.' }, { id: 'parados-pastor', name: 'Pastor', rating: 4.55, price: 18, note: 'Más dulce y ligero que el promedio.' }]
  }
];

export const lists: ApiList[] = [
  {
    id: 'editorial-pastor-midnight',
    title: 'Pastor después de medianoche',
    description: 'Siete lugares para cuando la ciudad baja el ritmo.',
    owner: { id: 'editorial', displayName: 'Comelocal' },
    itemCount: 7,
    visitedCount: 0,
    coverImage: places[0].image
  }
];
