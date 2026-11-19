import { existsSync } from 'node:fs';
import { defineConfig } from 'vitest/config';

/**
 * Integration tests: a real PostgreSQL + PostGIS. Locally, TEST_ADMIN_DATABASE_URL in .env points at the
 * VPS through an SSH tunnel; in CI, with it unset, Testcontainers starts one. See test/support/test-database.ts.
 */
if (existsSync('.env')) process.loadEnvFile('.env');

export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
