/**
 * End-to-end access tests: the real API (Nest + Express) against a throwaway PostgreSQL database.
 * Covers sign-in, MFA, forced password change, lockout, handheld sign-in, device revocation,
 * permissions, separation from your own account, tenant isolation and the audit trail.
 */
import 'reflect-metadata';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { NestFactory } from '@nestjs/core';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { provisionOrganisation } from '../src/access/provisioning.js';
import { AppModule } from '../src/app.module.js';
import { migrate } from '../src/db/migrate.js';
import { withTenant } from '../src/db/tenant-transaction.js';
import { configureApp } from '../src/http/configure-app.js';
import { base32Decode, totp } from '../src/identity/totp.js';
import { startTestDatabase, type TestDatabase } from './support/test-database.js';

const ADMIN_PASSWORD = 'tanker-matatu-sunrise-9';
const ORG = 'acme-gas';

let db: TestDatabase;
let owner: Pool;
let app: NestExpressApplication;
let base: string;
let tenantId: string;
let mfaSecret: Buffer;
let recoveryCodes: string[];
let adminCookie: string;

interface Reply {
  status: number;
  body: Record<string, unknown> & { error?: string; next?: string };
  headers: Headers;
}

async function call(method: string, path: string, opts: { body?: unknown; cookie?: string; auth?: string } = {}): Promise<Reply> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['content-type'] = 'application/json';
  if (opts.cookie) headers['cookie'] = opts.cookie;
  if (opts.auth) headers['authorization'] = opts.auth;
  const res = await fetch(`${base}${path}`, {
    method,
    headers,
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : {}, headers: res.headers };
}

function sessionCookie(reply: Reply): string {
  const cookie = reply.headers.getSetCookie().find((c) => c.startsWith('lpg_session='));
  if (!cookie) throw new Error('no session cookie');
  return cookie.split(';')[0]!;
}

const signIn = (phone: string, password: string, organisation = ORG) =>
  call('POST', '/auth/sign-in', { body: { organisation, phone, password } });

beforeAll(async () => {
  db = await startTestDatabase();
  owner = new Pool({ connectionString: db.ownerUrl, max: 2 });
  await migrate(owner, join(__dirname, '..', 'migrations'));
  const appUrl = await db.createAppLogin();

  ({ tenantId } = await provisionOrganisation(owner, {
    organisationName: 'Acme Gas Ltd',
    slug: ORG,
    admin: { phone: '0711000001', displayName: 'Jane Admin', password: ADMIN_PASSWORD },
  }));
  await provisionOrganisation(owner, {
    organisationName: 'Other Gas Ltd',
    slug: 'other-gas',
    admin: { phone: '0711000001', displayName: 'Other Admin', password: ADMIN_PASSWORD },
  });

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: appUrl,
    MFA_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString('base64'),
  });
  app = await NestFactory.create<NestExpressApplication>(AppModule, { logger: false });
  configureApp(app);
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
}, 180_000);

afterAll(async () => {
  await app?.close();
  await owner?.end();
  await db?.dispose();
});

describe('public endpoints', () => {
  it('serves health without signing in, with security headers', async () => {
    const r = await call('GET', '/health');
    expect(r.status).toBe(200);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
    expect(r.headers.get('content-security-policy')).toContain("default-src 'none'");
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('x-powered-by')).toBeNull();
  });

  it('refuses protected routes without a session', async () => {
    expect((await call('GET', '/users')).body.error).toBe('not_signed_in');
  });
});

describe('administrator sign-in with MFA', () => {
  it('gives the same answer for an unknown organisation and a wrong password', async () => {
    const unknownOrg = await signIn('0711000001', ADMIN_PASSWORD, 'nobody');
    const wrongPassword = await signIn('0711000001', 'wrong-password-123');
    expect(unknownOrg.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    expect(unknownOrg.body).toEqual(wrongPassword.body);
  });

  it('signs in, sets a secure session cookie and requires MFA set-up before anything else', async () => {
    const r = await signIn('+254 711 000 001', ADMIN_PASSWORD);
    expect(r.status).toBe(200);
    expect(r.body.next).toBe('mfa_setup');
    const raw = r.headers.getSetCookie().find((c) => c.startsWith('lpg_session='))!;
    expect(raw).toMatch(/HttpOnly/i);
    expect(raw).toMatch(/SameSite=Strict/i);
    adminCookie = sessionCookie(r);

    const blocked = await call('GET', '/users', { cookie: adminCookie });
    expect(blocked.status).toBe(403);
    expect(blocked.body).toMatchObject({ error: 'sign_in_incomplete', next: 'mfa_setup' });
    expect((await call('GET', '/auth/me', { cookie: adminCookie })).body.next).toBe('mfa_setup');
  });

  it('enrols an authenticator app and issues ten recovery codes', async () => {
    const setup = await call('POST', '/auth/mfa/setup', { cookie: adminCookie });
    expect(setup.body.uri).toMatch(/^otpauth:\/\/totp\//);
    mfaSecret = base32Decode(setup.body.secret as string);

    expect((await call('POST', '/auth/mfa/confirm', { cookie: adminCookie, body: { code: '000000' } })).status).toBe(401);
    const confirm = await call('POST', '/auth/mfa/confirm', { cookie: adminCookie, body: { code: totp(mfaSecret, Date.now()) } });
    expect(confirm.status).toBe(200);
    recoveryCodes = confirm.body.recoveryCodes as string[];
    expect(recoveryCodes).toHaveLength(10);
    expect((await call('GET', '/users', { cookie: adminCookie })).status).toBe(200);
  });

  it('asks for a code at the next sign-in, refuses a used code and accepts a fresh one', async () => {
    const r = await signIn('0711000001', ADMIN_PASSWORD);
    expect(r.body.next).toBe('mfa');
    const cookie = sessionCookie(r);
    const used = totp(mfaSecret, Date.now() - 30_000);
    expect((await call('POST', '/auth/mfa/verify', { cookie, body: { code: used } })).status).toBe(401);
    const fresh = totp(mfaSecret, Date.now() + 30_000);
    expect((await call('POST', '/auth/mfa/verify', { cookie, body: { code: fresh } })).status).toBe(204);
    expect((await call('GET', '/users', { cookie })).status).toBe(200);
  });

  it('accepts each recovery code once', async () => {
    const first = sessionCookie(await signIn('0711000001', ADMIN_PASSWORD));
    const code = recoveryCodes[0]!.toLowerCase();
    expect((await call('POST', '/auth/mfa/verify', { cookie: first, body: { recoveryCode: code } })).status).toBe(204);
    const second = sessionCookie(await signIn('0711000001', ADMIN_PASSWORD));
    expect((await call('POST', '/auth/mfa/verify', { cookie: second, body: { recoveryCode: code } })).status).toBe(401);
  });
});

describe('people, roles and handhelds', () => {
  let driverId: string;
  let credential: string;
  let deviceId: string;
  let driverToken: string;

  it('creates a driver with a PIN and grants the driver role', async () => {
    const weak = await call('POST', '/users', { cookie: adminCookie, body: { phone: '0722000002', displayName: 'Kamau', pin: '123456' } });
    expect(weak.body.error).toBe('weak_pin');
    const created = await call('POST', '/users', { cookie: adminCookie, body: { phone: '0722000002', displayName: 'Kamau', pin: '480317' } });
    expect(created.status).toBe(201);
    driverId = created.body.id as string;
    expect((await call('POST', `/users/${driverId}/roles`, { cookie: adminCookie, body: { role: 'driver' } })).status).toBe(201);
    const dup = await call('POST', '/users', { cookie: adminCookie, body: { phone: '+254722000002', displayName: 'Dup' } });
    expect(dup.body.error).toBe('phone_in_use');
  });

  it('refuses retailer grants and changes to your own roles', async () => {
    const retailer = await call('POST', `/users/${driverId}/roles`, { cookie: adminCookie, body: { role: 'retailer' } });
    expect(retailer.body.error).toBe('role_not_for_users');
    const me = await withTenant(owner, tenantId, (c) => c.query<{ id: string }>("SELECT id FROM users WHERE phone = '+254711000001'"));
    const self = await call('POST', `/users/${me.rows[0]!.id}/roles`, { cookie: adminCookie, body: { role: 'owner' } });
    expect(self.body.error).toBe('not_on_yourself');
  });

  it('registers a handheld and signs the driver in on it with the PIN', async () => {
    const reg = await call('POST', '/devices', { cookie: adminCookie, body: { name: 'Truck KDA 123A handheld', kind: 'handheld' } });
    expect(reg.status).toBe(201);
    credential = reg.body.credential as string;
    deviceId = reg.body.id as string;

    const bad = await call('POST', '/auth/device/sign-in', { auth: `Device ${credential}x`, body: { phone: '0722000002', pin: '480317' } });
    expect(bad.body.error).toBe('invalid_device');
    const r = await call('POST', '/auth/device/sign-in', { auth: `Device ${credential}`, body: { phone: '0722000002', pin: '480317' } });
    expect(r.status).toBe(200);
    driverToken = r.body.token as string;

    const me = await call('GET', '/auth/me', { auth: `Bearer ${driverToken}` });
    expect(me.body).toMatchObject({ channel: 'device', permissions: ['handover.perform'], next: 'done' });
  });

  it('keeps the driver out of administration and off the web', async () => {
    expect((await call('GET', '/users', { auth: `Bearer ${driverToken}` })).body.error).toBe('forbidden');
    expect((await signIn('0722000002', '480317')).body.error).toBe('invalid_credentials');
  });

  it('cuts a revoked device off at once', async () => {
    expect((await call('POST', `/devices/${deviceId}/revoke`, { cookie: adminCookie })).status).toBe(204);
    expect((await call('GET', '/auth/me', { auth: `Bearer ${driverToken}` })).body.error).toBe('not_signed_in');
    const again = await call('POST', '/auth/device/sign-in', { auth: `Device ${credential}`, body: { phone: '0722000002', pin: '480317' } });
    expect(again.body.error).toBe('invalid_device');
  });
});

describe('temporary passwords and lockout', () => {
  it('makes a person change a temporary password before doing anything else', async () => {
    const created = await call('POST', '/users', {
      cookie: adminCookie,
      body: { phone: '0733000003', displayName: 'Achieng', password: 'temporary-depot-pass-1' },
    });
    await call('POST', `/users/${created.body.id as string}/roles`, { cookie: adminCookie, body: { role: 'field_supervisor' } });

    const r = await signIn('0733000003', 'temporary-depot-pass-1');
    expect(r.body.next).toBe('change_password');
    const cookie = sessionCookie(r);
    const weak = await call('POST', '/auth/password', { cookie, body: { current: 'temporary-depot-pass-1', next: 'short' } });
    expect(weak.body.error).toBe('weak_password');
    const ok = await call('POST', '/auth/password', { cookie, body: { current: 'temporary-depot-pass-1', next: 'long-rains-in-kisumu-7' } });
    expect(ok.status).toBe(204);
    expect((await call('GET', '/auth/me', { cookie })).body.next).toBe('done');
  });

  it('locks the account after five wrong passwords, even for the right one', async () => {
    for (let i = 0; i < 5; i++) expect((await signIn('0733000003', `wrong-password-${i}xx`)).status).toBe(401);
    expect((await signIn('0733000003', 'long-rains-in-kisumu-7')).status).toBe(401);
    const row = await withTenant(owner, tenantId, (c) =>
      c.query<{ failed_attempts: number; locked: boolean }>(
        "SELECT failed_attempts, locked_until > now() AS locked FROM users WHERE phone = '+254733000003'",
      ),
    );
    expect(row.rows[0]).toEqual({ failed_attempts: 5, locked: true });
  });
});

describe('isolation and audit', () => {
  it('only lists people in the caller’s own organisation', async () => {
    const users = (await call('GET', '/users', { cookie: adminCookie })).body as unknown as { displayName: string }[];
    const names = users.map((u) => u.displayName);
    expect(names).toContain('Jane Admin');
    expect(names).not.toContain('Other Admin');
  });

  it('rejects a session token pointed at another organisation', async () => {
    const otherTenant = await owner.query<{ tenant_id: string }>("SELECT tenant_id FROM tenant_directory WHERE slug = 'other-gas'");
    const secret = adminCookie.split('=')[1]!.split('.')[1]!;
    const forged = `lpg_session=${otherTenant.rows[0]!.tenant_id}.${secret}`;
    expect((await call('GET', '/auth/me', { cookie: forged })).body.error).toBe('not_signed_in');
  });

  it('records sign-ins, failures, grants and device changes in the audit log', async () => {
    const actions = await withTenant(owner, tenantId, (c) =>
      c.query<{ action: string }>('SELECT DISTINCT action FROM audit_log'),
    );
    expect(actions.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'organisation.provisioned', 'auth.signed_in', 'auth.sign_in_failed', 'auth.mfa_enabled', 'auth.mfa_verified',
        'user.created', 'role.granted', 'device.registered', 'device.revoked', 'auth.password_changed',
      ]),
    );
  });
});