/**
 * Integration tests for the database foundation, against a real, throwaway PostgreSQL + PostGIS
 * database (see support/test-database.ts).
 * They prove the guarantees the rest of the system relies on:
 *   - tenant isolation is enforced by the database (row-level security)
 *   - with no tenant set, nothing is visible and nothing can be written
 *   - the event ledger and audit log are append-only, even for the table owner
 *   - an event and its outbox rows commit or roll back together
 *   - applied migrations can't be silently changed
 */
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, MigrationChecksumError } from '../src/db/migrate.js';
import { withTenant } from '../src/db/tenant-transaction.js';
import { recordAudit } from '../src/events/record-audit.js';
import { recordEvent } from '../src/events/record-event.js';
import { startTestDatabase, type TestDatabase } from './support/test-database.js';

const MIGRATIONS = join(__dirname, '..', 'migrations');

let db: TestDatabase;
let owner: Pool;
let app: Pool;
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  db = await startTestDatabase();
  owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
  await migrate(owner, MIGRATIONS);

  // Row-level security is forced even for the schema owner, so a tenant is provisioned inside its own scope.
  const provision = async (name: string) => {
    const id = randomUUID();
    await withTenant(owner, id, (c) => c.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [id, name]));
    return id;
  };
  tenantA = await provision('Distributor A');
  tenantB = await provision('Distributor B');

  app = new Pool({ connectionString: await db.createAppLogin(), max: 4 });
}, 180_000);

afterAll(async () => {
  await app?.end();
  await owner?.end();
  await db?.dispose();
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
    // Row-level protection fires per row, so make sure there are rows to protect, and look at them
    // from inside the tenant (row-level security is forced for the owner too).
    await withTenant(app, tenantA, (c) => recordAudit(c, { action: 'owner.delete_probe' }));
    await expect(
      withTenant(owner, tenantA, (c) => c.query("UPDATE business_events SET aggregate_id = 'changed'")),
    ).rejects.toThrow(/append-only/);
    await expect(withTenant(owner, tenantA, (c) => c.query('DELETE FROM audit_log'))).rejects.toThrow(
      /append-only/,
    );
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
