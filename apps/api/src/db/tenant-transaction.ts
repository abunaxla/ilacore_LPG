import type { Pool, PoolClient } from 'pg';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class InvalidTenantError extends Error {
  override readonly name = 'InvalidTenantError';
}

/**
 * Runs `work` in one database transaction scoped to a tenant.
 *
 * The tenant id is set with set_config(..., is_local = true), so it lasts only for this transaction
 * and can't leak to the next user of the pooled connection. Row-level security policies read it,
 * so every query inside `work` only sees and writes that tenant's rows.
 */
export async function withTenant<T>(
  pool: Pool,
  tenantId: string,
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  if (!UUID.test(tenantId)) {
    throw new InvalidTenantError('Tenant id must be a UUID');
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
