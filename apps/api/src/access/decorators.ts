import { createParamDecorator, SetMetadata, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@ilacore/domain';
import type { Request } from 'express';
import type { AuthContext } from '../identity/auth-context.js';

/**
 * Every route must say who may call it, or the guard refuses it (deny by default):
 *   @Public()             no sign-in (health, sign-in itself)
 *   @SignedIn()           any fully signed-in person
 *   @RequirePermission()  holders of a permission, optionally at the location named in the request
 * @AllowIncompleteSignIn() lets a route run before MFA or a forced password change is done.
 */
export const PUBLIC_KEY = 'access:public';
export const SIGNED_IN_KEY = 'access:signed_in';
export const PERMISSION_KEY = 'access:permission';
export const INCOMPLETE_KEY = 'access:incomplete';

export interface PermissionRequirement {
  /** Any one of these is enough. */
  readonly anyOf: readonly Permission[];
  /** Reads the location the action applies to, when the permission is location-scoped. */
  readonly location?: (req: Request) => string | undefined;
  /**
   * The location is only known once the record is loaded (a cylinder's own page, a scan session).
   * The guard then only checks the permission is held somewhere; the service MUST check it at the
   * record's location with requireAt() before revealing or changing anything.
   */
  readonly anyLocation?: true;
}

export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const SignedIn = () => SetMetadata(SIGNED_IN_KEY, true);
export const AllowIncompleteSignIn = () => SetMetadata(INCOMPLETE_KEY, true);
export const RequirePermission = (
  permission: Permission | readonly Permission[],
  options: { location?: (req: Request) => string | undefined; anyLocation?: true } = {},
) =>
  SetMetadata(PERMISSION_KEY, {
    anyOf: typeof permission === 'string' ? [permission] : permission,
    ...(options.location ? { location: options.location } : {}),
    ...(options.anyLocation ? { anyLocation: true } : {}),
  } satisfies PermissionRequirement);

const contexts = new WeakMap<Request, AuthContext>();

export function attachAuth(req: Request, ctx: AuthContext): void {
  contexts.set(req, ctx);
}

/** The signed-in caller, set by the access guard. */
export const Auth = createParamDecorator((_data: unknown, context: ExecutionContext): AuthContext => {
  const ctx = contexts.get(context.switchToHttp().getRequest<Request>());
  if (!ctx) throw new Error('Auth() used on a route without a signed-in caller');
  return ctx;
});