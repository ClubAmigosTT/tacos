import { stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import pg from 'pg';

const { Pool } = pg;
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL es obligatorio para preparar el catálogo DENUE');
  console.log('DATABASE_URL no configurada; se omite el bootstrap DENUE local.');
  process.exit(0);
}

const sourceName = 'denue-cdmx-edomex';
const inputPath = resolve('catalog/denue-cdmx-edomex.json');
const pool = new Pool({
  connectionString: databaseUrl,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined,
});
const client = await pool.connect();
let lockHeld = false;

try {
  await client.query('SELECT pg_advisory_lock(hashtext($1))', ['tacos:catalog-bootstrap']);
  lockHeld = true;

  const fileStats = await stat(inputPath);
  const latest = await client.query(`
    SELECT imported_at, records_upserted, errors
    FROM catalog_imports
    WHERE source_name = $1
    ORDER BY imported_at DESC
    LIMIT 1
  `, [sourceName]);
  const previous = latest.rows[0];
  const importedAt = previous?.imported_at ? new Date(previous.imported_at).getTime() : 0;
  const errors = previous?.errors;
  const complete = previous
    && Number(previous.records_upserted) > 0
    && Array.isArray(errors)
    && errors.length === 0;

  if (complete && importedAt >= fileStats.mtimeMs) {
    console.log(JSON.stringify({ sourceName, status: 'already_current', importedAt: new Date(importedAt).toISOString() }));
  } else {
    process.env.CATALOG_FILE = inputPath;
    process.env.CATALOG_SOURCE_NAME = sourceName;
    process.env.CATALOG_SOURCE_URL = 'https://www.inegi.org.mx/app/mapa/denue/';
    process.env.CATALOG_SOURCE_LICENSE = 'Términos de Libre Uso de la Información del INEGI';
    process.env.CATALOG_ALLOW_PARTIAL = 'true';
    process.env.CATALOG_RECONCILE = 'true';

    console.log(JSON.stringify({ sourceName, status: 'importing', inputPath }));
    await import('./import-catalog.mjs');
  }
} finally {
  if (lockHeld) await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['tacos:catalog-bootstrap']);
  client.release();
  await pool.end();
}
