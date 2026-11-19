import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Pool } from 'pg';

/** Arbitrary constant so only one migration run happens at a time. */
const MIGRATION_LOCK_KEY = 7_311_204_519;

const FILE_PATTERN = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface MigrationResult {
  readonly applied: readonly string[];
  readonly alreadyApplied: readonly string[];
}

export class MigrationChecksumError extends Error {
  override readonly name = 'MigrationChecksumError';
}

/**
 * Applies plain SQL migrations in order, each in its own transaction.
 * An applied migration must never change: if its checksum differs, the run stops.
 * Must be run with the schema-owner connection, not the application role.
 */
export async function migrate(pool: Pool, directory: string): Promise<MigrationResult> {
  const files = (await readdir(directory)).filter((f) => FILE_PATTERN.test(f)).sort();

  const client = await pool.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     text PRIMARY KEY,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);

    const { rows } = await client.query<{ version: string; checksum: string }>(
      'SELECT version, checksum FROM schema_migrations',
    );
    const known = new Map(rows.map((r) => [r.version, r.checksum]));

    const applied: string[] = [];
    const alreadyApplied: string[] = [];

    for (const file of files) {
      const sql = await readFile(join(directory, file), 'utf8');
      const checksum = createHash('sha256').update(sql).digest('hex');
      const previous = known.get(file);

      if (previous !== undefined) {
        if (previous !== checksum) {
          throw new MigrationChecksumError(
            `Migration ${file} was changed after it was applied. Write a new migration instead.`,
          );
        }
        alreadyApplied.push(file);
        continue;
      }

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)', [file, checksum]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(error as Error).message}`, { cause: error });
      }
    }

    return { applied, alreadyApplied };
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]).catch(() => undefined);
    client.release();
  }
}
