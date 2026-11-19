import { describe, expect, it } from 'vitest';
import { loadEnv } from './env.js';

describe('loadEnv', () => {
  it('accepts a valid configuration and applies defaults', () => {
    const env = loadEnv({ DATABASE_URL: 'postgres://app@localhost:5432/ilacore' });
    expect(env.PORT).toBe(3001);
    expect(env.NODE_ENV).toBe('development');
  });

  it('refuses to start without a database URL', () => {
    expect(() => loadEnv({})).toThrow(/DATABASE_URL/);
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
