import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL no configurada; se omite migración local.');
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
const migrationDir = resolve(root, 'database/migrations');
const files = (await readdir(migrationDir)).filter((file) => file.endsWith('.sql')).sort();
for (const file of files) {
  const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE version = $1', [file]);
  if (applied.rowCount) continue;
  const sql = await readFile(resolve(migrationDir, file), 'utf8');
  await pool.query('BEGIN');
  try {
    await pool.query(sql);
    await pool.query('INSERT INTO schema_migrations (version) VALUES ($1)', [file]);
    await pool.query('COMMIT');
  } catch (error) {
    await pool.query('ROLLBACK');
    throw error;
  }
  console.log(`Aplicada ${file}`);
}
await pool.end();
console.log('Migración inicial aplicada.');
