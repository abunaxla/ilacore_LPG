import { join } from 'node:path';
import { Pool } from 'pg';
import { migrate } from './migrate.js';

async function main(): Promise<void> {
  const url = process.env['DATABASE_MIGRATION_URL'];
  if (!url) {
    throw new Error('DATABASE_MIGRATION_URL is not set');
  }
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const result = await migrate(pool, join(__dirname, '..', '..', 'migrations'));
    console.log(`Applied: ${result.applied.join(', ') || 'none'}`);
    console.log(`Already applied: ${result.alreadyApplied.length}`);
  } finally {
    await pool.end();
  }
}

main().catch((error: unknown) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
