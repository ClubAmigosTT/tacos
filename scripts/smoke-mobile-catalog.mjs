import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';

const metadataPath = process.env.MOBILE_CATALOG_SMOKE_FILE ?? 'apps/mobile/data/catalog.ts';
const databasePath = process.env.MOBILE_CATALOG_SMOKE_DB ?? 'apps/mobile/assets/catalog.db';
const source = await readFile(metadataPath, 'utf8');
const metadataMatch = source.match(/export const catalogMetadata = (.+) as const;/);
const databaseNameMatch = source.match(/export const catalogDatabaseName = (.+) as const;/);

if (!metadataMatch || !databaseNameMatch) throw new Error('No se encontró el formato esperado del catálogo móvil');

const metadata = JSON.parse(metadataMatch[1]);
const databaseName = JSON.parse(databaseNameMatch[1]);
const database = new DatabaseSync(databasePath, { readOnly: true });

try {
  const countRow = database.prepare('SELECT COUNT(*) AS count FROM catalog_rows').get();
  const branches = Number(countRow?.count ?? 0);
  if (!branches) throw new Error('El catálogo SQLite móvil está vacío');
  if (metadata.storage !== 'sqlite') throw new Error('El catálogo móvil no declara almacenamiento SQLite');
  if (metadata.branchCount !== branches) throw new Error('branchCount no coincide con las filas SQLite');
  if (metadata.offlineTruncated) throw new Error('El catálogo móvil sigue truncado');
  if (metadata.offlineLimit !== branches) throw new Error('offlineLimit no cubre todas las filas');

  const requiredIds = ['denue-8458686', 'denue-10482106'];
  const rowsById = new Map(
    database.prepare(`SELECT id FROM catalog_rows WHERE id IN (${requiredIds.map(() => '?').join(',')})`).all(...requiredIds)
      .map((row) => [row.id, row])
  );
  for (const id of requiredIds) {
    if (!rowsById.has(id)) throw new Error(`Falta el registro móvil esperado: ${id}`);
  }

  const gueros = database.prepare("SELECT id FROM catalog_rows WHERE search_text LIKE ? LIMIT 1").get('%gueros%');
  if (!gueros) throw new Error('No se encontró la búsqueda local de Güeros');
  const guerosDeBoutorini = database.prepare("SELECT id FROM catalog_rows WHERE search_text LIKE ? LIMIT 1").get('%gueros de boutorini%');
  if (guerosDeBoutorini?.id !== 'denue-8458686') throw new Error('La búsqueda local de Güeros de Boutorini perdió su registro esperado');

  console.log(JSON.stringify({
    metadataPath,
    databasePath,
    databaseName,
    branches,
    includedActive: metadata.includedActive,
    includedNeedsReview: metadata.includedNeedsReview,
    requiredIds,
    searchSmoke: { query: 'gueros', id: gueros?.id ?? null },
    requiredSearch: { query: 'gueros de boutorini', id: guerosDeBoutorini.id }
  }, null, 2));
} finally {
  database.close();
}
