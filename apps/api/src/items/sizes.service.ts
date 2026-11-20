import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { checkCylinderSize } from '@ilacore/domain';
import type { Pool } from 'pg';
import { PG_POOL } from '../db/database.module.js';
import { withTenant } from '../db/tenant-transaction.js';
import { recordAudit } from '../events/record-audit.js';
import type { RequestMeta } from '../http/request.js';
import type { AuthContext } from '../identity/auth-context.js';
import { apiError } from '../identity/errors.js';

export interface CylinderSize {
  id: string;
  name: string;
  nominalFillKg: number;
  retired: boolean;
}

export interface CylinderSettings {
  sizes: CylinderSize[];
}

/** Organisation settings for cylinders: the sizes it runs. */
@Injectable()
export class SizesService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async settings(actor: AuthContext): Promise<CylinderSettings> {
    return withTenant(this.pool, actor.tenantId, async (c) => {
      const sizes = await c.query<{ id: string; name: string; nominal_fill_kg: string; retired_at: Date | null }>(
        'SELECT id, name, nominal_fill_kg, retired_at FROM cylinder_sizes ORDER BY nominal_fill_kg, name',
      );
      return {
        sizes: sizes.rows.map((r) => ({
          id: r.id,
          name: r.name,
          nominalFillKg: Number(r.nominal_fill_kg),
          retired: r.retired_at !== null,
        })),
      };
    });
  }

  async addSize(actor: AuthContext, input: { name: string; nominalFillKg: number }, meta: RequestMeta): Promise<{ id: string }> {
    const problems = checkCylinderSize(input);
    if (problems.length > 0) throw apiError(HttpStatus.BAD_REQUEST, 'invalid_request', 'Check the size.', { fields: problems });
    try {
      return await withTenant(this.pool, actor.tenantId, async (c) => {
        const row = await c.query<{ id: string }>(
          `INSERT INTO cylinder_sizes (tenant_id, name, nominal_fill_kg, created_by)
           VALUES (current_tenant_id(), $1, $2, $3) RETURNING id`,
          [input.name.trim(), input.nominalFillKg, actor.userId],
        );
        const id = row.rows[0]!.id;
        await recordAudit(c, {
          action: 'cylinder_size.added',
          actorId: actor.userId,
          targetType: 'cylinder_size',
          targetId: id,
          details: { name: input.name.trim(), nominalFillKg: input.nominalFillKg },
          ...meta,
        });
        return { id };
      });
    } catch (error) {
      if ((error as { code?: string }).code === '23505') {
        throw apiError(HttpStatus.CONFLICT, 'name_in_use', 'A size with that name already exists.');
      }
      throw error;
    }
  }

  /** Retired sizes can't be chosen for new cylinders; existing cylinders keep them. */
  async retireSize(actor: AuthContext, id: string, meta: RequestMeta): Promise<void> {
    await withTenant(this.pool, actor.tenantId, async (c) => {
      const row = await c.query(
        'UPDATE cylinder_sizes SET retired_at = now(), retired_by = $2 WHERE id = $1 AND retired_at IS NULL',
        [id, actor.userId],
      );
      if (row.rowCount !== 1) throw apiError(HttpStatus.NOT_FOUND, 'not_found', 'No such size in use.');
      await recordAudit(c, { action: 'cylinder_size.retired', actorId: actor.userId, targetType: 'cylinder_size', targetId: id, ...meta });
    });
  }
}
