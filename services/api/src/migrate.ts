import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';

const configuredDatabaseUrl = process.env.DATABASE_URL?.trim();
if (!configuredDatabaseUrl) {
  if (process.env.NODE_ENV === 'production') throw new Error('DATABASE_URL is required in production');
  console.log('DATABASE_URL no configurada; se omite migración local.');
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pool = new Pool({ connectionString: configuredDatabaseUrl, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
const client = await pool.connect();
let lockHeld = false;
try {
  // Render can briefly run two deploy hooks during a replacement. Serialize
  // them so both processes cannot apply the same migration simultaneously.
  await client.query('SELECT pg_advisory_lock(hashtext($1))', ['tacos:schema-migrations']);
  lockHeld = true;
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
  const migrationDir = resolve(root, 'database/migrations');
  const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
  for (const file of files) {
    const applied = await client.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
    if (applied.rowCount) continue;
    const sql = await readFile(resolve(migrationDir, file), 'utf8');
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
    console.log(`Aplicada ${file}`);
  }
  console.log('Migración inicial aplicada.');
} finally {
  if (lockHeld) await client.query('SELECT pg_advisory_unlock(hashtext($1))', ['tacos:schema-migrations']);
  client.release();
  await pool.end();
}
