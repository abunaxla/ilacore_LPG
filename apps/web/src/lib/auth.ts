import 'server-only';
import type { Permission, RoleAssignment } from '@ilacore/domain';
import { redirect } from 'next/navigation';
import { api } from './api';
import { getToken } from './session';

export type NextStep = 'mfa_setup' | 'mfa' | 'change_password' | 'done';

export interface Me {
  displayName: string;
  phone: string;
  channel: 'web' | 'device';
  roles: RoleAssignment[];
  permissions: Permission[];
  next: NextStep;
}

const STEP_PATHS: Record<NextStep, string> = {
  mfa_setup: '/sign-in/set-up-mfa',
  mfa: '/sign-in/mfa',
  change_password: '/change-password',
  done: '/',
};

export function stepPath(next: NextStep): string {
  return STEP_PATHS[next];
}

/** The signed-in person, or null. Asks the API every time, so permissions are always current. */
export async function getMe(): Promise<Me | null> {
  const token = await getToken();
  if (!token) return null;
  const reply = await api<Me>('/auth/me', { token });
  return reply.ok ? reply.data : null;
}

/**
 * The signed-in person, or a redirect: to sign-in when there is no session, or to the step they still
 * have to finish (MFA, password change). `allow` lists the unfinished steps this page itself handles.
 */
export async function requireMe(allow: readonly NextStep[] = []): Promise<Me> {
  const me = await getMe();
  if (!me) redirect('/sign-in');
  if (me.next !== 'done' && !allow.includes(me.next)) redirect(stepPath(me.next));
  return me;
}

export function hasAny(me: Me, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => me.permissions.includes(p));
}