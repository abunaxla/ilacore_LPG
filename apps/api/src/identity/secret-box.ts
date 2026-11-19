import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Encrypts MFA secrets at rest with AES-256-GCM. The key comes from the environment (MFA_ENCRYPTION_KEY),
 * never from the database, so a copy of the database alone can't produce MFA codes.
 * Layout: version (1 byte) | iv (12) | auth tag (16) | ciphertext.
 */
const VERSION = 1;

export class SecretBox {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('MFA_ENCRYPTION_KEY must be 32 bytes, base64-encoded');
  }

  seal(plain: Buffer, context: string): Buffer {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(context, 'utf8'));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), body]);
  }

  open(sealed: Buffer, context: string): Buffer {
    if (sealed[0] !== VERSION) throw new Error('Unknown secret format');
    const decipher = createDecipheriv('aes-256-gcm', this.key, sealed.subarray(1, 13));
    decipher.setAAD(Buffer.from(context, 'utf8'));
    decipher.setAuthTag(sealed.subarray(13, 29));
    return Buffer.concat([decipher.update(sealed.subarray(29)), decipher.final()]);
  }
}