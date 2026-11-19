/**
 * End-to-end tests for step 3: cylinder sizes and settings, registering cylinders (one and bulk),
 * the register and its safety filter, a cylinder's page, tag replacement, scan sessions fed by the
 * reader simulator, the database guards, and tenant isolation.
 */
import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { normalizeEpc, safetyState, todayInKenya } from '@ilacore/domain';
import { ReaderApiClient, runScenario } from '@ilacore/reader-sim';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionOrganisation } from '../src/access/provisioning.js';
import { AppModule } from '../src/app.module.js';
import { migrate } from '../src/db/migrate.js';
import { withTenant } from '../src/db/tenant-transaction.js';
import { configureApp } from '../src/http/configure-app.js';
import { hashSecret } from '../src/identity/hashing.js';
import { formatDeviceCredential, newSecret, sha256 } from '../src/identity/tokens.js';
import { base32Decode, totp } from '../src/identity/totp.js';
import { startTestDatabase, type TestDatabase } from './support/test-database.js';

const PASSWORD = 'cylinder-depot-sunrise-7';
const LOADER_PIN = '480317';

let db: TestDatabase;
let owner: Pool;
let app: NestExpressApplication;
let base: string;
let tenantId: string;
let otherTenantId: string;
let depotA: string;
let depotB: string;
let size13: string;
let size6: string;
let ownerCookie: string;
let supervisorCookie: string;
let otherSupervisorCookie: string;
let readerCredential: string;

interface Reply {
  status: number;
  body: Record<string, unknown> & { error?: string };
}

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; auth?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers['cookie'] = opts.cookie;
  if (opts.auth) headers['authorization'] = opts.auth;
  const res = await fetch(`${base}${path}`, { method, headers, ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}) });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {} };
}

async function signIn(org: string, phone: string): Promise<string> {
  const res = await fetch(`${base}/auth/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ organisation: org, phone, password: PASSWORD }),
  });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith('lpg_session='));
  if (!cookie) throw new Error(`sign-in failed: ${res.status}`);
  return cookie.split(';')[0]!;
}

/** Adds a person with roles straight into the database (provisioning-style, inside the tenant's scope). */
async function addPerson(
  tenant: string,
  phone: string,
  name: string,
  roles: { role: string; locationId: string | null }[],
  pin?: string,
): Promise<void> {
  const passwordHash = await hashSecret(PASSWORD);
  const pinHash = pin ? await hashSecret(pin) : null;
  await withTenant(owner, tenant, async (c) => {
    const u = await c.query<{ id: string }>(
      `INSERT INTO users (tenant_id, phone, display_name, password_hash, pin_hash) VALUES (current_tenant_id(), $1, $2, $3, $4) RETURNING id`,
      [phone, name, passwordHash, pinHash],
    );
    for (const r of roles) {
      await c.query('INSERT INTO role_assignments (tenant_id, user_id, role, location_id) VALUES (current_tenant_id(), $1, $2, $3)', [
        u.rows[0]!.id, r.role, r.locationId,
      ]);
    }
  });
}

async function addLocation(tenant: string, name: string): Promise<string> {
  return withTenant(owner, tenant, async (c) => {
    const r = await c.query<{ id: string }>(`INSERT INTO locations (tenant_id, name, kind) VALUES (current_tenant_id(), $1, 'depot') RETURNING id`, [name]);
    return r.rows[0]!.id;
  });
}

let tagCounter = 0;
/** A fresh 96-bit tag number. */
const newEpc = () => `E2801160${String(Date.now() % 1e8).padStart(8, '0')}${String(++tagCounter).padStart(8, '0')}`;

beforeAll(async () => {
  db = await startTestDatabase();
  owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
  await migrate(owner, join(__dirname, '..', 'migrations'));
  const appUrl = await db.createAppLogin();

  ({ tenantId } = await provisionOrganisation(owner, {
    organisationName: 'Acme Gas Ltd',
    slug: 'acme-gas',
    admin: { phone: '0711000001', displayName: 'Jane Admin', password: PASSWORD },
  }));
  ({ tenantId: otherTenantId } = await provisionOrganisation(owner, {
    organisationName: 'Other Gas Ltd',
    slug: 'other-gas',
    admin: { phone: '0711000001', displayName: 'Other Admin', password: PASSWORD },
  }));
  depotA = await addLocation(tenantId, 'Nakuru depot');
  depotB = await addLocation(tenantId, 'Eldoret depot');
  const otherDepot = await addLocation(otherTenantId, 'Other depot');

  await addPerson(tenantId, '+254711000010', 'Olive Owner', [{ role: 'owner', locationId: null }]);
  await addPerson(tenantId, '+254711000011', 'Sam Supervisor', [{ role: 'depot_supervisor', locationId: depotA }]);
  await addPerson(tenantId, '+254711000012', 'Lucy Loader', [{ role: 'loader', locationId: depotA }], LOADER_PIN);
  await addPerson(otherTenantId, '+254711000011', 'Other Supervisor', [{ role: 'depot_supervisor', locationId: otherDepot }]);

  // A registered reader at depot A.
  const deviceId = randomUUID();
  const secret = newSecret();
  await withTenant(owner, tenantId, (c) =>
    c.query(`INSERT INTO devices (id, tenant_id, name, kind, location_id, secret_hash) VALUES ($1, current_tenant_id(), 'Gate reader', 'reader', $2, $3)`, [
      deviceId, depotA, sha256(secret),
    ]),
  );
  readerCredential = formatDeviceCredential({ tenantId, deviceId, secret });

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: appUrl,
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  });
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();

  // The owner holds settings.manage, so MFA is set up on first sign-in.
  ownerCookie = await signIn('acme-gas', '0711000010');
  const setup = await call('POST', '/auth/mfa/setup', { cookie: ownerCookie });
  const confirm = await call('POST', '/auth/mfa/confirm', {
    cookie: ownerCookie,
    body: { code: totp(base32Decode(setup.body.secret as string), Date.now()) },
  });
  expect(confirm.status).toBe(200);
  supervisorCookie = await signIn('acme-gas', '0711000011');
  otherSupervisorCookie = await signIn('other-gas', '0711000011');
}, 240_000);

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await db?.dispose();
});

describe('cylinder sizes and settings', () => {
  it('starts every organisation with 6, 13 and 50 kg and no retest interval', async () => {
    const r = await call('GET', '/cylinder-settings', { cookie: supervisorCookie });
    expect(r.status).toBe(200);
    expect(r.body.retestIntervalMonths).toBeNull();
    const sizes = r.body.sizes as { id: string; name: string; nominalFillKg: number }[];
    expect(sizes.map((s) => s.name)).toEqual(['6 kg', '13 kg', '50 kg']);
    size6 = sizes[0]!.id;
    size13 = sizes[1]!.id;
  });

  it('lets the owner add, refuse duplicates and retire sizes', async () => {
    const add = await call('POST', '/cylinder-settings/sizes', { cookie: ownerCookie, body: { name: '22.5 kg', nominalFillKg: 22.5 } });
    expect(add.status).toBe(201);
    expect((await call('POST', '/cylinder-settings/sizes', { cookie: ownerCookie, body: { name: '22.5 KG', nominalFillKg: 22.5 } })).body.error).toBe('name_in_use');
    expect((await call('POST', '/cylinder-settings/sizes', { cookie: ownerCookie, body: { name: '3 kg', nominalFillKg: -3 } })).status).toBe(400);
    expect((await call('POST', `/cylinder-settings/sizes/${add.body.id}/retire`, { cookie: ownerCookie })).status).toBe(204);
    const r = await call('GET', '/cylinder-settings', { cookie: ownerCookie });
    expect((r.body.sizes as { name: string; retired: boolean }[]).find((s) => s.name === '22.5 kg')?.retired).toBe(true);
  });

  it('only lets the owner change settings', async () => {
    expect((await call('PUT', '/cylinder-settings/retest-interval', { cookie: supervisorCookie, body: { months: 60 } })).status).toBe(403);
    expect((await call('POST', '/cylinder-settings/sizes', { cookie: supervisorCookie, body: { name: '9 kg', nominalFillKg: 9 } })).status).toBe(403);
  });
});

describe('registering cylinders', () => {
  it('registers one at the supervisor\'s depot, not at another', async () => {
    const epc = newEpc();
    const ok = await call('POST', '/cylinders', {
      cookie: supervisorCookie,
      body: { locationId: depotA, sizeId: size13, epc: epc.toLowerCase(), serial: ' ab 1001 ', manufacturer: 'Kenpipe', tareKg: 15.2, lastTestOn: '2024-03-01' },
    });
    expect(ok.status).toBe(201);
    const away = await call('POST', '/cylinders', { cookie: supervisorCookie, body: { locationId: depotB, sizeId: size13, epc: newEpc() } });
    expect(away.status).toBe(403);
    const detail = await call('GET', `/cylinders/${ok.body.id}`, { cookie: supervisorCookie });
    expect(detail.body).toMatchObject({ epc, serial: 'AB 1001', manufacturer: 'Kenpipe', tareKg: 15.2, physicalState: 'empty' });
  });

  it('reports every problem by row and saves nothing when a list has one', async () => {
    const dup = newEpc();
    const r = await call('POST', '/cylinders/import', {
      cookie: supervisorCookie,
      body: {
        locationId: depotA,
        cylinders: [
          { sizeId: size13, epc: newEpc(), lastTestOn: '2099-01-01' },
          { sizeId: size13, epc: 'not a tag' },
          { sizeId: size6, epc: newEpc() },
        ],
      },
    });
    expect(r.status).toBe(400);
    expect(r.body.rows).toEqual([
      { row: 0, fields: ['lastTestOn'] },
      { row: 1, fields: ['epc'] },
    ]);
    const twice = await call('POST', '/cylinders/import', {
      cookie: supervisorCookie,
      body: { locationId: depotA, cylinders: [{ sizeId: size6, epc: dup }, { sizeId: size6, epc: dup }] },
    });
    expect(twice.body.rows).toEqual([{ row: 1, fields: ['epc'], reason: 'duplicate_in_list' }]);
    const list = await call('GET', `/cylinders?locationId=${depotA}`, { cookie: supervisorCookie });
    expect(list.body.total).toBe(1);
  });

  it('refuses a tag or serial that is already registered, and a retired size', async () => {
    const existing = (await call('GET', `/cylinders?locationId=${depotA}`, { cookie: supervisorCookie })).body.cylinders as { epc: string }[];
    const sizes = (await call('GET', '/cylinder-settings', { cookie: supervisorCookie })).body.sizes as { id: string; retired: boolean }[];
    const retired = sizes.find((s) => s.retired)!.id;
    const r = await call('POST', '/cylinders/import', {
      cookie: supervisorCookie,
      body: {
        locationId: depotA,
        cylinders: [
          { sizeId: size13, epc: existing[0]!.epc },
          // Same serial and manufacturer, typed differently.
          { sizeId: size13, epc: newEpc(), serial: 'ab 1001', manufacturer: 'kenpipe' },
          { sizeId: retired, epc: newEpc() },
        ],
      },
    });
    expect(r.body.rows).toEqual([
      { row: 0, fields: ['epc'], reason: 'tag_in_use' },
      { row: 1, fields: ['serial'], reason: 'serial_in_use' },
      { row: 2, fields: ['sizeId'], reason: 'unknown_size' },
    ]);
  });

  it('imports hundreds at once', async () => {
    const cylinders = Array.from({ length: 300 }, (_, i) => ({ sizeId: i % 2 ? size6 : size13, epc: newEpc(), serial: `BULK-${i}`, physicalState: 'full' as const }));
    const r = await call('POST', '/cylinders/import', { cookie: supervisorCookie, body: { locationId: depotA, cylinders } });
    expect(r.status).toBe(201);
    expect((r.body.ids as string[]).length).toBe(300);
    const events = await withTenant(owner, tenantId, (c) =>
      c.query<{ n: string }>(`SELECT count(*) AS n FROM business_events WHERE event_type = 'item.registered'`),
    );
    expect(Number(events.rows[0]!.n)).toBe(301);
  });
});

describe('the register and safety', () => {
  const cases: { lastTestOn?: string; nextTestDue?: string }[] = [
    { lastTestOn: '2024-03-01' },
    {},
    { lastTestOn: '2016-01-01', nextTestDue: '2021-01-01' },
    { lastTestOn: '2021-01-01', nextTestDue: '2026-11-25' },
  ];
  const ids: string[] = [];

  beforeAll(async () => {
    for (const c of cases) {
      const r = await call('POST', '/cylinders', { cookie: supervisorCookie, body: { locationId: depotA, sizeId: size13, epc: newEpc(), ...c } });
      ids.push(r.body.id as string);
    }
  });

  it('works out safety in the database exactly as the domain rule does, before and after the interval is set', async () => {
    for (const interval of [null, 60]) {
      expect((await call('PUT', '/cylinder-settings/retest-interval', { cookie: ownerCookie, body: { months: interval } })).status).toBe(204);
      for (const [i, id] of ids.entries()) {
        const d = (await call('GET', `/cylinders/${id}`, { cookie: supervisorCookie })).body;
        const due = cases[i]!.nextTestDue ?? (cases[i]!.lastTestOn && interval ? (d.nextTestDue as string) : null);
        expect(d.safety).toBe(safetyState({ hold: 'none', nextTestDue: due, today: todayInKenya() }));
      }
    }
    const first = (await call('GET', `/cylinders/${ids[0]}`, { cookie: supervisorCookie })).body;
    expect(first).toMatchObject({ lastTestOn: '2024-03-01', nextTestDue: '2029-03-01', testDateKnown: true, safety: 'eligible' });
    const unknown = (await call('GET', `/cylinders/${ids[1]}`, { cookie: supervisorCookie })).body;
    expect(unknown).toMatchObject({ nextTestDue: null, testDateKnown: false, safety: 'retest_due' });
  });

  it('filters by safety, size, state and search', async () => {
    const overdue = await call('GET', `/cylinders?locationId=${depotA}&safety=retest_overdue`, { cookie: supervisorCookie });
    expect((overdue.body.cylinders as { id: string }[]).map((c) => c.id)).toEqual([ids[2]]);
    const full6 = await call('GET', `/cylinders?locationId=${depotA}&sizeId=${size6}&physicalState=full&limit=5`, { cookie: supervisorCookie });
    expect(full6.body.total).toBe(150);
    expect((full6.body.cylinders as unknown[]).length).toBe(5);
    const search = await call('GET', `/cylinders?locationId=${depotA}&search=bulk-29`, { cookie: supervisorCookie });
    expect((search.body.cylinders as { serial: string }[]).map((c) => c.serial).sort()).toEqual(
      ['BULK-29', ...Array.from({ length: 10 }, (_, i) => `BULK-29${i}`)],
    );
  });

  it('needs an organisation-wide grant to list without a location', async () => {
    expect((await call('GET', '/cylinders', { cookie: supervisorCookie })).status).toBe(403);
    expect((await call('GET', `/cylinders?locationId=${depotB}`, { cookie: supervisorCookie })).status).toBe(403);
    const all = await call('GET', '/cylinders', { cookie: ownerCookie });
    expect(all.status).toBe(200);
    expect(all.body.total).toBe(305);
  });
});

describe('a cylinder\'s page and tag replacement', () => {
  let id: string;
  let firstEpc: string;

  beforeAll(async () => {
    firstEpc = newEpc();
    id = (await call('POST', '/cylinders', { cookie: supervisorCookie, body: { locationId: depotA, sizeId: size6, epc: firstEpc, serial: 'TAG-1' } })).body.id as string;
  });

  it('shows the history and hides the security dimension from non-investigators', async () => {
    const d = (await call('GET', `/cylinders/${id}`, { cookie: supervisorCookie })).body;
    expect((d.history as { type: string; actor: string }[]).map((h) => [h.type, h.actor])).toEqual([['item.registered', 'Sam Supervisor']]);
    expect(d).not.toHaveProperty('security');
    expect(d.custody).toMatchObject({ kind: 'depot', locationId: depotA, locationName: 'Nakuru depot' });
  });

  it('replaces a tag, keeps the identity and never lets the old tag back in', async () => {
    const second = newEpc();
    const r = await call('POST', `/cylinders/${id}/tag`, { cookie: supervisorCookie, body: { epc: second, reason: 'damaged' } });
    expect(r.status).toBe(201);
    const d = (await call('GET', `/cylinders/${id}`, { cookie: supervisorCookie })).body;
    expect(d.epc).toBe(second);
    expect((d.tags as { epc: string; retireReason: string | null }[]).map((t) => [t.epc, t.retireReason])).toEqual([[firstEpc, 'damaged'], [second, null]]);
    expect((d.history as { type: string }[]).map((h) => h.type)).toEqual(['item.registered', 'item.tag_replaced']);

    const reuse = await call('POST', '/cylinders', { cookie: supervisorCookie, body: { locationId: depotA, sizeId: size6, epc: firstEpc } });
    expect(reuse.body.rows).toEqual([{ row: 0, fields: ['epc'], reason: 'tag_retired' }]);
    expect((await call('POST', `/cylinders/${id}/tag`, { cookie: supervisorCookie, body: { epc: firstEpc, reason: 'lost' } })).body.error).toBe('tag_retired');
    expect((await call('POST', `/cylinders/${id}/tag`, { cookie: supervisorCookie, body: { epc: second, reason: 'lost' } })).body.error).toBe('same_tag');

    const byOld = await call('GET', `/cylinders/by-tag/${firstEpc}`, { cookie: supervisorCookie });
    expect(byOld.body).toMatchObject({ id, matchedTag: { epc: firstEpc, retired: true } });
    expect((await call('GET', `/cylinders/by-tag/${newEpc()}`, { cookie: supervisorCookie })).body.error).toBe('unknown_tag');
  });

  it('hides the cylinder from another organisation', async () => {
    expect((await call('GET', `/cylinders/${id}`, { cookie: otherSupervisorCookie })).status).toBe(404);
    expect((await call('POST', `/cylinders/${id}/tag`, { cookie: otherSupervisorCookie, body: { epc: newEpc(), reason: 'lost' } })).status).toBe(404);
  });

  it('enforces tag rules in the database too', async () => {
    await expect(
      withTenant(owner, tenantId, (c) => c.query(`UPDATE item_tags SET retired_at = NULL, retire_reason = NULL WHERE epc = $1`, [firstEpc])),
    ).rejects.toThrow(/retired/);
    await expect(withTenant(owner, tenantId, (c) => c.query(`DELETE FROM item_tags WHERE epc = $1`, [firstEpc]))).rejects.toThrow(/append-only/);
  });
});

describe('scan sessions with the reader simulator', () => {
  let load: string[];

  beforeAll(async () => {
    const list = await call('GET', `/cylinders?locationId=${depotA}&search=BULK&limit=40`, { cookie: supervisorCookie });
    load = (list.body.cylinders as { epc: string }[]).map((c) => c.epc);
    expect(load).toHaveLength(40);
  });

  it('records a dispatch of 40 with 2 missed and 1 stray, merging duplicates, and accepts a retried batch once', async () => {
    const client = new ReaderApiClient(base);
    await client.signIn({ credential: readerCredential, phone: '0711000012', pin: LOADER_PIN });
    const sessionId = await client.openSession({ purpose: 'dispatch', locationId: depotA });
    const scenario = runScenario({ expected: load, missed: 2, strays: 1, seed: 11 });
    const sent = await client.sendReads(sessionId, scenario.reads);
    expect(sent.accepted).toBe(scenario.reads.length);

    const detail = (await call('GET', `/scan-sessions/${sessionId}`, { cookie: supervisorCookie })).body;
    expect(detail.counts).toEqual({ active: 38, retired: 0, unknown: 1 });
    expect(detail.rawReads).toBe(scenario.reads.length);
    const seen = detail.seen as { epc: string; tag: string }[];
    expect(seen.find((s) => s.tag === 'unknown')?.epc).toBe(normalizeEpc(scenario.strays[0]!));
    for (const m of scenario.missed) expect(seen.some((s) => s.epc === m)).toBe(false);

    // A retried upload with the same batch id is stored once.
    const signed = await call('POST', '/auth/device/sign-in', { auth: `Device ${readerCredential}`, body: { phone: '0711000012', pin: LOADER_PIN } });
    const auth = `Bearer ${signed.body.token as string}`;
    const batch = { batchId: randomUUID(), reads: [{ epc: load[0]!, rssi: -50, antenna: 1, readAt: new Date().toISOString() }] };
    expect((await call('POST', `/scan-sessions/${sessionId}/reads`, { auth, body: batch })).body).toEqual({ accepted: 1, duplicateBatch: false });
    expect((await call('POST', `/scan-sessions/${sessionId}/reads`, { auth, body: batch })).body).toEqual({ accepted: 0, duplicateBatch: true });

    await client.closeSession(sessionId);
    const late = await call('POST', `/scan-sessions/${sessionId}/reads`, { auth, body: { ...batch, batchId: randomUUID() } });
    expect(late.body.error).toBe('session_closed');
    await client.signOut();

    // Scans never change state: the cylinders are still full at the depot.
    const still = await call('GET', `/cylinders/by-tag/${load[0]}`, { cookie: supervisorCookie });
    expect(still.body).toMatchObject({ physicalState: 'full', custody: { kind: 'depot', locationId: depotA } });
  });

  it('only takes reads from the reader that opened the session, for purposes the person may scan', async () => {
    const client = new ReaderApiClient(base);
    await client.signIn({ credential: readerCredential, phone: '0711000012', pin: LOADER_PIN });
    await expect(client.openSession({ purpose: 'stocktake', locationId: depotA })).rejects.toMatchObject({ status: 403 });
    await expect(client.openSession({ purpose: 'dispatch', locationId: depotB })).rejects.toMatchObject({ status: 403 });
    const sessionId = await client.openSession({ purpose: 'dispatch', locationId: depotA });
    // The supervisor (on the web, without dispatch.scan) may not push reads into the reader's session.
    const r = await call('POST', `/scan-sessions/${sessionId}/reads`, { cookie: supervisorCookie, body: { batchId: randomUUID(), reads: [] } });
    expect(r.status).toBe(403);
    const bad = await call('POST', `/scan-sessions/${sessionId}/reads`, {
      cookie: supervisorCookie,
      body: { batchId: randomUUID(), reads: [{ epc: 'zz', readAt: 'soon' }] },
    });
    expect(bad.status).toBe(400);
    await client.signOut();
  });

  it('lists sessions for people at that depot only', async () => {
    const mine = await call('GET', '/scan-sessions', { cookie: supervisorCookie });
    expect(mine.body as unknown as unknown[]).toHaveLength(2);
    const other = await call('GET', '/scan-sessions', { cookie: otherSupervisorCookie });
    expect(other.body).toEqual([]);
  });

  it('keeps raw reads append-only', async () => {
    await expect(withTenant(owner, tenantId, (c) => c.query('DELETE FROM scan_reads'))).rejects.toThrow(/append-only/);
  });
});
