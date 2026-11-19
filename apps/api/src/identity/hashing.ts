import { hash, verify } from '@node-rs/argon2';

/**
 * Argon2id for passwords and PINs (the library defaults follow the OWASP minimums: 19 MiB, t=2, p=1).
 * A fixed dummy hash is verified when the account doesn't exist, so response time doesn't reveal
 * which phone numbers have accounts.
 */
let dummyHash: Promise<string> | undefined;

export function hashSecret(secret: string): Promise<string> {
  return hash(secret);
}

export async function verifySecret(stored: string | null, candidate: string): Promise<boolean> {
  if (!stored) {
    dummyHash ??= hash('not-a-real-secret-used-for-timing');
    await verify(await dummyHash, candidate).catch(() => false);
    return false;
  }
  return verify(stored, candidate).catch(() => false);
}