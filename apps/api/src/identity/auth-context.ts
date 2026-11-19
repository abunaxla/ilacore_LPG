import { isRoleId, roleAllowsChannel, type RoleAssignment } from '@ilacore/domain';
import type { PoolClient } from 'pg';

export type Channel = 'web' | 'device';

/** Who is calling, resolved from their session on every request. */
export interface AuthContext {
  readonly tenantId: string;
  readonly userId: string;
  readonly sessionId: string;
  readonly channel: Channel;
  readonly deviceId: string | null;
  readonly displayName: string;
  readonly phone: string;
  /** Live grants, limited to roles usable through this channel. */
  readonly assignments: readonly RoleAssignment[];
  readonly mfaEnrolled: boolean;
  readonly mfaRequired: boolean;
  readonly mfaVerified: boolean;
  readonly mustChangePassword: boolean;
}

/** What the person has to do before the session is fully usable. */
export type NextStep = 'mfa_setup' | 'mfa' | 'change_password' | 'done';

export function nextStep(ctx: AuthContext): NextStep {
  if (ctx.channel === 'web' && ctx.mfaRequired && !ctx.mfaVerified) return ctx.mfaEnrolled ? 'mfa' : 'mfa_setup';
  if (ctx.channel === 'web' && ctx.mustChangePassword) return 'change_password';
  return 'done';
}

/** Loads a user's live role grants that are usable through `channel`. Call inside withTenant(). */
export async function loadAssignments(client: PoolClient, userId: string, channel: Channel): Promise<RoleAssignment[]> {
  const rows = await client.query<{ role: string; location_id: string | null }>(
    'SELECT role, location_id FROM role_assignments WHERE user_id = $1 AND revoked_at IS NULL',
    [userId],
  );
  return rows.rows.flatMap((r) =>
    isRoleId(r.role) && roleAllowsChannel(r.role, channel) ? [{ role: r.role, locationId: r.location_id }] : [],
  );
}