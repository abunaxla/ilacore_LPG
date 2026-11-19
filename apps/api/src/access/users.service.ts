import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { checkPassword, checkPin, isRoleId, normalizeKenyanPhone, ROLES, type RoleId } from '@ilacore/domain';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/database.module.js';
import { withTenant } from '../db/tenant-transaction.js';
import { recordAudit } from '../events/record-audit.js';
import type { RequestMeta } from '../http/request.js';
import type { AuthContext } from '../identity/auth-context.js';
import { apiError } from '../identity/errors.js';
import { hashSecret } from '../identity/hashing.js';
import { SessionService } from '../identity/session.service.js';

export interface UserSummary {
  id: string;
  phone: string;
  displayName: string;
  status: string;
  mfaEnabled: boolean;
  roles: { id: string; role: string; locationId: string | null }[];
}

const notFound = () => apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such user.');
const notYourself = () =>
  apiError(HttpStatus.FORBIDDEN, 'not_on_yourself', 'Another administrator has to do this for your own account.');

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === '23505';
}

/** People and their role grants. Every change is audited with the administrator who made it. */
@Injectable()
export class UsersService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async create(
    actor: AuthContext,
    input: { phone: string; displayName: string; password?: string | undefined; pin?: string | undefined },
    meta: RequestMeta,
  ): Promise<{ id: string }> {
    const phone = normalizeKenyanPhone(input.phone);
    if (!phone) throw apiError(HttpStatus.BAD_REQUEST, 'invalid_phone', 'Enter a Kenyan mobile number.');
    const passwordHash = input.password ? await this.hashPassword(input.password, phone) : null;
    const pinHash = input.pin ? await this.hashPin(input.pin) : null;
    try {
      return await withTenant(this.pool, actor.tenantId, async (c) => {
        const row = await c.query<{ id: string }>(
          `INSERT INTO users (tenant_id, phone, display_name, password_hash, must_change_password, pin_hash)
           VALUES (current_tenant_id(), $1, $2, $3, $4, $5) RETURNING id`,
          [phone, input.displayName.trim(), passwordHash, passwordHash !== null, pinHash],
        );
        const id = row.rows[0]!.id;
        await recordAudit(c, { action: 'user.created', actorId: actor.userId, targetType: 'user', targetId: id, ...meta });
        return { id };
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw apiError(HttpStatus.CONFLICT, 'phone_in_use', 'Someone in this organisation already has that number.');
      }
      throw error;
    }
  }

  async list(actor: AuthContext): Promise<UserSummary[]> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const users = await c.query<{ id: string; phone: string; display_name: string; status: string; mfa: boolean }>(
        `SELECT id, phone, display_name, status, mfa_enabled_at IS NOT NULL AS mfa FROM users ORDER BY display_name`,
      );
      const grants = await c.query<{ id: string; user_id: string; role: string; location_id: string | null }>(
        'SELECT id, user_id, role, location_id FROM role_assignments WHERE revoked_at IS NULL ORDER BY granted_at',
      );
      return users.rows.map((u) => ({
        id: u.id,
        phone: u.phone,
        displayName: u.display_name,
        status: u.status,
        mfaEnabled: u.mfa,
        roles: grants.rows
          .filter((g) => g.user_id === u.id)
          .map((g) => ({ id: g.id, role: g.role, locationId: g.location_id })),
      }));
    });
  }

  async grantRole(
    actor: AuthContext,
    userId: string,
    input: { role: string; locationId?: string | undefined },
    meta: RequestMeta,
  ): Promise<{ id: string }> {
    if (userId === actor.userId) throw notYourself();
    if (!isRoleId(input.role)) throw apiError(HttpStatus.BAD_REQUEST, 'unknown_role', 'There is no such role.');
    const role: RoleId = input.role;
    if (ROLES[role].channel === 'sms_only') {
      throw apiError(
        HttpStatus.BAD_REQUEST,
        'role_not_for_users',
        'Retailers confirm by SMS from their registered number; they are customers, not users.',
      );
    }
    try {
      return await withTenant(this.pool, actor.tenantId, async (c) => {
        await this.requireUser(c, userId);
        if (input.locationId) await this.requireLocation(c, input.locationId);
        const row = await c.query<{ id: string }>(
          `INSERT INTO role_assignments (tenant_id, user_id, role, location_id, granted_by)
           VALUES (current_tenant_id(), $1, $2, $3, $4) RETURNING id`,
          [userId, role, input.locationId ?? null, actor.userId],
        );
        const id = row.rows[0]!.id;
        await recordAudit(c, {
          action: 'role.granted',
          actorId: actor.userId,
          targetType: 'user',
          targetId: userId,
          details: { assignmentId: id, role, locationId: input.locationId ?? null },
          ...meta,
        });
        return { id };
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw apiError(HttpStatus.CONFLICT, 'already_granted', 'The user already has that role there.');
      throw error;
    }
  }

  async revokeRole(actor: AuthContext, userId: string, assignmentId: string, meta: RequestMeta): Promise<void> {
    if (userId === actor.userId) throw notYourself();
    await withTenant(this.pool, actor.tenantId, async (c) => {
      const row = await c.query<{ role: string }>(
        `UPDATE role_assignments SET revoked_at = now(), revoked_by = $3
          WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL RETURNING role`,
        [assignmentId, userId, actor.userId],
      );
      if (row.rowCount !== 1) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such live role grant.');
      await recordAudit(c, {
        action: 'role.revoked',
        actorId: actor.userId,
        targetType: 'user',
        targetId: userId,
        details: { assignmentId, role: row.rows[0]!.role },
        ...meta,
      });
    });
  }

  /** Sets a field worker's handheld PIN. */
  async setPin(actor: AuthContext, userId: string, pin: string, meta: RequestMeta): Promise<void> {
    const pinHash = await this.hashPin(pin);
    await this.updateCredential(actor, userId, 'user.pin_set', meta, (c) =>
      c.query('UPDATE users SET pin_hash = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1', [userId, pinHash]),
    );
  }

  /** Sets a temporary password. The person must change it at their next sign-in. All their sessions end. */
  async resetPassword(actor: AuthContext, userId: string, password: string, meta: RequestMeta): Promise<void> {
    if (userId === actor.userId) throw notYourself();
    await withTenant(this.pool, actor.tenantId, async (c) => {
      const phone = await this.requireUser(c, userId);
      const hash = await this.hashPassword(password, phone);
      await c.query(
        `UPDATE users SET password_hash = $2, must_change_password = true, failed_attempts = 0, locked_until = NULL
          WHERE id = $1`,
        [userId, hash],
      );
      await this.sessions.revokeAllForUser(c, userId);
      await recordAudit(c, { action: 'user.password_reset', actorId: actor.userId, targetType: 'user', targetId: userId, ...meta });
    });
  }

  /** For a lost or replaced phone: removes the authenticator so the person enrols again. All their sessions end. */
  async resetMfa(actor: AuthContext, userId: string, meta: RequestMeta): Promise<void> {
    if (userId === actor.userId) throw notYourself();
    await this.updateCredential(actor, userId, 'user.mfa_reset', meta, async (c) => {
      await c.query(
        'UPDATE users SET mfa_secret = NULL, mfa_enabled_at = NULL, mfa_last_counter = NULL WHERE id = $1',
        [userId],
      );
      await c.query('UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND used_at IS NULL', [userId]);
      await this.sessions.revokeAllForUser(c, userId);
    });
  }

  async setStatus(actor: AuthContext, userId: string, status: 'active' | 'disabled', meta: RequestMeta): Promise<void> {
    if (userId === actor.userId) throw notYourself();
    await this.updateCredential(actor, userId, status === 'disabled' ? 'user.disabled' : 'user.enabled', meta, async (c) => {
      await c.query('UPDATE users SET status = $2, failed_attempts = 0, locked_until = NULL WHERE id = $1', [userId, status]);
      if (status === 'disabled') await this.sessions.revokeAllForUser(c, userId);
    });
  }

  private async updateCredential(
    actor: AuthContext,
    userId: string,
    action: string,
    meta: RequestMeta,
    change: (c: PoolClient) => Promise<unknown>,
  ): Promise<void> {
    await withTenant(this.pool, actor.tenantId, async (c) => {
      await this.requireUser(c, userId);
      await change(c);
      await recordAudit(c, { action, actorId: actor.userId, targetType: 'user', targetId: userId, ...meta });
    });
  }

  /** Returns the user's phone, or 404. */
  private async requireUser(c: PoolClient, userId: string): Promise<string> {
    const row = await c.query<{ phone: string }>('SELECT phone FROM users WHERE id = $1 FOR UPDATE', [userId]);
    if (!row.rows[0]) throw notFound();
    return row.rows[0].phone;
  }

  private async requireLocation(c: PoolClient, locationId: string): Promise<void> {
    const row = await c.query('SELECT 1 FROM locations WHERE id = $1', [locationId]);
    if (row.rowCount !== 1) throw apiError(HttpStatus.BAD_REQUEST, 'unknown_location', 'There is no such location.');
  }

  private async hashPassword(password: string, phone: string): Promise<string> {
    const problems = checkPassword(password, { phone });
    if (problems.length > 0) {
      throw apiError(HttpStatus.BAD_REQUEST, 'weak_password', 'Choose a different password.', { problems });
    }
    return hashSecret(password);
  }

  private async hashPin(pin: string): Promise<string> {
    const problems = checkPin(pin);
    if (problems.length > 0) throw apiError(HttpStatus.BAD_REQUEST, 'weak_pin', 'Choose a different PIN.', { problems });
    return hashSecret(pin);
  }
}