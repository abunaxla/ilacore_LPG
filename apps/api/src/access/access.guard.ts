import { HttpStatus, Inject, Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { can, MFA_REQUIRED } from '@ilacore/domain';
import type { Request } from 'express';
import { nextStep, type AuthContext } from '../identity/auth-context.js';
import { apiError } from '../identity/errors.js';
import { SessionService } from '../identity/session.service.js';
import { sessionTokenFrom } from '../http/request.js';
import {
  attachAuth,
  INCOMPLETE_KEY,
  PERMISSION_KEY,
  PUBLIC_KEY,
  SIGNED_IN_KEY,
  type PermissionRequirement,
} from './decorators.js';

/**
 * Global guard: resolves the session and enforces the route's access rule on every request.
 * MFA-protected permissions are never usable from a handheld session (handhelds sign in with a PIN only).
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    @Inject(Reflector) private readonly reflector: Reflector,
    @Inject(SessionService) private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;

    const requirement = this.reflector.getAllAndOverride<PermissionRequirement | undefined>(PERMISSION_KEY, targets);
    const signedInOnly = this.reflector.getAllAndOverride<boolean>(SIGNED_IN_KEY, targets);
    if (!requirement && !signedInOnly) {
      // A route that forgot to declare its rule is closed, not open.
      throw apiError(HttpStatus.FORBIDDEN, 'forbidden', 'You do not have access to this.');
    }

    const req = context.switchToHttp().getRequest<Request>();
    const ctx = await this.sessions.resolve(sessionTokenFrom(req));
    if (!ctx) throw apiError(HttpStatus.UNAUTHORIZED, 'not_signed_in', 'Sign in to continue.');
    attachAuth(req, ctx);

    const step = nextStep(ctx);
    if (step !== 'done' && !this.reflector.getAllAndOverride<boolean>(INCOMPLETE_KEY, targets)) {
      throw apiError(HttpStatus.FORBIDDEN, 'sign_in_incomplete', 'Finish signing in first.', { next: step });
    }

    if (requirement && !this.allows(ctx, requirement, req)) {
      throw apiError(HttpStatus.FORBIDDEN, 'forbidden', 'You do not have access to this.');
    }
    return true;
  }

  private allows(ctx: AuthContext, requirement: PermissionRequirement, req: Request): boolean {
    const location = requirement.location?.(req);
    return requirement.anyOf.some(
      (p) => !(ctx.channel === 'device' && MFA_REQUIRED.has(p)) && can(ctx.assignments, p, location),
    );
  }
}