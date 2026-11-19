import { Inject, Injectable } from '@nestjs/common';
import { requiresMfa } from '@ilacore/domain';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../db/database.module.js';
import { withTenant } from '../db/tenant-transaction.js';
import type { RequestMeta } from '../http/request.js';
import { loadAssignments, type AuthContext, type Channel } from './auth-context.js';
import { formatSessionToken, newSecret, parseSessionToken, sha256 } from './tokens.js';

const MINUTE = 60_000;
/** Web: signed out after 30 minutes idle, and always after 12 hours. Handhelds: one shift. */
export const SESSION_LIMITS: Record<Channel, { idleMs: number; absoluteMs: number }> = {
  web: { idleMs: 30 * MINUTE, absoluteMs: 12 * 60 * MINUTE },
  device: { idleMs: 2 * 60 * MINUTE, absoluteMs: 12 * 60 * MINUTE },
};
/** Don't write last-seen more than once a minute per session. */
const TOUCH_AFTER_MS = MINUTE;

export interface NewSession {
  readonly userId: string;
  readonly channel: Channel;
  readonly deviceId: string | null;
  readonly mfaVerified: boolean;
  readonly meta: RequestMeta;
}

@Injectable()
export class SessionService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Creates a session for the tenant currently in scope and returns its token (shown once). */
  async create(client: PoolClient, tenantId: string, s: NewSession): Promise<{ token: string; expiresAt: Date }> {
    const secret = newSecret();
    const limits = SESSION_LIMITS[s.channel];
    const result = await client.query<{ absolute_expires_at: Date }>(
      `INSERT INTO sessions (tenant_id, token_hash, user_id, device_id, channel, idle_expires_at, absolute_expires_at,
                             mfa_verified_at, ip, user_agent)
       VALUES (current_tenant_id(), $1, $2, $3, $4, now() + $5::float8 * interval '1 millisecond',
               now() + $6::float8 * interval '1 millisecond', CASE WHEN $7::boolean THEN now() END, $8, $9)
       RETURNING absolute_expires_at`,
      [sha256(secret), s.userId, s.deviceId, s.channel, limits.idleMs, limits.absoluteMs, s.mfaVerified, s.meta.ip ?? null,
        s.meta.userAgent ?? null],
    );
    return { token: formatSessionToken({ tenantId, secret }), expiresAt: result.rows[0]!.absolute_expires_at };
  }

  /** Resolves a token to the caller, or null when it is unknown, expired, revoked or its device is revoked. */
  async resolve(raw: string | undefined): Promise<AuthContext | null> {
    const token = parseSessionToken(raw);
    if (!token) return null;
    return withTenant(this.pool, token.tenantId, async (c) => {
      const found = await c.query<{
        id: string; user_id: string; channel: Channel; device_id: string | null; mfa_verified_at: Date | null;
        last_seen_at: Date; absolute_expires_at: Date; phone: string; display_name: string;
        must_change_password: boolean; mfa_enabled_at: Date | null;
      }>(
        `SELECT s.id, s.user_id, s.channel, s.device_id, s.mfa_verified_at, s.last_seen_at, s.absolute_expires_at,
                u.phone, u.display_name, u.must_change_password, u.mfa_enabled_at
           FROM sessions s
           JOIN users u ON u.id = s.user_id
           LEFT JOIN devices d ON d.id = s.device_id
          WHERE s.token_hash = $1 AND s.revoked_at IS NULL
            AND s.idle_expires_at > now() AND s.absolute_expires_at > now()
            AND u.status = 'active' AND (s.device_id IS NULL OR d.revoked_at IS NULL)`,
        [sha256(token.secret)],
      );
      const s = found.rows[0];
      if (!s) return null;

      if (Date.now() - s.last_seen_at.getTime() > TOUCH_AFTER_MS) {
        await c.query(
          `UPDATE sessions SET last_seen_at = now(),
                  idle_expires_at = least(now() + $2::float8 * interval '1 millisecond', absolute_expires_at)
            WHERE id = $1`,
          [s.id, SESSION_LIMITS[s.channel].idleMs],
        );
      }
      const assignments = await loadAssignments(c, s.user_id, s.channel);
      return {
        tenantId: token.tenantId,
        userId: s.user_id,
        sessionId: s.id,
        channel: s.channel,
        deviceId: s.device_id,
        displayName: s.display_name,
        phone: s.phone,
        assignments,
        mfaEnrolled: s.mfa_enabled_at !== null,
        mfaRequired: s.channel === 'web' && requiresMfa(assignments),
        mfaVerified: s.mfa_verified_at !== null,
        mustChangePassword: s.must_change_password,
      };
    });
  }

  async markMfaVerified(client: PoolClient, sessionId: string): Promise<void> {
    await client.query('UPDATE sessions SET mfa_verified_at = now() WHERE id = $1', [sessionId]);
  }

  async revoke(client: PoolClient, sessionId: string): Promise<void> {
    await client.query('UPDATE sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL', [sessionId]);
  }

  /** Ends every live session of a user, optionally keeping one (the caller's). */
  async revokeAllForUser(client: PoolClient, userId: string, keepSessionId?: string): Promise<void> {
    await client.query(
      `UPDATE sessions SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL AND ($2::uuid IS NULL OR id <> $2)`,
      [userId, keepSessionId ?? null],
    );
  }
}