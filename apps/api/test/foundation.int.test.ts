/**
 * Integration tests for the database foundation, against a real PostgreSQL + PostGIS in Docker.
 * They prove the guarantees the rest of the system relies on:
 *   - tenant isolation is enforced by the database (row-level security)
 *   - with no tenant set, nothing is visible and nothing can be written
 *   - the event ledger and audit log are append-only, even for the table owner
 *   - an event and its outbox rows commit or roll back together
 *   - applied migrations can't be silently changed
 */
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, MigrationChecksumError } from '../src/db/migrate.js';
import { withTenant } from '../src/db/tenant-transaction.js';
import { recordAudit } from '../src/events/record-audit.js';
import { recordEvent } from '../src/events/record-event.js';

const MIGRATIONS = join(__dirname, '..', 'migrations');
// Throwaway credential for the disposable test container only.
const APP_LOGIN_PASSWORD = 'test-only-password';

let container: StartedPostgreSqlContainer;
let owner: Pool;
let app: Pool;
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  container = await new PostgreSqlContainer('postgis/postgis:17-3.5').start();
  owner = new Pool({ connectionString: container.getConnectionUri(), max: 2 });
  await migrate(owner, MIGRATIONS);

  await owner.query(`CREATE ROLE app_login LOGIN PASSWORD '${APP_LOGIN_PASSWORD}' IN ROLE ilacore_app`);
  const tenants = await owner.query<{ id: string }>(
    "INSERT INTO tenants (name) VALUES ('Distributor A'), ('Distributor B') RETURNING id",
  );
  tenantA = tenants.rows[0]!.id;
  tenantB = tenants.rows[1]!.id;

  const url = new URL(container.getConnectionUri());
  url.username = 'app_login';
  url.password = APP_LOGIN_PASSWORD;
  app = new Pool({ connectionString: url.toString(), max: 4 });
}, 180_000);

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await container?.stop();
});

const sampleEvent = (aggregateId: string) => ({
  type: 'item.registered',
  aggregateType: 'tracked_item',
  aggregateId,
  payload: { size: '13kg' },
  occurredAt: new Date(),
  outboxTopics: ['reporting.refresh'],
});

describe('tenant isolation', () => {
  it('only shows each tenant its own rows', async () => {
    await withTenant(app, tenantA, (c) => recordEvent(c, sampleEvent('cyl-A1')));
    await withTenant(app, tenantB, (c) => recordEvent(c, sampleEvent('cyl-B1')));

    const seenByA = await withTenant(app, tenantA, (c) =>
      c.query<{ aggregate_id: string }>('SELECT aggregate_id FROM business_events'),
    );
    expect(seenByA.rows.map((r) => r.aggregate_id)).toContain('cyl-A1');
    expect(seenByA.rows.map((r) => r.aggregate_id)).not.toContain('cyl-B1');

    const tenantsSeenByA = await withTenant(app, tenantA, (c) => c.query<{ id: string }>('SELECT id FROM tenants'));
    expect(tenantsSeenByA.rows.map((r) => r.id)).toEqual([tenantA]);
  });

  it('shows nothing and accepts no writes when no tenant is set', async () => {
    const rows = await app.query('SELECT * FROM business_events');
    expect(rows.rowCount).toBe(0);
    await expect(
      app.query(
        `INSERT INTO business_events (tenant_id, event_type, aggregate_type, aggregate_id, occurred_at)
         VALUES ($1, 'item.registered', 'tracked_item', 'x', now())`,
        [tenantA],
      ),
    ).rejects.toThrow(/row-level security/);
  });

  it('refuses to write a row for another tenant', async () => {
    await expect(
      withTenant(app, tenantA, (c) =>
        c.query(
          `INSERT INTO business_events (tenant_id, event_type, aggregate_type, aggregate_id, occurred_at)
           VALUES ($1, 'item.registered', 'tracked_item', 'spoof', now())`,
          [tenantB],
        ),
      ),
    ).rejects.toThrow(/row-level security/);
  });
});

describe('append-only ledgers', () => {
  it('rejects updates and deletes of events by the application role', async () => {
    await withTenant(app, tenantA, (c) => recordEvent(c, sampleEvent('cyl-A2')));
    await expect(
      withTenant(app, tenantA, (c) => c.query("UPDATE business_events SET aggregate_id = 'changed'")),
    ).rejects.toThrow(/permission denied/);
    await expect(withTenant(app, tenantA, (c) => c.query('DELETE FROM business_events'))).rejects.toThrow(
      /permission denied/,
    );
  });

  it('rejects updates, deletes and truncation even by the table owner', async () => {
    // Row-level protection fires per row, so make sure there are rows to protect.
    await withTenant(app, tenantA, (c) => recordAudit(c, { action: 'owner.delete_probe' }));
    await expect(owner.query("UPDATE business_events SET aggregate_id = 'changed'")).rejects.toThrow(/append-only/);
    await expect(owner.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
    await expect(owner.query('TRUNCATE business_events CASCADE')).rejects.toThrow(/append-only/);
  });

  it('records audit entries for the current tenant only', async () => {
    await withTenant(app, tenantA, (c) => recordAudit(c, { action: 'test.performed', targetType: 'none' }));
    const seenByB = await withTenant(app, tenantB, (c) =>
      c.query("SELECT 1 FROM audit_log WHERE action = 'test.performed'"),
    );
    expect(seenByB.rowCount).toBe(0);
  });
});

describe('event and outbox atomicity', () => {
  it('writes the event and its outbox rows together', async () => {
    const { eventId } = await withTenant(app, tenantA, (c) => recordEvent(c, sampleEvent('cyl-A3')));
    const outbox = await withTenant(app, tenantA, (c) =>
      c.query('SELECT topic FROM outbox WHERE event_id = $1', [eventId]),
    );
    expect(outbox.rows).toEqual([{ topic: 'reporting.refresh' }]);
  });

  it('leaves neither behind when the transaction fails', async () => {
    await expect(
      withTenant(app, tenantA, async (c) => {
        await recordEvent(c, sampleEvent('cyl-rolled-back'));
        throw new Error('business rule failed');
      }),
    ).rejects.toThrow('business rule failed');

    const events = await withTenant(app, tenantA, (c) =>
      c.query("SELECT 1 FROM business_events WHERE aggregate_id = 'cyl-rolled-back'"),
    );
    expect(events.rowCount).toBe(0);
  });
});

describe('migrations', () => {
  it('is safe to run again', async () => {
    const result = await migrate(owner, MIGRATIONS);
    expect(result.applied).toEqual([]);
    expect(result.alreadyApplied).toContain('0001_foundation.sql');
  });

  it('refuses to run when an applied migration was changed', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ilacore-migrations-'));
    const original = await readFile(join(MIGRATIONS, '0001_foundation.sql'), 'utf8');
    await writeFile(join(dir, '0001_foundation.sql'), `${original}\n-- edited after the fact\n`);
    await expect(migrate(owner, dir)).rejects.toThrow(MigrationChecksumError);
  });
});
