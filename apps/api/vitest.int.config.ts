import { defineConfig } from 'vitest/config';

/** Integration tests: need Docker running (Testcontainers starts a real PostgreSQL + PostGIS). */
export default defineConfig({
  test: {
    include: ['test/**/*.int.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 180_000,
    fileParallelism: false,
  },
});
