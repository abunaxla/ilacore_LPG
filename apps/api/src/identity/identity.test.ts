import { describe, expect, it } from 'vitest';
import { SecretBox } from './secret-box.js';
import { formatDeviceCredential, formatSessionToken, newSecret, parseDeviceCredential, parseSessionToken } from './tokens.js';
import { base32Decode, base32Encode, hotp, otpauthUri, totp, verifyTotp } from './totp.js';

// RFC 6238 appendix B test secret (SHA-1).
const RFC_SECRET = Buffer.from('12345678901234567890', 'ascii');

describe('totp', () => {
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1234567890, '89005924'],
    [20000000000, '65353130'],
  ])('matches the RFC 6238 vector at %i seconds', (seconds, expected) => {
    expect(totp(RFC_SECRET, seconds * 1000, 8)).toBe(expected);
  });

  it('matches the RFC 4226 HOTP vectors', () => {
    expect([0, 1, 2, 9].map((c) => hotp(RFC_SECRET, c))).toEqual(['755224', '287082', '359152', '520489']);
  });

  it('accepts one step of clock drift and refuses reuse', () => {
    const now = 1_700_000_000_000;
    const previous = totp(RFC_SECRET, now - 30_000);
    const counter = verifyTotp(RFC_SECRET, previous, now, null);
    expect(counter).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, previous, now, counter)).toBeNull();
    expect(verifyTotp(RFC_SECRET, totp(RFC_SECRET, now - 90_000), now, null)).toBeNull();
    expect(verifyTotp(RFC_SECRET, 'abcdef', now, null)).toBeNull();
  });

  it('round-trips base32 and builds an authenticator link', () => {
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(otpauthUri('ILACORE', '+254712345678', RFC_SECRET)).toMatch(/^otpauth:\/\/totp\/ILACORE%3A%2B254712345678\?secret=GEZDGNBV/);
  });
});

describe('SecretBox', () => {
  const key = Buffer.alloc(32, 7).toString('base64');

  it('decrypts what it encrypted, for the same context only', () => {
    const box = new SecretBox(key);
    const sealed = box.seal(Buffer.from('secret'), 'user-1');
    expect(box.open(sealed, 'user-1').toString()).toBe('secret');
    expect(() => box.open(sealed, 'user-2')).toThrow();
  });

  it('refuses a key of the wrong size', () => {
    expect(() => new SecretBox(Buffer.alloc(16).toString('base64'))).toThrow(/32 bytes/);
  });
});

describe('tokens', () => {
  const tenantId = '7f1f6f0e-6a3b-4c1d-9e2f-0a1b2c3d4e5f';
  const deviceId = '1b2c3d4e-5f60-4718-a9b0-c1d2e3f4a5b6';

  it('round-trips session tokens and device credentials', () => {
    const secret = newSecret();
    expect(parseSessionToken(formatSessionToken({ tenantId, secret }))).toEqual({ tenantId, secret });
    expect(parseDeviceCredential(formatDeviceCredential({ tenantId, deviceId, secret }))).toEqual({ tenantId, deviceId, secret });
  });

  it('rejects malformed values', () => {
    expect(parseSessionToken(undefined)).toBeNull();
    expect(parseSessionToken('not-a-token')).toBeNull();
    expect(parseSessionToken(`${tenantId}.short`)).toBeNull();
    expect(parseDeviceCredential(`${tenantId}.${newSecret()}`)).toBeNull();
  });
});