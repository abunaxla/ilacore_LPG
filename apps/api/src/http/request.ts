import type { Request } from 'express';

export const SESSION_COOKIE = 'lpg_session';

export interface RequestMeta {
  readonly ip: string | undefined;
  readonly userAgent: string | undefined;
}

export function requestMeta(req: Request): RequestMeta {
  return { ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300) };
}

/** Reads one cookie without a parsing library. */
export function readCookie(req: Request, name: string): string | undefined {
  for (const part of req.headers.cookie?.split(';') ?? []) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim());
  }
  return undefined;
}

/** The session token from the cookie (web) or the Authorization header (devices). */
export function sessionTokenFrom(req: Request): string | undefined {
  const auth = req.get('authorization');
  if (auth?.startsWith('Bearer ')) return auth.slice(7).trim();
  return readCookie(req, SESSION_COOKIE);
}