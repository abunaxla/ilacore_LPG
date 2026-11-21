import 'server-only';
import type { Permission } from '@ilacore/domain';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { api } from './api';

/**
 * The handheld (field) side of the web app. A handheld is paired once with its device credential; the person
 * then signs in with phone and PIN, which only works with that credential. Both live in HttpOnly cookies scoped
 * to /field, so they never reach the office pages and the office session never reaches these.
 */
const DEVICE_COOKIE = 'lpg_device';
const FIELD_COOKIE = 'lpg_field';
const PATH = '/field';

const secure = () => (process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production');

export async function getDeviceCredential(): Promise<string | undefined> {
  return (await cookies()).get(DEVICE_COOKIE)?.value;
}

/** Only call from a Server Action. The credential stays until the handheld is unpaired or it is revoked. */
export async function setDeviceCredential(credential: string): Promise<void> {
  (await cookies()).set(DEVICE_COOKIE, credential, { httpOnly: true, sameSite: 'strict', secure: secure(), path: PATH, maxAge: 400 * 86_400 });
}

export async function clearDeviceCredential(): Promise<void> {
  (await cookies()).set(DEVICE_COOKIE, '', { path: PATH, maxAge: 0 });
}

export async function getFieldToken(): Promise<string | undefined> {
  return (await cookies()).get(FIELD_COOKIE)?.value;
}

/** Only call from a Server Action. A handheld session lasts one shift (the API sets the expiry). */
export async function setFieldToken(token: string, expiresAt: string | undefined): Promise<void> {
  (await cookies()).set(FIELD_COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: secure(),
    path: PATH,
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  });
}

export async function clearFieldToken(): Promise<void> {
  (await cookies()).set(FIELD_COOKIE, '', { path: PATH, maxAge: 0 });
}

export interface FieldMe {
  displayName: string;
  channel: 'web' | 'device';
  permissions: Permission[];
}

/** The person signed in on this handheld, or a redirect to pairing or sign-in. Asks the API every time. */
export async function requireFieldMe(): Promise<{ me: FieldMe; token: string }> {
  if (!(await getDeviceCredential())) redirect('/field/pair');
  const token = await getFieldToken();
  if (!token) redirect('/field/sign-in');
  const reply = await api<FieldMe>('/auth/me', { token });
  if (!reply.ok) redirect('/field/sign-in');
  return { me: reply.data, token };
}
