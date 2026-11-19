import { createHmac, randomBytes } from 'node:crypto';

/**
 * Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30-second steps): the codes shown by
 * Google Authenticator, Microsoft Authenticator and similar apps. They work without network coverage.
 */
const STEP_SECONDS = 30;
const DIGITS = 6;
const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** A new 160-bit secret. */
export function newTotpSecret(): Buffer {
  return randomBytes(20);
}

export function hotp(secret: Buffer, counter: number, digits = DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1]! & 0x0f;
  const code = (mac.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits;
  return code.toString().padStart(digits, '0');
}

export function counterAt(timeMs: number): number {
  return Math.floor(timeMs / 1000 / STEP_SECONDS);
}

export function totp(secret: Buffer, timeMs: number, digits = DIGITS): string {
  return hotp(secret, counterAt(timeMs), digits);
}

/**
 * Checks a code against the current step and one step either side (phone clocks drift).
 * Returns the matching counter so the caller can refuse a code that was already used, or null.
 */
export function verifyTotp(secret: Buffer, code: string, timeMs: number, lastUsedCounter: number | null): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = counterAt(timeMs);
  for (const counter of [now - 1, now, now + 1]) {
    if (lastUsedCounter !== null && counter <= lastUsedCounter) continue;
    if (hotp(secret, counter) === code) return counter;
  }
  return null;
}

/** The link an authenticator app reads from a QR code. */
export function otpauthUri(issuer: string, account: string, secret: Buffer): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret: base32Encode(secret), issuer, digits: String(DIGITS), period: String(STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}