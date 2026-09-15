import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) throw new Error('DATABASE_URL es obligatorio para importar candidatos de Google');

const inputPath = resolve(process.env.GOOGLE_CANDIDATES_FILE ?? 'catalog/google-place-candidates.json');
const raw = JSON.parse(await readFile(inputPath, 'utf8'));
const candidates = Array.isArray(raw) ? raw : raw?.candidates;
if (!Array.isArray(candidates) || candidates.length === 0) {
  throw new Error('El archivo debe ser un array o { candidates: [] } y no puede estar vacío');
}

const allowedStatuses = new Set(['missing', 'matched', 'matched_unpublished', 'unverified', 'review', 'closed_or_obsolete', 'error']);
const text = (value, fallback = '') => typeof value === 'string' ? value.trim() : fallback;
const numberOrNull = (value) => {
  if (value === undefined || value === null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const dateOrNull = (value) => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Fecha inválida: ${value}`);
  return date.toISOString();
};

const rows = candidates.map((candidate, index) => {
  const googlePlaceId = text(candidate?.googlePlaceId);
  const searchRegion = text(candidate?.searchRegion);
  const searchArea = text(candidate?.searchArea);
  const searchQuery = text(candidate?.searchQuery);
  const comparisonVersion = Number(candidate?.comparisonVersion ?? 1);
  const matchStatus = comparisonVersion < 2 ? 'unverified' : text(candidate?.matchStatus, 'unverified');
  const matchConfidence = numberOrNull(candidate?.matchConfidence);
  if (!googlePlaceId || !searchRegion || !searchArea || !searchQuery) {
    throw new Error(`Candidato ${index + 1} no tiene ID, región, área o consulta`);
  }
  if (!allowedStatuses.has(matchStatus)) throw new Error(`Estado inválido en ${googlePlaceId}: ${matchStatus}`);
  if (matchConfidence !== null && (matchConfidence < 0 || matchConfidence > 1)) {
    throw new Error(`Confianza inválida en ${googlePlaceId}: ${matchConfidence}`);
  }
  return {
    googlePlaceId,
    comparisonVersion,
    matchedCatalogStatus: text(candidate?.matchedCatalogStatus) || null,
    searchRegion,
    searchArea,
    searchQuery,
    firstSeenAt: dateOrNull(candidate?.firstSeenAt) ?? new Date().toISOString(),
    lastSeenAt: dateOrNull(candidate?.lastSeenAt) ?? new Date().toISOString(),
    lastCheckedAt: dateOrNull(candidate?.lastCheckedAt),
    matchedBranchId: text(candidate?.matchedBranchId) || null,
    matchStatus,
    matchConfidence,
    matchMethod: text(candidate?.matchMethod) || null,
    lastError: text(candidate?.lastError) || null,
  };
});

const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});
const client = await pool.connect();
let imported = 0;
try {
  await client.query('BEGIN');
  for (const row of rows) {
    await client.query(
      `
        INSERT INTO google_place_candidates (
          google_place_id, search_region, search_area, search_query,
          first_seen_at, last_seen_at, last_checked_at, matched_branch_id,
          match_status, match_confidence, match_method, last_error,
          comparison_version, matched_catalog_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
        ON CONFLICT (google_place_id) DO UPDATE SET
          search_region = EXCLUDED.search_region,
          search_area = EXCLUDED.search_area,
          search_query = EXCLUDED.search_query,
          first_seen_at = LEAST(google_place_candidates.first_seen_at, EXCLUDED.first_seen_at),
          last_seen_at = GREATEST(google_place_candidates.last_seen_at, EXCLUDED.last_seen_at),
          last_checked_at = COALESCE(EXCLUDED.last_checked_at, google_place_candidates.last_checked_at),
          matched_branch_id = EXCLUDED.matched_branch_id,
          match_status = EXCLUDED.match_status,
          match_confidence = EXCLUDED.match_confidence,
          match_method = EXCLUDED.match_method,
          last_error = EXCLUDED.last_error,
          comparison_version = EXCLUDED.comparison_version,
          matched_catalog_status = EXCLUDED.matched_catalog_status
        WHERE EXCLUDED.last_checked_at >= google_place_candidates.last_checked_at
           OR google_place_candidates.last_checked_at IS NULL
      `,
      [
        row.googlePlaceId,
        row.searchRegion,
        row.searchArea,
        row.searchQuery,
        row.firstSeenAt,
        row.lastSeenAt,
        row.lastCheckedAt,
        row.matchedBranchId,
        row.matchStatus,
        row.matchConfidence,
        row.matchMethod,
        row.lastError,
        row.comparisonVersion,
        row.matchedCatalogStatus,
      ],
    );
    imported += 1;
  }
  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}

console.log(`Candidatos importados/actualizados: ${imported}`);
console.log(`Archivo: ${inputPath}`);
