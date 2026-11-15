// PostgreSQL connection pool and schema migrations.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const MIGRATIONS = path.join(path.dirname(fileURLToPath(import.meta.url)), 'migrations');
const MIGRATION_LOCK = 727274; // any constant: lets only one server instance migrate at a time

export function createPool(connectionString) {
  return new pg.Pool({ connectionString, max: 10, idleTimeoutMillis: 30_000 });
}

/** Apply every migrations/*.sql not applied yet, in name order, each in its own transaction. */
export async function migrate(pool, dir = MIGRATIONS) {
  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
    const done = new Set((await client.query('SELECT name FROM schema_migrations')).rows.map(r => r.name));
    const files = (await fs.readdir(dir)).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await fs.readFile(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${err.message}`);
      }
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]).catch(() => {});
    client.release();
  }
}
