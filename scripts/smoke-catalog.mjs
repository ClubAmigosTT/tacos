import { readFile } from 'node:fs/promises';

const inputPath = process.env.CATALOG_SMOKE_FILE ?? 'catalog/cdmx-edomex.json';
const raw = JSON.parse(await readFile(inputPath, 'utf8'));
const branches = Array.isArray(raw) ? raw : raw?.branches;
if (!Array.isArray(branches) || branches.length === 0) throw new Error('El catálogo está vacío');

const sourceIds = new Set();
const coverage = new Set();
let active = 0;
let review = 0;
for (const branch of branches) {
  if (!branch?.id || !branch?.name || !Number.isFinite(Number(branch.latitude)) || !Number.isFinite(Number(branch.longitude))) {
    throw new Error(`Registro inválido: ${branch?.id ?? '<sin id>'}`);
  }
  const sourceId = String(branch.sourcePlaceId ?? branch.id);
  if (sourceIds.has(sourceId)) throw new Error(`sourcePlaceId duplicado: ${sourceId}`);
  sourceIds.add(sourceId);
  if (branch.state === 'Ciudad de México' || branch.state === 'Estado de México') coverage.add(branch.state);
  if (branch.catalogStatus === 'active') active += 1;
  if (branch.catalogStatus === 'needs_review') review += 1;
  if (branch.catalogStatus === 'active' && branch.sourceName === 'denue-cdmx-edomex') {
    const hasExplicitSignal = Array.isArray(branch.tags) && branch.tags.includes('nombre-con-señal-de-tacos');
    if (!hasExplicitSignal || branch.businessType === 'restaurant_with_tacos' || branch.confidence !== 'high') {
      throw new Error(`DENUE sin señal explícita publicado como activo: ${branch.name}`);
    }
  }
  if (branch.catalogStatus === 'active' && /^av\.?\s+espartaco$/i.test(branch.name)) {
    throw new Error(`Falso positivo activo: ${branch.name}`);
  }
}

if (!coverage.has('Ciudad de México') || !coverage.has('Estado de México')) throw new Error('Falta una entidad regional');
if (!active || !review) throw new Error('El feed debe separar activos y revisión');

console.log(JSON.stringify({ inputPath, branches: branches.length, active, review, sourceIds: sourceIds.size, coverage: [...coverage] }, null, 2));
