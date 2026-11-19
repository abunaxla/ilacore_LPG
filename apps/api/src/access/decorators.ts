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
}

export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const SignedIn = () => SetMetadata(SIGNED_IN_KEY, true);
export const AllowIncompleteSignIn = () => SetMetadata(INCOMPLETE_KEY, true);
export const RequirePermission = (
  permission: Permission | readonly Permission[],
  options: { location?: (req: Request) => string | undefined } = {},
) =>
  SetMetadata(PERMISSION_KEY, {
    anyOf: typeof permission === 'string' ? [permission] : permission,
    ...(options.location ? { location: options.location } : {}),
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