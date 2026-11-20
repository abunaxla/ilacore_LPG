/**
 * End-to-end tests for dispatch: opening a trip, building the load (with the checks and exceptions), separation
 * of duties, the driver signing for the load (custody moves to the truck), returns back into the depot,
 * cancelling, who can see what, and tenant isolation.
 */
import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
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
import { startTestDatabase, type TestDatabase } from './support/test-database.js';

const PASSWORD = 'cylinder-depot-sunrise-7';
const PIN = '480317';

let db: TestDatabase;
let owner: Pool;
let app: NestExpressApplication;
let base: string;
let tenantId: string;
let otherTenantId: string;
let depotA: string;
let depotB: string;
let handheld: string;
let supervisorCookie: string;
let otherSupervisorCookie: string;
let loader: string;
let dual: string;
let driver: string;
let driverId: string;
let loaderId: string;

interface Reply {
  status: number;
  body: Record<string, unknown> & { error?: string };
}

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; token?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers['cookie'] = opts.cookie;
  if (opts.token) headers['authorization'] = `Bearer ${opts.token}`;
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

async function deviceSignIn(phone: string): Promise<string> {
  const res = await fetch(`${base}/auth/device/sign-in`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Device ${handheld}` },
    body: JSON.stringify({ phone, pin: PIN }),
  });
  const body = (await res.json()) as { token?: string };
  if (!body.token) throw new Error(`device sign-in failed: ${res.status}`);
  return body.token;
}

async function addPerson(tenant: string, phone: string, name: string, roles: { role: string; locationId: string | null }[]): Promise<string> {
  const passwordHash = await hashSecret(PASSWORD);
  const pinHash = await hashSecret(PIN);
  return withTenant(owner, tenant, async (c) => {
    const u = await c.query<{ id: string }>(
      `INSERT INTO users (tenant_id, phone, display_name, password_hash, pin_hash) VALUES (current_tenant_id(), $1, $2, $3, $4) RETURNING id`,
      [phone, name, passwordHash, pinHash],
    );
    for (const r of roles) {
      await c.query('INSERT INTO role_assignments (tenant_id, user_id, role, location_id) VALUES (current_tenant_id(), $1, $2, $3)', [
        u.rows[0]!.id, r.role, r.locationId,
      ]);
    }
    return u.rows[0]!.id;
  });
}

async function addLocation(tenant: string, name: string): Promise<string> {
  return withTenant(owner, tenant, async (c) => {
    const r = await c.query<{ id: string }>(`INSERT INTO locations (tenant_id, name, kind) VALUES (current_tenant_id(), $1, 'depot') RETURNING id`, [name]);
    return r.rows[0]!.id;
  });
}

let tagCounter = 0;
const newEpc = () => `E2801170${String(Date.now() % 1e8).padStart(8, '0')}${String(++tagCounter).padStart(8, '0')}`;

/** Registers a cylinder through the API as the supervisor of `depot`. Returns its tag and id. */
async function cylinder(cookie: string, depot: string, physicalState: 'full' | 'empty' = 'full'): Promise<{ epc: string; id: string }> {
  const sizes = (await call('GET', '/cylinder-settings', { cookie })).body.sizes as { id: string }[];
  const epc = newEpc();
  const r = await call('POST', '/cylinders', { cookie, body: { locationId: depot, sizeId: sizes[1]!.id, epc, physicalState } });
  expect(r.status).toBe(201);
  return { epc, id: r.body.id as string };
}

async function openTrip(token: string, reg = 'KCA 123A'): Promise<string> {
  const r = await call('POST', '/trips', { token, body: { depotId: depotA, driverId, vehicleReg: reg } });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

const outcomeOf = (r: Reply, epc: string) => (r.body.outcomes as { epc: string }[]).find((o) => o.epc === epc);

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

  await addPerson(tenantId, '+254711000011', 'Sam Supervisor', [{ role: 'depot_supervisor', locationId: depotA }]);
  await addPerson(tenantId, '+254711000014', 'Bea Supervisor', [{ role: 'depot_supervisor', locationId: depotB }]);
  loaderId = await addPerson(tenantId, '+254711000012', 'Lucy Loader', [{ role: 'loader', locationId: depotA }]);
  driverId = await addPerson(tenantId, '+254711000013', 'Dan Driver', [{ role: 'driver', locationId: depotA }]);
  // Holds both jobs, so separation of duties has to stop them approving their own load.
  await addPerson(tenantId, '+254711000015', 'Duo Both', [
    { role: 'loader', locationId: depotA },
    { role: 'depot_supervisor', locationId: depotA },
  ]);
  await addPerson(otherTenantId, '+254711000011', 'Other Supervisor', [{ role: 'depot_supervisor', locationId: otherDepot }]);

  const deviceId = randomUUID();
  const secret = newSecret();
  await withTenant(owner, tenantId, (c) =>
    c.query(`INSERT INTO devices (id, tenant_id, name, kind, location_id, secret_hash) VALUES ($1, current_tenant_id(), 'Yard handheld', 'handheld', $2, $3)`, [
      deviceId, depotA, sha256(secret),
    ]),
  );
  handheld = formatDeviceCredential({ tenantId, deviceId, secret });

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: appUrl,
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  });
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();

  supervisorCookie = await signIn('acme-gas', '0711000011');
  otherSupervisorCookie = await signIn('other-gas', '0711000011');
  loader = await deviceSignIn('0711000012');
  driver = await deviceSignIn('0711000013');
  dual = await deviceSignIn('0711000015');
}, 240_000);

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await db?.dispose();
});

describe('opening a trip', () => {
  it('lists the depot\'s drivers to the loader and opens a trip with a cleaned number plate', async () => {
    const drivers = await call('GET', `/trips/drivers?depotId=${depotA}`, { token: loader });
    expect(drivers.body).toEqual([{ id: driverId, name: 'Dan Driver' }]);
    const id = await openTrip(loader, 'kca-123 a');
    const trip = await call('GET', `/trips/${id}`, { token: loader });
    expect(trip.body).toMatchObject({ vehicleReg: 'KCA123A', status: 'loading', driver: { name: 'Dan Driver' }, openedBy: 'Lucy Loader' });
  });

  it('refuses someone who is not a driver, a bad plate, another depot and people who don\'t load', async () => {
    const notDriver = await call('POST', '/trips', { token: loader, body: { depotId: depotA, driverId: loaderId, vehicleReg: 'KCB1' } });
    expect(notDriver.body.error).toBe('not_a_driver');
    const plate = await call('POST', '/trips', { token: loader, body: { depotId: depotA, driverId, vehicleReg: '?' } });
    expect(plate.status).toBe(400);
    expect((await call('POST', '/trips', { token: loader, body: { depotId: depotB, driverId, vehicleReg: 'KCB1' } })).status).toBe(403);
    expect((await call('POST', '/trips', { cookie: supervisorCookie, body: { depotId: depotA, driverId, vehicleReg: 'KCB1' } })).status).toBe(403);
  });
});

describe('a trip from loading to return', () => {
  let trip: string;
  let full1: { epc: string; id: string };
  let full2: { epc: string; id: string };
  let empty1: { epc: string; id: string };
  let fromB: { epc: string; id: string };
  let held: { epc: string; id: string };

  beforeAll(async () => {
    full1 = await cylinder(supervisorCookie, depotA);
    full2 = await cylinder(supervisorCookie, depotA);
    empty1 = await cylinder(supervisorCookie, depotA, 'empty');
    held = await cylinder(supervisorCookie, depotA);
    fromB = await cylinder(await signIn('acme-gas', '0711000014'), depotB);
    await withTenant(owner, tenantId, (c) => c.query(`UPDATE cylinders SET safety_hold = 'quarantined' WHERE item_id = $1`, [held.id]));
    trip = await openTrip(loader);
  });

  it('gives every scanned tag an outcome: added, odd (needs approval) or refused', async () => {
    const unknown = newEpc();
    const r = await call('POST', `/trips/${trip}/load`, {
      token: loader,
      body: { epcs: [full1.epc, full2.epc, empty1.epc, fromB.epc, held.epc, unknown, 'junk', full1.epc.toLowerCase()] },
    });
    expect(r.status).toBe(200);
    expect(outcomeOf(r, full1.epc)).toMatchObject({ result: 'added', exception: null });
    expect(outcomeOf(r, full2.epc)).toMatchObject({ result: 'added', exception: null });
    expect(outcomeOf(r, empty1.epc)).toMatchObject({ result: 'added', exception: 'not_full' });
    expect(outcomeOf(r, fromB.epc)).toMatchObject({ result: 'added', exception: 'not_at_depot' });
    expect(outcomeOf(r, held.epc)).toMatchObject({ result: 'blocked', reason: 'on_hold' });
    expect(outcomeOf(r, unknown)).toMatchObject({ result: 'blocked', reason: 'unknown_tag' });
    expect(outcomeOf(r, 'junk')).toMatchObject({ result: 'blocked', reason: 'not_a_tag' });
    expect((r.body.outcomes as unknown[]).length).toBe(7);

    const again = await call('POST', `/trips/${trip}/load`, { token: loader, body: { epcs: [full1.epc] } });
    expect(outcomeOf(again, full1.epc)).toMatchObject({ result: 'already_on_trip' });
  });

  it('never puts one cylinder on two trucks', async () => {
    const other = await openTrip(loader, 'KCZ 999Z');
    const r = await call('POST', `/trips/${other}/load`, { token: loader, body: { epcs: [full1.epc] } });
    expect(outcomeOf(r, full1.epc)).toMatchObject({ result: 'blocked', reason: 'on_another_trip' });
    expect((await call('POST', `/trips/${other}/cancel`, { token: loader })).status).toBe(204);
  });

  it('keeps the driver from signing until a supervisor approves the odd lines', async () => {
    expect((await call('POST', `/trips/${trip}/sign`, { token: driver })).body.error).toBe('needs_approval');
    // The loader can't approve, and neither can someone who loaded part of this truck.
    expect((await call('POST', `/trips/${trip}/lines/${empty1.id}/approve`, { token: loader })).status).toBe(403);
    const extra = await cylinder(supervisorCookie, depotA);
    await call('POST', `/trips/${trip}/load`, { token: dual, body: { epcs: [extra.epc] } });
    expect((await call('POST', `/trips/${trip}/lines/${empty1.id}/approve`, { token: dual })).body.error).toBe('separation_of_duties');
    expect((await call('POST', `/trips/${trip}/lines/${extra.id}/remove`, { token: loader })).status).toBe(204);

    expect((await call('POST', `/trips/${trip}/lines/${empty1.id}/approve`, { cookie: supervisorCookie })).status).toBe(204);
    expect((await call('POST', `/trips/${trip}/lines/${fromB.id}/approve`, { cookie: supervisorCookie })).status).toBe(204);
    expect((await call('POST', `/trips/${trip}/lines/${full1.id}/approve`, { cookie: supervisorCookie })).body.error).toBe('nothing_to_approve');
    const view = await call('GET', `/trips/${trip}`, { cookie: supervisorCookie });
    expect(view.body.counts).toMatchObject({ loaded: 4, needsApproval: 0 });
  });

  it('lets only the trip\'s driver sign, and then the cylinders are on the truck', async () => {
    expect((await call('POST', `/trips/${trip}/lines/${full2.id}/remove`, { token: loader })).status).toBe(204);
    expect((await call('POST', `/trips/${trip}/sign`, { token: loader })).status).toBe(403);
    const signed = await call('POST', `/trips/${trip}/sign`, { token: driver });
    expect(signed.status).toBe(200);
    expect(signed.body.loaded).toBe(3);

    const onTruck = await call('GET', `/cylinders/${fromB.id}`, { cookie: supervisorCookie });
    expect(onTruck.status).toBe(200);
    expect(onTruck.body.custody).toMatchObject({ kind: 'truck', locationId: null, trip: { id: trip, vehicleReg: 'KCA123A', depotId: depotA } });
    const stillHere = await call('GET', `/cylinders/${full2.id}`, { cookie: supervisorCookie });
    expect(stillHere.body.custody).toMatchObject({ kind: 'depot', locationId: depotA });
    // The depot's register still shows what its trucks carry.
    const register = await call('GET', `/cylinders?locationId=${depotA}&limit=200`, { cookie: supervisorCookie });
    expect(register.body.cylinders.map((x: { id: string }) => x.id)).toEqual(expect.arrayContaining([fromB.id, full2.id]));

    expect((await call('POST', `/trips/${trip}/load`, { token: loader, body: { epcs: [full2.epc] } })).body.error).toBe('trip_not_loading');
    const events = await withTenant(owner, tenantId, (c) =>
      c.query<{ n: string }>(`SELECT count(*) AS n FROM business_events WHERE event_type = 'item.dispatched'`),
    );
    expect(Number(events.rows[0]!.n)).toBe(3);
  });

  it('scans returning cylinders back in, and reports anything that wasn\'t on this truck', async () => {
    const unknown = newEpc();
    const r = await call('POST', `/trips/${trip}/return`, { token: loader, body: { epcs: [full1.epc, full2.epc, unknown], physicalState: 'full' } });
    expect(r.status).toBe(200);
    expect(outcomeOf(r, full1.epc)).toMatchObject({ result: 'returned' });
    expect(outcomeOf(r, full2.epc)).toMatchObject({ result: 'not_on_trip', custody: { kind: 'depot', place: 'Nakuru depot' } });
    expect(outcomeOf(r, unknown)).toMatchObject({ result: 'unknown_tag' });
    const again = await call('POST', `/trips/${trip}/return`, { token: loader, body: { epcs: [full1.epc], physicalState: 'full' } });
    expect(outcomeOf(again, full1.epc)).toMatchObject({ result: 'already_back' });

    const back = await call('GET', `/cylinders/${full1.id}`, { cookie: supervisorCookie });
    expect(back.body).toMatchObject({ physicalState: 'full', custody: { kind: 'depot', locationId: depotA, trip: null } });
    const view = await call('GET', `/trips/${trip}`, { cookie: supervisorCookie });
    expect(view.body).toMatchObject({ status: 'out', counts: { loaded: 3, back: 1, stillOut: 2 } });
  });
});

describe('cancelling and who sees what', () => {
  it('cancels a trip still loading and frees its cylinders', async () => {
    const c1 = await cylinder(supervisorCookie, depotA);
    const t1 = await openTrip(loader, 'KDA 1');
    await call('POST', `/trips/${t1}/load`, { token: loader, body: { epcs: [c1.epc] } });
    expect((await call('POST', `/trips/${t1}/cancel`, { cookie: supervisorCookie })).status).toBe(204);
    expect((await call('POST', `/trips/${t1}/sign`, { token: driver })).body.error).toBe('trip_not_loading');
    const t2 = await openTrip(loader, 'KDA 2');
    const r = await call('POST', `/trips/${t2}/load`, { token: loader, body: { epcs: [c1.epc] } });
    expect(outcomeOf(r, c1.epc)).toMatchObject({ result: 'added' });
  });

  it('shows a driver only their own trips, and another depot\'s supervisor none of these', async () => {
    const mine = (await call('GET', '/trips', { token: driver })).body as unknown as { id: string; driver: { id: string } }[];
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((t) => t.driver.id === driverId)).toBe(true);
    const bea = await signIn('acme-gas', '0711000014');
    expect((await call('GET', '/trips', { cookie: bea })).body).toEqual([]);
    expect((await call('GET', `/trips/${mine[0]!.id}`, { cookie: bea })).status).toBe(403);
  });

  it('keeps organisations apart', async () => {
    const mine = (await call('GET', '/trips', { token: driver })).body as unknown as { id: string }[];
    expect((await call('GET', `/trips/${mine[0]!.id}`, { cookie: otherSupervisorCookie })).status).toBe(404);
    expect((await call('GET', '/trips', { cookie: otherSupervisorCookie })).body).toEqual([]);
  });
});
