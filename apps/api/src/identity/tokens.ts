import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque credentials. The first part names the tenant so the API can set the row-level security scope
 * before looking the credential up. The secret part is 32 random bytes, stored only as a SHA-256 hash.
 *   session token:      <tenantId>.<secret>
 *   device credential:  <tenantId>.<deviceId>.<secret>
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET = /^[A-Za-z0-9_-]{43}$/;

export function newSecret(): string {
  return randomBytes(32).toString('base64url');
}

export function sha256(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

export function safeEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}

export interface SessionToken {
  readonly tenantId: string;
  readonly secret: string;
}

export function formatSessionToken(t: SessionToken): string {
  return `${t.tenantId}.${t.secret}`;
}

export function parseSessionToken(raw: string | undefined): SessionToken | null {
  const parts = raw?.split('.');
  if (parts?.length !== 2) return null;
  const [tenantId, secret] = parts as [string, string];
  return UUID.test(tenantId) && SECRET.test(secret) ? { tenantId, secret } : null;
}

export interface DeviceCredential {
  readonly tenantId: string;
  readonly deviceId: string;
  readonly secret: string;
}

export function formatDeviceCredential(c: DeviceCredential): string {
  return `${c.tenantId}.${c.deviceId}.${c.secret}`;
}

export function parseDeviceCredential(raw: string | undefined): DeviceCredential | null {
  const parts = raw?.split('.');
  if (parts?.length !== 3) return null;
  const [tenantId, deviceId, secret] = parts as [string, string, string];
  return UUID.test(tenantId) && UUID.test(deviceId) && SECRET.test(secret) ? { tenantId, deviceId, secret } : null;
}