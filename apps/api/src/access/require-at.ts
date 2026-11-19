import { HttpStatus } from '@nestjs/common';
import { can, MFA_REQUIRED, type Permission } from '@ilacore/domain';
import type { AuthContext } from '../identity/auth-context.js';
import { apiError } from '../identity/errors.js';

/**
 * Whether the caller holds any of `permissions` at a record's location (an organisation-wide grant
 * always counts). `locationId` null means the record is not at a location (on a truck, with a
 * customer...): only an organisation-wide grant counts. Same device/MFA rule as the global guard.
 */
export function canAt(ctx: AuthContext, permissions: readonly Permission[], locationId: string | null): boolean {
  return permissions.some(
    (p) => !(ctx.channel === 'device' && MFA_REQUIRED.has(p)) && can(ctx.assignments, p, locationId ?? undefined),
  );
}

/** Service-level check for routes marked `anyLocation` (see decorators.ts). Throws 403. */
export function requireAt(ctx: AuthContext, permissions: readonly Permission[], locationId: string | null): void {
  if (!canAt(ctx, permissions, locationId)) {
    throw apiError(HttpStatus.FORBIDDEN, 'forbidden', 'You do not have access to this.');
  }
}
