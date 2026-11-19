import type { PoolClient } from 'pg';

export interface AuditEntry {
  readonly action: string;
  readonly actorId?: string;
  readonly deviceId?: string;
  readonly targetType?: string;
  readonly targetId?: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly ip?: string;
  readonly userAgent?: string;
}

/** Appends an audit entry for the current tenant. Must be called inside withTenant(). */
export async function recordAudit(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (tenant_id, actor_id, device_id, action, target_type, target_id, details, ip, user_agent)
     VALUES (current_tenant_id(), $1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      entry.actorId ?? null,
      entry.deviceId ?? null,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(entry.details ?? {}),
      entry.ip ?? null,
      entry.userAgent ?? null,
    ],
  );
}
