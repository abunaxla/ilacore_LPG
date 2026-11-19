import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/database.module.js';
import { withTenant } from '../db/tenant-transaction.js';
import { recordAudit } from '../events/record-audit.js';
import type { RequestMeta } from '../http/request.js';
import type { AuthContext } from '../identity/auth-context.js';
import { apiError } from '../identity/errors.js';

export const LOCATION_KINDS = ['depot', 'filling_plant', 'warehouse', 'office'] as const;

/** Places that role grants and devices can be scoped to. */
@Injectable()
export class LocationsService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async create(
    actor: AuthContext,
    input: { name: string; kind: (typeof LOCATION_KINDS)[number] },
    meta: RequestMeta,
  ): Promise<{ id: string }> {
    try {
      return await withTenant(this.pool, actor.tenantId, async (c) => {
        const row = await c.query<{ id: string }>(
          'INSERT INTO locations (tenant_id, name, kind) VALUES (current_tenant_id(), $1, $2) RETURNING id',
          [input.name.trim(), input.kind],
        );
        const id = row.rows[0]!.id;
        await recordAudit(c, { action: 'location.created', actorId: actor.userId, targetType: 'location', targetId: id, ...meta });
        return { id };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw apiError(HttpStatus.CONFLICT, 'name_in_use', 'A location with that name already exists.');
      }
      throw error;
    }
  }

  async list(actor: AuthContext): Promise<{ id: string; name: string; kind: string }[]> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const rows = await c.query<{ id: string; name: string; kind: string }>('SELECT id, name, kind FROM locations ORDER BY name');
      return rows.rows;
    });
  }
}