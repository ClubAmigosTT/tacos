import { readFile } from 'node:fs/promises';

const inputPath = process.env.MOBILE_CATALOG_SMOKE_FILE ?? 'apps/mobile/data/catalog.ts';
const source = await readFile(inputPath, 'utf8');
const metadataMatch = source.match(/export const catalogMetadata = (.+) as const;/);
const payloadMatch = source.match(/const rawRows: unknown = JSON\.parse\(([\s\S]+?)\);\r?\nexport const catalogRows/);

if (!metadataMatch || !payloadMatch) throw new Error('No se encontró el formato esperado del catálogo móvil');

const metadata = JSON.parse(metadataMatch[1]);
const rows = JSON.parse(JSON.parse(payloadMatch[1]));
if (!Array.isArray(rows) || rows.length === 0) throw new Error('El catálogo móvil está vacío');
if (metadata.branchCount !== rows.length) throw new Error('branchCount no coincide con las filas empaquetadas');
if (metadata.offlineTruncated) throw new Error('El catálogo móvil sigue truncado');
if (metadata.offlineLimit !== rows.length) throw new Error('offlineLimit no cubre todas las filas');

const requiredIds = ['denue-8458686', 'denue-10482106'];
const rowsById = new Map(rows.map((row) => [row.id, row]));
for (const id of requiredIds) {
  if (!rowsById.has(id)) throw new Error(`Falta el registro móvil esperado: ${id}`);
}

console.log(JSON.stringify({
  inputPath,
  branches: rows.length,
  includedActive: metadata.includedActive,
  includedNeedsReview: metadata.includedNeedsReview,
  requiredIds
}, null, 2));
