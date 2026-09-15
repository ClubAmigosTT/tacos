import type { Place } from '@/data/fixtures';

export type SearchEvidence = 'menu' | 'name' | 'catalog';

const genericNameTokens = new Set([
  'a', 'al', 'antojito', 'antojitos', 'bar', 'carnita', 'carnitas', 'carne',
  'comida', 'comidas', 'con', 'cocina', 'de', 'del', 'desayuno', 'desayunos',
  'el', 'en', 'fonda', 'food', 'horas', 'la', 'las', 'los', 'mexicana',
  'mexicano', 'mexicanos', 'puesto', 'restaurant', 'restaurante',
  'restaurantes', 'sin', 'suadero', 'taco', 'tacos', 'taqueria', 'tortas',
  'y', 'barbacoa', 'birria', 'pastor', 'canasta'
]);

const genericExactNames = new Set([
  'antojito', 'antojitos', 'barbacoa', 'birria', 'carnitas', 'comida',
  'comida mexicana', 'comidas', 'cocina economica', 'desayuno', 'desayunos',
  'food truck', 'mexicana', 'mexicano', 'puesto de tacos', 'restaurant',
  'restaurante', 'restaurantes', 'suadero', 'taco', 'tacos', 'taqueria',
  'tortas', 'tacos de canasta', 'zona de comida'
]);

function normalize(value: unknown) {
  return String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function tokens(value: unknown) {
  return normalize(value).split(' ').filter(Boolean);
}

export function hasCommercialPlaceName(value: unknown) {
  const normalized = normalize(value);
  if (!normalized || genericExactNames.has(normalized)) return false;
  return tokens(normalized).some((token) => !genericNameTokens.has(token) && !/^\d+$/.test(token) && token.length >= 2);
}

export function isDisplayablePlace(place: Pick<Place, 'name' | 'taqueriaName'>) {
  return hasCommercialPlaceName(place.name || place.taqueriaName);
}

export function searchEvidence(place: Pick<Place, 'name' | 'taqueriaName' | 'tacos'>, query?: string): SearchEvidence | undefined {
  const queryTerms = tokens(query).filter((term) => term.length >= 2);
  if (!queryTerms.length) return undefined;
  const menuText = normalize(place.tacos.map((taco) => taco.name).join(' '));
  if (queryTerms.every((term) => menuText.includes(term))) return 'menu';
  const nameText = normalize(`${place.name} ${place.taqueriaName ?? ''}`);
  if (queryTerms.every((term) => nameText.includes(term))) return 'name';
  return 'catalog';
}

export function searchEvidenceLabel(evidence?: SearchEvidence) {
  if (evidence === 'menu') return 'En menú registrado';
  if (evidence === 'name') return 'Coincide en nombre';
  if (evidence === 'catalog') return 'Coincide en catálogo';
  return undefined;
}
