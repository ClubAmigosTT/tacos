import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { Pool } from 'pg';

if (!process.env.DATABASE_URL) {
  console.log('DATABASE_URL no configurada; se omite migración local.');
  process.exit(0);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const sql = await readFile(resolve(root, 'database/migrations/001_initial.sql'), 'utf8');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : undefined });
await pool.query(sql);
await pool.end();
console.log('Migración inicial aplicada.');
