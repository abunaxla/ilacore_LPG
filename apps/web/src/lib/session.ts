import 'server-only';
import { cookies } from 'next/headers';

export const SESSION_COOKIE = 'lpg_session';

export async function getToken(): Promise<string | undefined> {
  return (await cookies()).get(SESSION_COOKIE)?.value;
}

/** Stores the API session token in an HttpOnly cookie on this site. Only call from a Server Action. */
export async function setToken(token: string, expiresAt: string | undefined): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.COOKIE_SECURE ? process.env.COOKIE_SECURE === 'true' : process.env.NODE_ENV === 'production',
    path: '/',
    ...(expiresAt ? { expires: new Date(expiresAt) } : {}),
  });
}

export async function clearToken(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, '', { path: '/', maxAge: 0 });
}