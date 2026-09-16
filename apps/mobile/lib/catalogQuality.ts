import type { Place } from '@/data/fixtures';

export type SearchEvidence = 'menu' | 'name' | 'catalog';

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
