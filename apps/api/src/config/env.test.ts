import { describe, expect, it } from 'vitest';
import { cookieSecure, loadEnv } from './env.js';

const KEY = Buffer.alloc(32, 1).toString('base64');
const BASE = { DATABASE_URL: 'postgres://app@localhost:5432/lpg_dev', MFA_ENCRYPTION_KEY: KEY };

describe('loadEnv', () => {
  it('accepts a valid configuration and applies defaults', () => {
    const env = loadEnv(BASE);
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
    expect(env.MFA_ISSUER).toBe('ILACORE');
    expect(cookieSecure(env)).toBe(false);
    expect(cookieSecure(loadEnv({ ...BASE, NODE_ENV: 'production' }))).toBe(true);
  });

  it('refuses an MFA key of the wrong size', () => {
    expect(() => loadEnv({ ...BASE, MFA_ENCRYPTION_KEY: 'c2hvcnQ=' })).toThrow(/MFA_ENCRYPTION_KEY/);
  });

  it('refuses to start without a database URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
  });

  it("uses the SMS stand-in unless told otherwise, and needs both Africa's Talking settings for real sending", () => {
    expect(loadEnv(BASE).SMS_PROVIDER).toBe('stand_in');
    expect(() => loadEnv({ ...BASE, SMS_PROVIDER: 'africastalking', AT_USERNAME: 'sandbox' })).toThrow(/AT_API_KEY/);
    const env = loadEnv({ ...BASE, SMS_PROVIDER: 'africastalking', AT_USERNAME: 'sandbox', AT_API_KEY: 'k' });
    expect(env.SMS_PROVIDER).toBe('africastalking');
  });

  it('names the bad setting without echoing its value', () => {
    const secret = 'not-a-url-but-maybe-a-password';
    let message = '';
    try {
      loadEnv({ DATABASE_URL: secret });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/DATABASE_URL/);
    expect(message).not.toContain(secret);
  });
});
