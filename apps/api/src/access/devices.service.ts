import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/database.module.js';
import { withTenant } from '../db/tenant-transaction.js';
import { recordAudit } from '../events/record-audit.js';
import type { RequestMeta } from '../http/request.js';
import type { AuthContext } from '../identity/auth-context.js';
import { apiError } from '../identity/errors.js';
import { formatDeviceCredential, newSecret, sha256 } from '../identity/tokens.js';

export interface DeviceSummary {
  id: string;
  name: string;
  kind: string;
  locationId: string | null;
  registeredAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date | null;
}

/** Handhelds and readers. Each has its own credential, revocable on its own. */
@Injectable()
export class DevicesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Registers a device and returns its credential. It is shown once and only its hash is kept. */
  async register(
    actor: AuthContext,
    input: { name: string; kind: 'handheld' | 'reader'; locationId?: string | undefined },
    meta: RequestMeta,
  ): Promise<{ id: string; credential: string }> {
    const id = randomUUID();
    const secret = newSecret();
    return withTenant(this.pool, actor.tenantId, async (c) => {
      if (input.locationId) {
        const loc = await c.query('SELECT 1 FROM locations WHERE id = $1', [input.locationId]);
        if (loc.rowCount !== 1) throw apiError(HttpStatus.BAD_REQUEST, 'unknown_location', 'There is no such location.');
      }
      await c.query(
        `INSERT INTO devices (id, tenant_id, name, kind, location_id, secret_hash, registered_by)
         VALUES ($1, current_tenant_id(), $2, $3, $4, $5, $6)`,
        [id, input.name.trim(), input.kind, input.locationId ?? null, sha256(secret), actor.userId],
      );
      await recordAudit(c, {
        action: 'device.registered',
        actorId: actor.userId,
        targetType: 'device',
        targetId: id,
        details: { kind: input.kind },
        ...meta,
      });
      return { id, credential: formatDeviceCredential({ tenantId: actor.tenantId, deviceId: id, secret }) };
    });
  }

  async list(actor: AuthContext): Promise<DeviceSummary[]> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const rows = await c.query<{
        id: string; name: string; kind: string; location_id: string | null;
        registered_at: Date; revoked_at: Date | null; last_seen_at: Date | null;
      }>('SELECT id, name, kind, location_id, registered_at, revoked_at, last_seen_at FROM devices ORDER BY name');
      return rows.rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        locationId: r.location_id,
        registeredAt: r.registered_at,
        revokedAt: r.revoked_at,
        lastSeenAt: r.last_seen_at,
      }));
    });
  }

  /** Cuts a device off at once: its credential stops working and every session on it ends. */
  async revoke(actor: AuthContext, deviceId: string, meta: RequestMeta): Promise<void> {
    await withTenant(this.pool, actor.tenantId, async (c) => {
      const row = await c.query(
        'UPDATE devices SET revoked_at = now(), revoked_by = $2 WHERE id = $1 AND revoked_at IS NULL',
        [deviceId, actor.userId],
      );
      if (row.rowCount !== 1) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such active device.');
      await c.query('UPDATE sessions SET revoked_at = now() WHERE device_id = $1 AND revoked_at IS NULL', [deviceId]);
      await recordAudit(c, { action: 'device.revoked', actorId: actor.userId, targetType: 'device', targetId: deviceId, ...meta });
    });
  }
}