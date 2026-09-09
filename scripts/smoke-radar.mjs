import { places } from '../apps/mobile/data/fixtures.ts';
import { applyRadar } from '../apps/mobile/lib/radar.ts';

const base = { active: 'Pastor', distance: 'Toda la ciudad', price: 'Cualquier precio', mood: 'Alta calidad', hunger: 'Normal' };
const gringa = applyRadar({ ...base, contextualTaco: 'grínga', places });
if (gringa.length !== 1 || gringa[0].id !== 'vilsito') throw new Error('Accent-normalized taco filter returned the wrong branches');

const pastor = applyRadar({ ...base, contextualTaco: 'pastor', places });
if (pastor.some((place) => !place.tacos.some((taco) => taco.name.toLowerCase() === 'pastor'))) throw new Error('A branch without the requested taco leaked into the result');
if (pastor[0]?.id !== 'vilsito') throw new Error('Contextual taco rating did not drive the Radar order');

console.log('Radar smoke passed');
