export type Taco = {
  id: string;
  name: string;
  rating: number;
  price: number;
  note: string;
};

export type Photo = { url: string; sourceUrl?: string; license: string; attribution: string };

export type RatingCategory = 'tortilla' | 'service' | 'price' | 'meat' | 'salsas';
export type CategoryRatings = Partial<Record<RatingCategory, number | null>>;
export type RatingBreakdown = Record<RatingCategory, number | null>;

export type Place = {
  id: string;
  taqueriaId?: string;
  taqueriaName?: string;
  name: string;
  neighborhood: string;
  distance: string;
  openUntil: string;
  rating: number;
  reviewCount?: number;
  ratingBreakdown?: RatingBreakdown;
  match?: number;
  style: string;
  coordinates: { latitude: number; longitude: number };
  address?: string;
  phone?: string;
  weeklyHours?: Record<string, Array<{ open: string; close: string }>>;
  /** False means the source explicitly has no reliable weekly schedule. */
  hoursKnown?: boolean;
  priceMin?: number;
  priceMax?: number;
  source?: { name?: string; url?: string; license?: string; attribution?: string; updatedAt?: string };
  image: string;
  description: string;
  tacos: Taco[];
  photos?: Photo[];
  tags: string[];
  /** Optional; only user/community evidence can populate a taste profile. */
  flavorProfile?: { intensity: number; spicy: number; traditional: number; texture: number; value: number };
  tasteMatch?: number;
  socialMatch?: number;
  friendCount?: number;
};

export type List = {
  id: string;
  title: string;
  description: string;
  owner: { id: string; displayName: string };
  itemCount: number;
  visitedCount: number;
  coverImage: string;
  visibility?: 'public' | 'private';
};

export const places: Place[] = [
  {
    id: 'vilsito',
    taqueriaId: 'vilsito',
    taqueriaName: 'El Vilsito',
    name: 'El Vilsito',
    neighborhood: 'Narvarte',
    distance: '1.2 km',
    openUntil: '03:00',
    rating: 4.87,
    match: 96,
    style: 'Pastor nocturno',
    coordinates: { latitude: 19.3869, longitude: -99.1571 },
    image: 'https://images.unsplash.com/photo-1552332386-f8dd00dc2f85?auto=format&fit=crop&w=1200&q=80',
    description: 'Pastor intenso, tortilla recién hecha y una noche que casi nunca termina.',
    tags: ['clásico', 'madrugada', 'salsa fuerte'],
    tacos: [
      { id: 'vilsito-pastor', name: 'Pastor', rating: 4.92, price: 22, note: 'Piña, borde crujiente y adobo profundo.' },
      { id: 'vilsito-suadero', name: 'Suadero', rating: 4.58, price: 24, note: 'Graso en el buen sentido; pide doble tortilla.' },
      { id: 'vilsito-queso', name: 'Gringa', rating: 4.76, price: 68, note: 'La opción para cuando vienes con hambre seria.' }
    ]
  },
  {
    id: 'oriente',
    taqueriaId: 'oriente',
    taqueriaName: 'Tacos Oriente',
    name: 'Tacos Oriente',
    neighborhood: 'Roma Sur',
    distance: '2.8 km',
    openUntil: '01:30',
    rating: 4.76,
    match: 91,
    style: 'Suadero elegante',
    coordinates: { latitude: 19.4055, longitude: -99.1622 },
    image: 'https://images.unsplash.com/photo-1565299585323-38d6b0865b47?auto=format&fit=crop&w=1200&q=80',
    description: 'Una taquería compacta y precisa, con gran control de grasa, textura y salsa.',
    tags: ['suave', 'salsa verde', 'precio medio'],
    tacos: [
      { id: 'oriente-suadero', name: 'Suadero', rating: 4.88, price: 28, note: 'Textura mantequillosa y final limpio.' },
      { id: 'oriente-campechano', name: 'Campechano', rating: 4.72, price: 32, note: 'Más intenso, con buen contraste de texturas.' }
    ]
  },
  {
    id: 'los-parados',
    taqueriaId: 'los-parados',
    taqueriaName: 'Los Parados',
    name: 'Los Parados',
    neighborhood: 'Condesa',
    distance: '3.4 km',
    openUntil: '00:30',
    rating: 4.61,
    match: 84,
    style: 'Clásico callejero',
    coordinates: { latitude: 19.4143, longitude: -99.1712 },
    image: 'https://images.unsplash.com/photo-1551504734-5ee1c4a1479b?auto=format&fit=crop&w=1200&q=80',
    description: 'Tacos directos, rápidos y sin pretensiones para una noche de antojo.',
    tags: ['barato', 'rápido', 'clásico'],
    tacos: [
      { id: 'parados-carnitas', name: 'Carnitas', rating: 4.69, price: 20, note: 'Pide surtida para probar las partes.' },
      { id: 'parados-pastor', name: 'Pastor', rating: 4.55, price: 18, note: 'Más dulce y ligero que el promedio.' }
    ]
  }
];

export const diaryEntries = [
  { id: '1', date: '18 AGO', place: 'El Vilsito', taco: 'Pastor', rating: 4.9, image: places[0].image },
  { id: '2', date: '12 AGO', place: 'Tacos Oriente', taco: 'Suadero', rating: 4.8, image: places[1].image },
  { id: '3', date: '04 AGO', place: 'Los Parados', taco: 'Carnitas', rating: 4.6, image: places[2].image }
];

export const lists: List[] = [
  { id: 'editorial-pastor-midnight', title: 'Pastor después de medianoche', description: 'Siete lugares para cuando la ciudad baja el ritmo.', owner: { id: 'editorial', displayName: 'Comelocal' }, itemCount: 7, visitedCount: 0, coverImage: places[0].image }
];
