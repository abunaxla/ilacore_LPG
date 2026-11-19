/**
 * Provides a disposable PostgreSQL + PostGIS database for integration tests.
 *
 * - With TEST_ADMIN_DATABASE_URL set (local development): connects as the schema owner, creates a
 *   fresh database from the lpg_template template plus a one-off login role, and drops both afterwards.
 *   This is how tests run against the VPS without Docker on the developer's machine.
 * - Without it (CI): starts a Testcontainers PostgreSQL + PostGIS matching the VPS versions.
 */
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';

export const POSTGIS_IMAGE = 'postgis/postgis:16-3.4';

export interface TestDatabase {
  /** Connection string for the schema owner of the test database. */
  ownerUrl: string;
  /** Create a login role (member of lpg_app) and return its connection string. */
  createAppLogin(): Promise<string>;
  dispose(): Promise<void>;
}

const suffix = () => randomBytes(6).toString('hex');

export async function startTestDatabase(): Promise<TestDatabase> {
  const adminUrl = process.env.TEST_ADMIN_DATABASE_URL;
  return adminUrl ? startOnServer(adminUrl) : startInContainer();
}

async function startOnServer(adminUrl: string): Promise<TestDatabase> {
  const id = suffix();
  const dbName = `lpg_test_${id}`;
  const admin = new Pool({ connectionString: adminUrl, max: 1 });
  await admin.query(`CREATE DATABASE ${dbName} TEMPLATE lpg_template`);
  const logins: string[] = [];

  const ownerUrl = withDatabase(adminUrl, dbName);
  return {
    ownerUrl,
    async createAppLogin() {
      const role = `lpg_t_${id}_${logins.length}`;
      const password = randomBytes(18).toString('hex');
      await admin.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' CONNECTION LIMIT 8 IN ROLE lpg_app`);
      logins.push(role);
      return withCredentials(ownerUrl, role, password);
    },
    async dispose() {
      try {
        await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
        for (const role of logins) await admin.query(`DROP ROLE IF EXISTS ${role}`);
      } finally {
        await admin.end();
      }
    },
  };
}

async function startInContainer(): Promise<TestDatabase> {
  const { PostgreSqlContainer } = await import('@testcontainers/postgresql');
  const container = await new PostgreSqlContainer(POSTGIS_IMAGE).start();
  const ownerUrl = container.getConnectionUri();
  let count = 0;
  return {
    ownerUrl,
    async createAppLogin() {
      // The migration must have run first: it creates lpg_app in a fresh container.
      const role = `lpg_t_${count++}`;
      const password = randomBytes(18).toString('hex');
      const owner = new Pool({ connectionString: ownerUrl, max: 1 });
      try {
        await owner.query(`CREATE ROLE ${role} LOGIN PASSWORD '${password}' IN ROLE lpg_app`);
      } finally {
        await owner.end();
      }
      return withCredentials(ownerUrl, role, password);
    },
    async dispose() {
      await container.stop();
    },
  };
}

function withDatabase(url: string, database: string): string {
  const u = new URL(url);
  u.pathname = `/${database}`;
  return u.toString();
}

function withCredentials(url: string, user: string, password: string): string {
  const u = new URL(url);
  u.username = user;
  u.password = password;
  return u.toString();
}
