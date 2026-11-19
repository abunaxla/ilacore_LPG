import { checkPassword, DEFAULT_CYLINDER_SIZES, normalizeKenyanPhone } from '@ilacore/domain';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import { withTenant } from '../db/tenant-transaction.js';
import { recordAudit } from '../events/record-audit.js';
import { hashSecret } from '../identity/hashing.js';

export interface ProvisionInput {
  readonly organisationName: string;
  /** The organisation code people type at sign-in, e.g. "acme-gas". */
  readonly slug: string;
  readonly admin: { readonly phone: string; readonly displayName: string; readonly password: string };
}

export class ProvisionError extends Error {
  override readonly name = 'ProvisionError';
}

/**
 * Creates an organisation (tenant) and its first administrator. Runs as the schema owner, never through
 * the API. Row-level security is forced for the owner too, so everything is written inside the new tenant's scope.
 * The administrator role requires MFA, so the first sign-in goes straight to authenticator set-up.
 */
export async function provisionOrganisation(owner: Pool, input: ProvisionInput): Promise<{ tenantId: string; adminId: string }> {
  const slug = input.slug.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(slug)) {
    throw new ProvisionError('Organisation code: 3-40 lowercase letters, digits or dashes');
  }
  const phone = normalizeKenyanPhone(input.admin.phone);
  if (!phone) throw new ProvisionError('Administrator phone must be a Kenyan mobile number');
  const problems = checkPassword(input.admin.password, { phone });
  if (problems.length > 0) throw new ProvisionError(`Administrator password is not acceptable: ${problems.join(', ')}`);
  const passwordHash = await hashSecret(input.admin.password);

  const tenantId = randomUUID();
  return withTenant(owner, tenantId, async (c) => {
    await c.query('INSERT INTO tenants (id, name) VALUES ($1, $2)', [tenantId, input.organisationName.trim()]);
    await c.query('INSERT INTO tenant_directory (slug, tenant_id) VALUES ($1, $2)', [slug, tenantId]);
    const user = await c.query<{ id: string }>(
      `INSERT INTO users (tenant_id, phone, display_name, password_hash)
       VALUES (current_tenant_id(), $1, $2, $3) RETURNING id`,
      [phone, input.admin.displayName.trim(), passwordHash],
    );
    const adminId = user.rows[0]!.id;
    await c.query(
      `INSERT INTO role_assignments (tenant_id, user_id, role) VALUES (current_tenant_id(), $1, 'administrator')`,
      [adminId],
    );
    // Settings start unset; sizes start with the defaults and the owner adds more.
    await c.query('INSERT INTO tenant_settings (tenant_id) VALUES (current_tenant_id())');
    for (const size of DEFAULT_CYLINDER_SIZES) {
      await c.query(
        'INSERT INTO cylinder_sizes (tenant_id, name, nominal_fill_kg) VALUES (current_tenant_id(), $1, $2)',
        [size.name, size.nominalFillKg],
      );
    }
    await recordAudit(c, { action: 'organisation.provisioned', targetType: 'user', targetId: adminId, details: { slug } });
    return { tenantId, adminId };
  });
}