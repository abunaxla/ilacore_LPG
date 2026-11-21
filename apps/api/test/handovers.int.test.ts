/**
 * End-to-end tests for customers and handovers: registering a customer and checking their number by SMS code
 * (stand-in), a driver's handover from the truck (fulls out, empties in, the balance and its covers), "empties
 * owed" approved by a depot supervisor, the confirmation code, custody moving only on confirmation, disputes,
 * the 15-minute window, and tenant isolation.
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
import { base32Decode, totp } from '../src/identity/totp.js';
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
let supervisor: string;
let otherDepotSupervisor: string;
let finance: string;
let otherFinance: string;
let loader: string;
let driver: string;
let otherDriver: string;
let driverId: string;
let shop: string;
let wholesaler: string;
let trip: string;

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

/** Finance holds MFA permissions, so a first sign-in must set up the authenticator. */
async function signInWithMfa(org: string, phone: string): Promise<string> {
  const cookie = await signIn(org, phone);
  const setup = await call('POST', '/auth/mfa/setup', { cookie });
  const secret = base32Decode(setup.body.secret as string);
  const confirm = await call('POST', '/auth/mfa/confirm', { cookie, body: { code: totp(secret, Date.now()) } });
  if (confirm.status >= 300) throw new Error(`mfa confirm failed: ${confirm.status}`);
  return cookie;
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

/** Registers a 13 kg cylinder at `depot` as a supervisor there. */
async function cylinder(cookie: string, depot: string, physicalState: 'full' | 'empty' = 'full'): Promise<{ epc: string; id: string }> {
  const sizes = (await call('GET', '/cylinder-settings', { cookie })).body.sizes as { id: string; name: string }[];
  const epc = newEpc();
  const r = await call('POST', '/cylinders', { cookie, body: { locationId: depot, sizeId: sizes[1]!.id, epc, physicalState } });
  expect(r.status).toBe(201);
  return { epc, id: r.body.id as string };
}

/** The latest stand-in message to a number, and the 6-digit code in it. */
async function lastSms(to: string): Promise<{ body: string; code: string }> {
  const r = await call('GET', '/sms/stand-in', { cookie: finance });
  const m = (r.body as unknown as { to: string; body: string }[]).find((x) => x.to === to);
  if (!m) throw new Error(`no message to ${to}`);
  return { body: m.body, code: /(\d{6})/.exec(m.body)![1]! };
}

async function custody(id: string) {
  return withTenant(owner, tenantId, async (c) =>
    (await c.query<{ custody_kind: string; custody_holder_id: string | null; physical_state: string; owner_kind: string }>(
      'SELECT custody_kind, custody_holder_id, physical_state, owner_kind FROM tracked_items WHERE id = $1', [id],
    )).rows[0]!,
  );
}

async function registerShop(name: string, phone: string, extra: Record<string, unknown> = {}): Promise<string> {
  const r = await call('POST', '/customers', { cookie: finance, body: { kind: 'retailer', name, phone, area: 'Kayole', ...extra } });
  expect(r.status).toBe(201);
  return r.body.id as string;
}

async function verify(id: string, phone: string): Promise<void> {
  const { code } = await lastSms(phone);
  expect((await call('POST', `/customers/${id}/phone-check/verify`, { cookie: finance, body: { code } })).status).toBe(204);
}

const outcome = (r: Reply, epc: string) => (r.body.outcomes as { epc: string }[]).find((o) => o.epc === epc);

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

  await addPerson(tenantId, '+254711000011', 'Sam Supervisor', [{ role: 'depot_supervisor', locationId: depotA }]);
  await addPerson(tenantId, '+254711000014', 'Bea Supervisor', [{ role: 'depot_supervisor', locationId: depotB }]);
  await addPerson(tenantId, '+254711000012', 'Lucy Loader', [{ role: 'loader', locationId: depotA }]);
  driverId = await addPerson(tenantId, '+254711000013', 'Dan Driver', [{ role: 'driver', locationId: depotA }]);
  await addPerson(tenantId, '+254711000016', 'Dee Driver', [{ role: 'driver', locationId: depotA }]);
  await addPerson(tenantId, '+254711000017', 'Fiona Finance', [{ role: 'finance', locationId: null }]);
  await addPerson(otherTenantId, '+254711000017', 'Other Finance', [{ role: 'finance', locationId: null }]);

  const deviceId = randomUUID();
  const secret = newSecret();
  await withTenant(owner, tenantId, (c) =>
    c.query(`INSERT INTO devices (id, tenant_id, name, kind, location_id, secret_hash) VALUES ($1, current_tenant_id(), 'Truck handheld', 'handheld', $2, $3)`, [
      deviceId, depotA, sha256(secret),
    ]),
  );
  handheld = formatDeviceCredential({ tenantId, deviceId, secret });

  Object.assign(process.env, { NODE_ENV: 'test', DATABASE_URL: appUrl, MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64') });
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();

  supervisor = await signIn('acme-gas', '0711000011');
  otherDepotSupervisor = await signIn('acme-gas', '0711000014');
  finance = await signInWithMfa('acme-gas', '0711000017');
  otherFinance = await signInWithMfa('other-gas', '0711000017');
  loader = await deviceSignIn('0711000012');
  driver = await deviceSignIn('0711000013');
  otherDriver = await deviceSignIn('0711000016');
}, 240_000);

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await db?.dispose();
});

describe('customers', () => {
  it('registers a wholesaler and a retailer billed through it, and checks the number by SMS code', async () => {
    const w = await call('POST', '/customers', { cookie: finance, body: { kind: 'wholesaler', name: 'Rift Gas Wholesale', phone: '0722 000 100' } });
    expect(w.status).toBe(201);
    wholesaler = w.body.id as string;
    shop = await registerShop('Mama Njeri Shop', '0722000001', { billedThrough: wholesaler });

    const sms = await lastSms('+254722000001');
    expect(sms.body).toContain('Mama Njeri Shop');
    const wrong = sms.code === '000000' ? '111111' : '000000';
    expect((await call('POST', `/customers/${shop}/phone-check/verify`, { cookie: finance, body: { code: wrong } })).body.error).toBe('wrong_code');
    await verify(shop, '+254722000001');
    await verify(wholesaler, '+254722000100');

    const got = await call('GET', `/customers/${shop}`, { cookie: finance });
    expect(got.body).toMatchObject({ kind: 'retailer', phone: '+254722000001', phoneVerified: true, billedThrough: { id: wholesaler, name: 'Rift Gas Wholesale' }, emptiesOwed: 0 });
    expect(got.body.labelCode).toMatch(/^[A-Z0-9]{6}$/);
  });

  it('refuses a bad number, a number already taken, billing through a retailer, and people without customer.manage', async () => {
    expect((await call('POST', '/customers', { cookie: finance, body: { kind: 'retailer', name: 'X', phone: '12345' } })).body).toMatchObject({ fields: ['phone'] });
    expect((await call('POST', '/customers', { cookie: finance, body: { kind: 'retailer', name: 'Copy', phone: '+254722000001' } })).body.error).toBe('phone_taken');
    expect((await call('POST', '/customers', { cookie: finance, body: { kind: 'retailer', name: 'Y', phone: '0722000002', billedThrough: shop } })).body.error).toBe('not_a_wholesaler');
    expect((await call('POST', '/customers', { cookie: supervisor, body: { kind: 'retailer', name: 'Z', phone: '0722000003' } })).status).toBe(403);
    expect((await call('POST', '/customers', { token: driver, body: { kind: 'retailer', name: 'Z', phone: '0722000003' } })).status).toBe(403);
  });

  it('lets drivers find shops by name or label, without their numbers', async () => {
    const list = await call('GET', '/customers?search=njeri', { token: driver });
    const found = (list.body as unknown as { id: string; phone?: string; labelCode: string }[]).find((c) => c.id === shop)!;
    expect(found).toBeDefined();
    expect(found.phone).toBeUndefined();
    expect((await call('GET', `/customers/by-label/${found.labelCode.toLowerCase()}`, { token: driver })).body.id).toBe(shop);
    expect((await call('GET', `/customers/${shop}`, { token: driver })).status).toBe(403);
  });
});

describe('a handover from the truck', () => {
  let fulls: { epc: string; id: string }[];
  let emptiesAtShop: { epc: string; id: string }[];
  let handover: string;

  beforeAll(async () => {
    fulls = [];
    for (let i = 0; i < 7; i++) fulls.push(await cylinder(supervisor, depotA));
    // Empties the shop hands back. Where the system thinks they are doesn't matter, as long as they aren't on a truck.
    emptiesAtShop = [];
    for (let i = 0; i < 3; i++) emptiesAtShop.push(await cylinder(otherDepotSupervisor, depotB, 'empty'));
    const t = await call('POST', '/trips', { token: loader, body: { depotId: depotA, driverId, vehicleReg: 'KDA 123X' } });
    trip = t.body.id as string;
    await call('POST', `/trips/${trip}/load`, { token: loader, body: { epcs: fulls.map((f) => f.epc) } });
    expect((await call('POST', `/trips/${trip}/sign`, { token: driver })).status).toBe(200);
  });

  it('needs a verified number, the trip\'s own driver, and one handover at a time', async () => {
    const unverified = await registerShop('New Shop', '0722000009');
    expect((await call('POST', `/trips/${trip}/handovers`, { token: driver, body: { customerId: unverified } })).body.error).toBe('phone_not_verified');
    expect((await call('POST', `/trips/${trip}/handovers`, { token: otherDriver, body: { customerId: shop } })).body.error).toBe('not_your_trip');
    const r = await call('POST', `/trips/${trip}/handovers`, { token: driver, body: { customerId: shop } });
    expect(r.status).toBe(201);
    handover = r.body.id as string;
    expect((await call('POST', `/trips/${trip}/handovers`, { token: driver, body: { customerId: shop } })).body.error).toBe('handover_in_progress');
  });

  it('gives every scanned tag an outcome, and keeps a running balance', async () => {
    const elsewhere = await cylinder(supervisor, depotA);
    const out = await call('POST', `/handovers/${handover}/out`, { token: driver, body: { epcs: [...fulls.slice(0, 4).map((f) => f.epc), elsewhere.epc, 'E2003412000000000000ABCDEF'] } });
    expect(out.status).toBe(200);
    expect(outcome(out, fulls[0]!.epc)).toMatchObject({ result: 'added' });
    expect(outcome(out, elsewhere.epc)).toMatchObject({ result: 'refused', reason: 'not_on_this_truck' });
    expect(outcome(out, 'E2003412000000000000ABCDEF')).toMatchObject({ result: 'refused', reason: 'unknown_tag' });
    expect((await call('POST', `/handovers/${handover}/out`, { token: otherDriver, body: { epcs: [fulls[5]!.epc] } })).body.error).toBe('not_your_handover');

    const back = await call('POST', `/handovers/${handover}/in`, {
      token: driver,
      body: { epcs: [emptiesAtShop[0]!.epc, emptiesAtShop[1]!.epc, fulls[5]!.epc, fulls[0]!.epc, 'OTHER-BRAND-77'] },
    });
    expect(outcome(back, emptiesAtShop[0]!.epc)).toMatchObject({ result: 'added' });
    // A cylinder still on this truck can't be offered back as an empty.
    expect(outcome(back, fulls[5]!.epc)).toMatchObject({ result: 'refused', reason: 'on_a_truck' });
    expect(outcome(back, fulls[0]!.epc)).toMatchObject({ result: 'refused', reason: 'going_out' });
    expect(outcome(back, 'OTHER-BRAND-77')).toMatchObject({ result: 'not_ours' });
    expect(back.body.balance).toEqual({ fullOut: 4, emptyIn: 2, soldOutright: 0, uncovered: 2 });

    const sold = await call('POST', `/handovers/${handover}/lines/${fulls[3]!.id}/sold`, { token: driver, body: { sold: true } });
    expect(sold.body.balance).toEqual({ fullOut: 4, emptyIn: 2, soldOutright: 1, uncovered: 1 });
    expect((await call('GET', `/handovers/${handover}`, { token: driver })).body.foreignTags).toBe(1);
  });

  it('won\'t send the code for an unbalanced handover unless the shortfall is accepted', async () => {
    const r = await call('POST', `/handovers/${handover}/request-confirmation`, { token: driver, body: {} });
    expect(r.status).toBe(409);
    expect(r.body).toMatchObject({ error: 'unbalanced', shortfall: 1 });
  });

  it('lets the depot supervisor approve "empties owed", but not the driver or another depot\'s supervisor', async () => {
    const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
    expect((await call('POST', `/handovers/${handover}/owed`, { token: driver, body: { dueOn: '2001-01-01' } })).status).toBe(400);
    expect((await call('POST', `/handovers/${handover}/owed`, { token: driver, body: { dueOn: tomorrow } })).body.owed).toBe(1);
    expect((await call('POST', `/handovers/${handover}/owed/approve`, { token: driver })).status).toBe(403);
    expect((await call('POST', `/handovers/${handover}/owed/approve`, { cookie: otherDepotSupervisor })).status).toBe(403);
    expect((await call('POST', `/handovers/${handover}/owed/approve`, { cookie: supervisor })).status).toBe(204);
    expect((await call('GET', `/handovers/${handover}`, { cookie: supervisor })).body.owed).toMatchObject({ count: 1, dueOn: tomorrow, approvedBy: 'Sam Supervisor' });
  });

  it('sends the shop the counts and a code; nothing moves until the code is right', async () => {
    const r = await call('POST', `/handovers/${handover}/request-confirmation`, { token: driver, body: {} });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ owed: 1, shortfall: 0 });
    const sms = await lastSms('+254722000001');
    expect(sms.body).toContain('3x13kg FULL given');
    expect(sms.body).toContain('1x13kg BOUGHT');
    expect(sms.body).toContain('2x13kg EMPTY taken');
    expect(sms.body).toContain('1 EMPTY owed');
    // Scanning is closed once the code is out.
    expect((await call('POST', `/handovers/${handover}/out`, { token: driver, body: { epcs: [fulls[5]!.epc] } })).body.error).toBe('handover_not_open');

    const wrong = sms.code === '000000' ? '111111' : '000000';
    expect((await call('POST', `/handovers/${handover}/confirm`, { token: driver, body: { code: wrong } })).body.error).toBe('wrong_code');
    expect((await custody(fulls[0]!.id)).custody_kind).toBe('truck');

    const done = await call('POST', `/handovers/${handover}/confirm`, { token: driver, body: { code: sms.code } });
    expect(done.status).toBe(200);
    expect(done.body).toEqual({ delivered: 3, soldOutright: 1, collected: 2, owed: 1, shortfall: 0 });
  });

  it('moves custody on confirmation: fulls to the shop, the sale to the buyer, empties onto the truck', async () => {
    expect(await custody(fulls[0]!.id)).toMatchObject({ custody_kind: 'retailer', custody_holder_id: shop, owner_kind: 'distributor' });
    expect(await custody(fulls[3]!.id)).toMatchObject({ custody_kind: 'sold_outright', custody_holder_id: shop, owner_kind: 'buyer' });
    expect(await custody(emptiesAtShop[0]!.id)).toMatchObject({ custody_kind: 'truck', custody_holder_id: trip, physical_state: 'empty' });

    const t = await call('GET', `/trips/${trip}`, { cookie: supervisor });
    expect(t.body.counts).toEqual({ loaded: 7, needsApproval: 0, delivered: 4, collected: 2, back: 0, stillOut: 5 });
    expect((t.body.handovers as { status: string }[])[0]!.status).toBe('confirmed');
    expect((await call('GET', `/customers/${shop}`, { cookie: finance })).body.emptiesOwed).toBe(1);

    const events = await withTenant(owner, tenantId, (c) =>
      c.query<{ event_type: string; n: string }>(
        `SELECT event_type, count(*) AS n FROM business_events WHERE event_type IN ('item.delivered', 'item.sold_outright', 'item.collected') GROUP BY event_type ORDER BY event_type`,
      ),
    );
    expect(events.rows.map((r) => [r.event_type, Number(r.n)])).toEqual([['item.collected', 2], ['item.delivered', 3], ['item.sold_outright', 1]]);
  });

  it('records a dispute without moving anything', async () => {
    const h = (await call('POST', `/trips/${trip}/handovers`, { token: driver, body: { customerId: wholesaler } })).body.id as string;
    await call('POST', `/handovers/${h}/out`, { token: driver, body: { epcs: [fulls[4]!.epc] } });
    expect((await call('POST', `/handovers/${h}/request-confirmation`, { token: driver, body: { acceptShortfall: true } })).body).toMatchObject({ shortfall: 1 });
    expect((await call('POST', `/handovers/${h}/dispute`, { token: driver, body: { note: 'Says he ordered two' } })).status).toBe(204);
    expect((await call('GET', `/handovers/${h}`, { token: driver })).body).toMatchObject({ status: 'disputed', disputeNote: 'Says he ordered two' });
    expect((await custody(fulls[4]!.id)).custody_kind).toBe('truck');
  });

  it('closes a handover as unconfirmed when the 15 minutes pass; custody stays with the driver', async () => {
    const h = (await call('POST', `/trips/${trip}/handovers`, { token: driver, body: { customerId: shop } })).body.id as string;
    await call('POST', `/handovers/${h}/out`, { token: driver, body: { epcs: [fulls[4]!.epc] } });
    await call('POST', `/handovers/${h}/request-confirmation`, { token: driver, body: { acceptShortfall: true } });
    expect((await call('POST', `/handovers/${h}/resend-code`, { token: driver })).status).toBe(200);
    expect((await call('POST', `/handovers/${h}/resend-code`, { token: driver })).body.error).toBe('no_more_codes');
    const { code } = await lastSms('+254722000001');
    await withTenant(owner, tenantId, (c) => c.query(`UPDATE handovers SET code_expires_at = now() - interval '1 minute' WHERE id = $1`, [h]));
    expect((await call('POST', `/handovers/${h}/confirm`, { token: driver, body: { code } })).body.error).toBe('confirmation_expired');
    expect((await call('GET', `/handovers/${h}`, { token: driver })).body.status).toBe('unconfirmed');
    expect((await custody(fulls[4]!.id)).custody_kind).toBe('truck');
  });

  it('clears empties owed when the shop hands back extra empties later', async () => {
    const h = (await call('POST', `/trips/${trip}/handovers`, { token: driver, body: { customerId: shop } })).body.id as string;
    await call('POST', `/handovers/${h}/in`, { token: driver, body: { epcs: [emptiesAtShop[2]!.epc] } });
    expect((await call('POST', `/handovers/${h}/request-confirmation`, { token: driver, body: {} })).status).toBe(200);
    const { code } = await lastSms('+254722000001');
    expect((await call('POST', `/handovers/${h}/confirm`, { token: driver, body: { code } })).body).toMatchObject({ collected: 1 });
    expect((await call('GET', `/customers/${shop}`, { cookie: finance })).body.emptiesOwed).toBe(0);
  });

  it('lets the loader return collected empties and undelivered fulls to the depot', async () => {
    const r = await call('POST', `/trips/${trip}/return`, { token: loader, body: { epcs: [emptiesAtShop[0]!.epc, fulls[4]!.epc, fulls[0]!.epc], physicalState: 'empty' } });
    expect(outcome(r, emptiesAtShop[0]!.epc)).toMatchObject({ result: 'returned' });
    expect(outcome(r, fulls[4]!.epc)).toMatchObject({ result: 'returned' });
    // Delivered to the shop: not on this truck any more.
    expect(outcome(r, fulls[0]!.epc)).toMatchObject({ result: 'not_on_trip', custody: { kind: 'retailer' } });
  });

  it('keeps organisations apart', async () => {
    expect((await call('GET', `/customers/${shop}`, { cookie: otherFinance })).status).toBe(404);
    expect((await call('GET', `/handovers/${handover}`, { cookie: otherFinance })).status).toBe(403);
    expect((await call('GET', '/sms/stand-in', { cookie: otherFinance })).body).toEqual([]);
  });
});
