import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { checkPassword, lockoutDurationMs, normalizeKenyanPhone, requiresMfa } from '@ilacore/domain';
import { randomBytes } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { ENV } from '../config/config.module.js';
import type { Env } from '../config/env.js';
import { PG_POOL } from '../db/database.module.js';
import { withTenant } from '../db/tenant-transaction.js';
import { recordAudit } from '../events/record-audit.js';
import type { RequestMeta } from '../http/request.js';
import { loadAssignments, nextStep, type AuthContext, type NextStep } from './auth-context.js';
import { apiError, invalidCredentials } from './errors.js';
import { hashSecret, verifySecret } from './hashing.js';
import { SecretBox } from './secret-box.js';
import { SessionService } from './session.service.js';
import { parseDeviceCredential, safeEqual, sha256 } from './tokens.js';
import { base32Encode, newTotpSecret, otpauthUri, verifyTotp } from './totp.js';

export const SECRET_BOX = Symbol('SECRET_BOX');
export const RECOVERY_CODE_COUNT = 10;

interface CredentialRow {
  id: string;
  status: string;
  password_hash: string | null;
  pin_hash: string | null;
  failed_attempts: number;
  locked: boolean;
  must_change_password: boolean;
  mfa_enabled_at: Date | null;
}

type Meta = RequestMeta & { deviceId?: string };

/**
 * Work inside a transaction returns an outcome instead of throwing, so failed-attempt counters and
 * audit entries are committed even when the caller is refused.
 */
type Outcome<T> = { ok: true; value: T } | { ok: false; error: () => Error };
const refuse = (error: () => Error): Outcome<never> => ({ ok: false, error });
const accept = <T>(value: T): Outcome<T> => ({ ok: true, value });

function unwrap<T>(o: Outcome<T>): T {
  if (!o.ok) throw o.error();
  return o.value;
}

/** Recovery codes are shown as XXXX-XXXX-XXXX-XXXX and compared without dashes or case. */
function normaliseRecoveryCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

const invalidMfaCode = () =>
  apiError(HttpStatus.UNAUTHORIZED, 'invalid_mfa_code', 'That code is not right. Use the newest code from your app.');

const CREDENTIAL_COLUMNS = `id, status, password_hash, pin_hash, failed_attempts, must_change_password, mfa_enabled_at,
  coalesce(locked_until > now(), false) AS locked`;

@Injectable()
export class AuthService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(SessionService) private readonly sessions: SessionService,
    @Inject(SECRET_BOX) private readonly box: SecretBox,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Web sign-in: organisation code, phone number and password. */
  async signInWeb(
    input: { organisation: string; phone: string; password: string },
    meta: RequestMeta,
  ): Promise<{ token: string; expiresAt: Date; next: NextStep; displayName: string }> {
    const phone = normalizeKenyanPhone(input.phone);
    const tenantId = await this.tenantFor(input.organisation);
    if (!phone || !tenantId) {
      await verifySecret(null, input.password);
      throw invalidCredentials();
    }
    return unwrap(
      await withTenant(this.pool, tenantId, async (c) => {
        const user = await this.lockUserByPhone(c, phone);
        const ok = await this.checkSecret(c, user, user?.password_hash ?? null, input.password, meta, 'password');
        if (!ok || !user) return refuse(invalidCredentials);

        const assignments = await loadAssignments(c, user.id, 'web');
        if (assignments.length === 0) {
          await recordAudit(c, { action: 'auth.sign_in_refused', actorId: user.id, details: { reason: 'no_web_access' }, ...meta });
          return refuse(() =>
            apiError(HttpStatus.FORBIDDEN, 'no_web_access', 'This account signs in on a handheld, not on the web.'),
          );
        }
        const session = await this.sessions.create(c, tenantId, {
          userId: user.id,
          channel: 'web',
          deviceId: null,
          mfaVerified: false,
          meta,
        });
        await recordAudit(c, { action: 'auth.signed_in', actorId: user.id, details: { channel: 'web' }, ...meta });
        const next = nextStep({
          channel: 'web',
          mfaRequired: requiresMfa(assignments),
          mfaVerified: false,
          mfaEnrolled: user.mfa_enabled_at !== null,
          mustChangePassword: user.must_change_password,
        } as AuthContext);
        return accept({ ...session, next, displayName: await this.displayName(c, user.id) });
      }),
    );
  }

  /** Handheld sign-in: the device's own credential, plus the person's phone number and 6-digit PIN. */
  async signInDevice(
    input: { credential: string | undefined; phone: string; pin: string },
    meta: RequestMeta,
  ): Promise<{ token: string; expiresAt: Date; displayName: string }> {
    const credential = parseDeviceCredential(input.credential);
    const phone = normalizeKenyanPhone(input.phone);
    const badDevice = () =>
      apiError(HttpStatus.UNAUTHORIZED, 'invalid_device', 'This device is not registered, or it was revoked.');
    if (!credential) throw badDevice();
    return unwrap(
      await withTenant(this.pool, credential.tenantId, async (c) => {
        const device = await c.query<{ secret_hash: Buffer; revoked_at: Date | null }>(
          'SELECT secret_hash, revoked_at FROM devices WHERE id = $1',
          [credential.deviceId],
        );
        const d = device.rows[0];
        if (!d || d.revoked_at || !safeEqual(d.secret_hash, sha256(credential.secret))) return refuse(badDevice);

        const deviceMeta: Meta = { ...meta, deviceId: credential.deviceId };
        const user = phone ? await this.lockUserByPhone(c, phone) : undefined;
        const ok = await this.checkSecret(c, user, user?.pin_hash ?? null, input.pin, deviceMeta, 'pin');
        if (!ok || !user) return refuse(invalidCredentials);

        const assignments = await loadAssignments(c, user.id, 'device');
        if (assignments.length === 0) {
          await recordAudit(c, {
            action: 'auth.sign_in_refused',
            actorId: user.id,
            details: { reason: 'no_device_access' },
            ...deviceMeta,
          });
          return refuse(() =>
            apiError(HttpStatus.FORBIDDEN, 'no_device_access', 'This account has no role that uses a handheld.'),
          );
        }
        const session = await this.sessions.create(c, credential.tenantId, {
          userId: user.id,
          channel: 'device',
          deviceId: credential.deviceId,
          mfaVerified: false,
          meta,
        });
        await c.query('UPDATE devices SET last_seen_at = now() WHERE id = $1', [credential.deviceId]);
        await recordAudit(c, { action: 'auth.signed_in', actorId: user.id, details: { channel: 'device' }, ...deviceMeta });
        return accept({ ...session, displayName: await this.displayName(c, user.id) });
      }),
    );
  }

  /** Starts authenticator-app enrolment. The secret is stored encrypted but not active until confirmed. */
  async beginMfaSetup(ctx: AuthContext): Promise<{ secret: string; uri: string }> {
    this.requireWeb(ctx);
    if (ctx.mfaEnrolled) {
      throw apiError(HttpStatus.CONFLICT, 'mfa_already_enabled', 'MFA is already set up for this account.');
    }
    const secret = newTotpSecret();
    await withTenant(this.pool, ctx.tenantId, (c) =>
      c.query('UPDATE users SET mfa_secret = $2 WHERE id = $1 AND mfa_enabled_at IS NULL', [
        ctx.userId,
        this.box.seal(secret, ctx.userId),
      ]),
    );
    return { secret: base32Encode(secret), uri: otpauthUri(this.env.MFA_ISSUER, ctx.phone, secret) };
  }

  /** Confirms enrolment with a first code and returns the one-time recovery codes (shown once). */
  async confirmMfaSetup(ctx: AuthContext, code: string, meta: RequestMeta): Promise<{ recoveryCodes: string[] }> {
    this.requireWeb(ctx);
    return unwrap(
      await withTenant(this.pool, ctx.tenantId, async (c) => {
        const row = await c.query<{ mfa_secret: Buffer | null; mfa_enabled_at: Date | null; failed_attempts: number }>(
          'SELECT mfa_secret, mfa_enabled_at, failed_attempts FROM users WHERE id = $1 FOR UPDATE',
          [ctx.userId],
        );
        const u = row.rows[0]!;
        if (u.mfa_enabled_at) {
          return refuse(() => apiError(HttpStatus.CONFLICT, 'mfa_already_enabled', 'MFA is already set up.'));
        }
        if (!u.mfa_secret) {
          return refuse(() => apiError(HttpStatus.BAD_REQUEST, 'mfa_setup_not_started', 'Start MFA set-up first.'));
        }
        const counter = verifyTotp(this.box.open(u.mfa_secret, ctx.userId), code, Date.now(), null);
        if (counter === null) {
          await this.recordFailure(c, ctx.userId, u.failed_attempts, meta, 'mfa_setup');
          return refuse(invalidMfaCode);
        }
        await c.query(
          `UPDATE users SET mfa_enabled_at = now(), mfa_last_counter = $2, failed_attempts = 0, locked_until = NULL
            WHERE id = $1`,
          [ctx.userId, counter],
        );
        const recoveryCodes = await this.replaceRecoveryCodes(c, ctx.userId);
        await this.sessions.markMfaVerified(c, ctx.sessionId);
        await recordAudit(c, { action: 'auth.mfa_enabled', actorId: ctx.userId, ...meta });
        return accept({ recoveryCodes });
      }),
    );
  }

  /** Second step of sign-in: a code from the authenticator app, or one unused recovery code. */
  async verifyMfa(
    ctx: AuthContext,
    input: { code?: string | undefined; recoveryCode?: string | undefined },
    meta: RequestMeta,
  ): Promise<void> {
    this.requireWeb(ctx);
    unwrap(
      await withTenant(this.pool, ctx.tenantId, async (c) => {
        const row = await c.query<{
          mfa_secret: Buffer | null;
          mfa_enabled_at: Date | null;
          mfa_last_counter: string | null;
          failed_attempts: number;
          locked: boolean;
        }>(
          `SELECT mfa_secret, mfa_enabled_at, mfa_last_counter, failed_attempts,
                  coalesce(locked_until > now(), false) AS locked
             FROM users WHERE id = $1 FOR UPDATE`,
          [ctx.userId],
        );
        const u = row.rows[0]!;
        if (!u.mfa_enabled_at || !u.mfa_secret) {
          return refuse(() => apiError(HttpStatus.BAD_REQUEST, 'mfa_not_enabled', 'Set up MFA first.'));
        }
        if (u.locked) return refuse(invalidMfaCode);

        let method: 'code' | 'recovery_code' | null = null;
        if (input.code) {
          const last = u.mfa_last_counter === null ? null : Number(u.mfa_last_counter);
          const counter = verifyTotp(this.box.open(u.mfa_secret, ctx.userId), input.code, Date.now(), last);
          if (counter !== null) {
            await c.query('UPDATE users SET mfa_last_counter = $2 WHERE id = $1', [ctx.userId, counter]);
            method = 'code';
          }
        } else if (input.recoveryCode) {
          const used = await c.query(
            `UPDATE mfa_recovery_codes SET used_at = now()
              WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
            [ctx.userId, sha256(normaliseRecoveryCode(input.recoveryCode))],
          );
          if (used.rowCount === 1) method = 'recovery_code';
        }
        if (!method) {
          await this.recordFailure(c, ctx.userId, u.failed_attempts, meta, 'mfa');
          return refuse(invalidMfaCode);
        }
        await c.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [ctx.userId]);
        await this.sessions.markMfaVerified(c, ctx.sessionId);
        await recordAudit(c, { action: 'auth.mfa_verified', actorId: ctx.userId, details: { method }, ...meta });
        return accept(undefined);
      }),
    );
  }

  /** Changes the caller's own password and signs out their other sessions. */
  async changePassword(ctx: AuthContext, input: { current: string; next: string }, meta: RequestMeta): Promise<void> {
    this.requireWeb(ctx);
    if (ctx.mfaRequired && !ctx.mfaVerified) {
      throw apiError(HttpStatus.FORBIDDEN, 'sign_in_incomplete', 'Finish MFA first.', { next: nextStep(ctx) });
    }
    const problems: string[] = checkPassword(input.next, { phone: ctx.phone });
    if (input.next === input.current) problems.push('same_as_current');
    if (problems.length > 0) {
      throw apiError(HttpStatus.BAD_REQUEST, 'weak_password', 'Choose a different password.', { problems });
    }
    const newHash = await hashSecret(input.next);
    unwrap(
      await withTenant(this.pool, ctx.tenantId, async (c) => {
        const user = await c.query<CredentialRow>(`SELECT ${CREDENTIAL_COLUMNS} FROM users WHERE id = $1 FOR UPDATE`, [
          ctx.userId,
        ]);
        const u = user.rows[0];
        const ok = await this.checkSecret(c, u, u?.password_hash ?? null, input.current, meta, 'password');
        if (!ok) return refuse(invalidCredentials);
        await c.query('UPDATE users SET password_hash = $2, must_change_password = false WHERE id = $1', [
          ctx.userId,
          newHash,
        ]);
        await this.sessions.revokeAllForUser(c, ctx.userId, ctx.sessionId);
        await recordAudit(c, { action: 'auth.password_changed', actorId: ctx.userId, ...meta });
        return accept(undefined);
      }),
    );
  }

  async signOut(ctx: AuthContext, meta: RequestMeta): Promise<void> {
    await withTenant(this.pool, ctx.tenantId, async (c) => {
      await this.sessions.revoke(c, ctx.sessionId);
      await recordAudit(c, {
        action: 'auth.signed_out',
        actorId: ctx.userId,
        ...(ctx.deviceId ? { deviceId: ctx.deviceId } : {}),
        ...meta,
      });
    });
  }

  private requireWeb(ctx: AuthContext): void {
    if (ctx.channel !== 'web') throw apiError(HttpStatus.FORBIDDEN, 'web_only', 'This is only available on the web.');
  }

  private async tenantFor(organisation: string): Promise<string | null> {
    const result = await this.pool.query<{ tenant_id: string }>('SELECT tenant_id FROM tenant_directory WHERE slug = $1', [
      organisation.trim().toLowerCase(),
    ]);
    return result.rows[0]?.tenant_id ?? null;
  }

  private async displayName(c: PoolClient, userId: string): Promise<string> {
    const r = await c.query<{ display_name: string }>('SELECT display_name FROM users WHERE id = $1', [userId]);
    return r.rows[0]!.display_name;
  }

  private async lockUserByPhone(c: PoolClient, phone: string): Promise<CredentialRow | undefined> {
    const result = await c.query<CredentialRow>(`SELECT ${CREDENTIAL_COLUMNS} FROM users WHERE phone = $1 FOR UPDATE`, [
      phone,
    ]);
    return result.rows[0];
  }

  /**
   * Verifies a password or PIN. Unknown, disabled and locked accounts still pay the hashing cost, so
   * timing doesn't reveal them. Failures count towards the lockout.
   */
  private async checkSecret(
    c: PoolClient,
    user: CredentialRow | undefined,
    stored: string | null,
    candidate: string,
    meta: Meta,
    kind: 'password' | 'pin',
  ): Promise<boolean> {
    if (!user || user.status !== 'active' || user.locked) {
      await verifySecret(null, candidate);
      if (user) {
        await recordAudit(c, {
          action: 'auth.sign_in_failed',
          actorId: user.id,
          details: { kind, reason: user.locked ? 'locked' : user.status },
          ...meta,
        });
      }
      return false;
    }
    if (!(await verifySecret(stored, candidate))) {
      await this.recordFailure(c, user.id, user.failed_attempts, meta, kind);
      return false;
    }
    if (user.failed_attempts > 0) {
      await c.query('UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = $1', [user.id]);
    }
    return true;
  }

  private async recordFailure(c: PoolClient, userId: string, previousFailures: number, meta: Meta, kind: string): Promise<void> {
    const failures = previousFailures + 1;
    const lockMs = lockoutDurationMs(failures);
    await c.query(
      `UPDATE users SET failed_attempts = $2,
              locked_until = CASE WHEN $3::float8 > 0 THEN now() + $3::float8 * interval '1 millisecond'
                                  ELSE locked_until END
        WHERE id = $1`,
      [userId, failures, lockMs],
    );
    await recordAudit(c, {
      action: 'auth.sign_in_failed',
      actorId: userId,
      details: { kind, failures, locked: lockMs > 0 },
      ...meta,
    });
  }

  /** Issues a fresh set of recovery codes; any earlier set stops working. */
  private async replaceRecoveryCodes(c: PoolClient, userId: string): Promise<string[]> {
    await c.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId]);
    const codes: string[] = [];
    for (let i = 0; i < RECOVERY_CODE_COUNT; i++) {
      const raw = base32Encode(randomBytes(10));
      codes.push(raw.match(/.{4}/g)!.join('-'));
      await c.query('INSERT INTO mfa_recovery_codes (tenant_id, user_id, code_hash) VALUES (current_tenant_id(), $1, $2)', [
        userId,
        sha256(raw),
      ]);
    }
    return codes;
  }
}
